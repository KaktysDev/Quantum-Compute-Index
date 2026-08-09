// ──────────────────────────────────────────────────────────────────────────────
// Daily refresh — collect, compute, persist.
//
// Called by the cron (/api/cron/refresh) and by the authenticated on-demand
// button. Every run is logged to qci_refresh_runs whether it succeeds or not:
// an index that only records its good days cannot answer "why did coverage drop
// last Tuesday", and that question is exactly what a standardised benchmark has
// to be able to answer.
// ──────────────────────────────────────────────────────────────────────────────

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/crypto";
import { collectDeviceObservations } from "./collect";
import { computeIndexPoint } from "./compute";
import type { LedgerEntry } from "./ledger";
import { requiredEnergyRegions, REGISTRY } from "./registry";
import { collectFactors } from "./sources/factors";
import type { IndexPoint } from "./types";

export interface RefreshV2Result {
  ok: boolean;
  wrote: boolean;
  skipped?: boolean;
  reason?: string;
  indexDate?: string;
  level?: number;
  changePct?: number;
  usdPerQpuHour?: number;
  usdPerQcu?: number;
  coverage?: number;
  matched?: number;
  observed?: number;
  /** Devices carrying a price in today's cross-section. */
  priced?: number;
  /** Rows written to the raw observation archive. */
  archived?: number;
  /** True on the very first point of the series. */
  inception?: boolean;
  status?: "final" | "provisional";
  costBasisPerHour?: number;
  costCoverageRatio?: number;
  priceCardVersion?: string | null;
  /** Devices whose large price move is held pending corroboration. */
  held?: Array<{ id: string; from: number; to: number }>;
  retired?: string[];
  warnings?: string[];
  error?: string;
}

/** Current calendar date in America/New_York — the index's publication clock. */
export function dateEt(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

interface PointRow {
  index_date: string;
  level: number | string;
  ledger: Record<string, LedgerEntry> | null;
}

/**
 * Run one refresh.
 *
 * `force` re-runs a day that already has a point, overwriting it — the unique
 * index on index_date makes that an upsert rather than a duplicate. Without
 * force, an existing point for today short-circuits, so the cron firing twice
 * cannot produce two points for one day.
 */
export async function refreshIndex(
  opts: { force?: boolean; now?: Date } = {},
): Promise<RefreshV2Result> {
  const now = opts.now ?? new Date();
  const force = opts.force ?? false;
  const indexDate = dateEt(now);
  const supabase = createAdminClient();
  const startedAt = new Date().toISOString();

  const log = async (patch: Record<string, unknown>) => {
    try {
      await supabase.from("qci_refresh_runs").insert({
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        index_date: indexDate,
        ...patch,
      });
    } catch (e) {
      console.error("[qci/v2] failed to write run log", e);
    }
  };

  try {
    // ── Idempotency ────────────────────────────────────────────────────────
    const { data: existing } = await supabase
      .from("qci_index_points")
      .select("index_date")
      .eq("index_date", indexDate)
      .limit(1);
    if (!force && existing && existing.length > 0) {
      const result: RefreshV2Result = {
        ok: true,
        wrote: false,
        skipped: true,
        reason: "already computed today",
        indexDate,
      };
      await log({ ok: true, wrote: false, reason: result.reason });
      return result;
    }

    // ── Previous state (chain anchor + ledger) ─────────────────────────────
    // Strictly BEFORE today, so a forced re-run chains from yesterday rather
    // than from the row it is about to replace.
    const { data: prevRows } = await supabase
      .from("qci_index_points")
      .select("index_date, level, ledger")
      .lt("index_date", indexDate)
      .order("index_date", { ascending: false })
      .limit(1);
    const prev = (prevRows?.[0] ?? null) as PointRow | null;
    const previousLevel = prev ? Number(prev.level) : null;
    const previousLedger = new Map<string, LedgerEntry>(
      Object.entries((prev?.ledger ?? {}) as Record<string, LedgerEntry>),
    );

    // ── Provider credentials ───────────────────────────────────────────────
    const { data: keyRows, error: keyErr } = await supabase
      .from("provider_keys")
      .select("provider, encrypted_key, enabled")
      .eq("enabled", true);
    if (keyErr) throw new Error(keyErr.message);

    const keys: Record<string, string> = {};
    for (const row of keyRows ?? []) {
      try {
        keys[row.provider] = decryptSecret(row.encrypted_key);
      } catch (e) {
        console.error(`[qci/v2] failed to decrypt key for ${row.provider}`, e);
      }
    }

    // ── Collect ────────────────────────────────────────────────────────────
    const regions = requiredEnergyRegions(REGISTRY);
    const [collected, factors] = await Promise.all([
      collectDeviceObservations(keys, now),
      collectFactors(regions),
    ]);

    // No live device data AND no ledger to advance → nothing meaningful to
    // publish. Deliberately does NOT write a point: a day with zero information
    // should leave a gap in the series, not a fabricated value.
    if (collected.observations.length === 0 && previousLedger.size === 0) {
      const reason =
        Object.keys(keys).length === 0
          ? "no enabled provider keys"
          : "no provider returned a priced, live device";
      await log({ ok: true, wrote: false, reason, warnings: collected.warnings });
      return { ok: true, wrote: false, reason, indexDate, warnings: collected.warnings };
    }

    // ── Compute ────────────────────────────────────────────────────────────
    const { point, ledger, held, retired } = computeIndexPoint({
      observations: collected.observations,
      factors,
      previousLedger,
      previousLevel,
      today: indexDate,
      ts: now.toISOString(),
    });

    // ── Persist ────────────────────────────────────────────────────────────
    const warnings = [...collected.warnings];
    await writePoint(supabase, indexDate, point, ledger);
    const archived = await writeObservations(supabase, indexDate, collected.observations);
    await writeFactors(supabase, indexDate, factors);
    // The archive is not on the critical path, but a silent failure there means
    // the audit trail quietly stops existing — which is how this ran for weeks
    // with an empty qci_observations table. Report it with the run.
    if (archived < collected.observations.length) {
      warnings.push(
        `Observation archive incomplete: ${archived}/${collected.observations.length} rows written.`,
      );
    }

    const result: RefreshV2Result = {
      ok: true,
      wrote: true,
      indexDate,
      level: point.level,
      changePct: point.changePct,
      usdPerQpuHour: point.usdPerQpuHour,
      usdPerQcu: point.usdPerQcu,
      coverage: point.coverage,
      matched: point.matched,
      observed: collected.observations.length,
      priced: point.priced,
      archived,
      inception: point.inception,
      status: point.status,
      costBasisPerHour: point.costBasisPerHour,
      costCoverageRatio: point.costCoverageRatio,
      priceCardVersion: collected.priceCardVersion,
      held,
      retired,
      warnings,
    };

    await log({
      ok: true,
      wrote: true,
      coverage: point.coverage,
      matched: point.matched,
      observed: collected.observations.length,
      warnings,
      held,
      retired,
      price_card_version: collected.priceCardVersion,
    });
    return result;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[qci/v2] refresh failed", e);
    await log({ ok: false, wrote: false, error });
    return { ok: false, wrote: false, indexDate, error };
  }
}

type Admin = ReturnType<typeof createAdminClient>;

async function writePoint(
  supabase: Admin,
  indexDate: string,
  point: IndexPoint,
  ledger: Map<string, LedgerEntry>,
): Promise<void> {
  const { error } = await supabase.from("qci_index_points").upsert(
    {
      ts: point.ts,
      index_date: indexDate,
      level: point.level,
      change_pct: point.changePct,
      usd_per_qpu_hour: point.usdPerQpuHour,
      usd_per_qcu: point.usdPerQcu,
      coverage: point.coverage,
      matched: point.matched,
      status: point.status,
      cost_basis_per_hour: point.costBasisPerHour ?? null,
      cost_coverage_ratio: point.costCoverageRatio ?? null,
      point,
      ledger: Object.fromEntries(ledger),
      methodology: point.methodology,
    },
    { onConflict: "index_date" },
  );
  // A failed point write is fatal — everything downstream reads this row.
  if (error) throw new Error(`qci_index_points upsert failed: ${error.message}`);
}

/** Archive the day's raw observations. Returns how many rows landed. */
async function writeObservations(
  supabase: Admin,
  indexDate: string,
  observations: Awaited<ReturnType<typeof collectDeviceObservations>>["observations"],
): Promise<number> {
  if (observations.length === 0) return 0;
  const rows = observations.map((o) => ({
    index_date: indexDate,
    device_id: o.id,
    provider: o.provider,
    device: o.device,
    modality: o.modality,
    region: o.region,
    price_per_hour: o.pricePerHour.value,
    price_basis: o.priceBasis,
    price_tier: o.pricePerHour.tier,
    price_source: o.pricePerHour.source,
    price_observed_at: o.pricePerHour.observedAt,
    qubits: o.qubits.value,
    two_qubit_error: o.twoQubitError.value,
    layer_rate: o.layerRate.value,
    online: o.online.value,
    queue_seconds: o.queueSeconds?.value ?? null,
    price_per_shot: o.pricePerShot?.value ?? null,
    price_per_task: o.pricePerTask?.value ?? null,
    raw: o,
  }));
  const { error } = await supabase
    .from("qci_observations")
    .upsert(rows, { onConflict: "index_date,device_id" });
  // The archive is for auditability, not for the computation — a failure here
  // is reported but must not discard an otherwise valid index point.
  if (error) {
    console.error("[qci/v2] observation archive write failed", error.message);
    return 0;
  }
  return rows.length;
}

async function writeFactors(
  supabase: Admin,
  indexDate: string,
  factors: Awaited<ReturnType<typeof collectFactors>>,
): Promise<void> {
  if (factors.length === 0) return;
  const rows = factors.map((f) => ({
    index_date: indexDate,
    factor_id: f.id,
    factor_group: f.group,
    label: f.label,
    unit: f.unit,
    value: f.observation.value,
    tier: f.observation.tier,
    source: f.observation.source,
    citation: f.observation.citation ?? null,
    observed_at: f.observation.observedAt,
    fetched_at: f.observation.fetchedAt,
  }));
  const { error } = await supabase
    .from("qci_factors")
    .upsert(rows, { onConflict: "index_date,factor_id" });
  if (error) console.error("[qci/v2] factor archive write failed", error.message);
}
