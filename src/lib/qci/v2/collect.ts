// ──────────────────────────────────────────────────────────────────────────────
// Collection — turn provider telemetry plus published rate cards into a day's
// DeviceObservations.
//
// THE SEPARATION THAT MAKES THIS AUDITABLE
// v1 let each provider adapter emit BOTH the quality metrics and the price, with
// the price hard-coded inside the adapter file. That meant a price could only
// ever change by someone editing TypeScript, and there was no way to point at
// where a number came from.
//
// v2 splits the two by source of authority:
//
//   QUALITY + LIVENESS  ← the provider's own control plane (the existing
//                          adapters), because only the operator knows its
//                          calibration and whether a machine is up.
//   PRICE               ← the seller's published rate card (AWS Price List API
//                          for Braket-sold hardware; IBM's published list rate),
//                          because only the seller sets the price.
//
// Each field arrives as an Observation carrying its own tier, citation and
// effective date, so every number on the QCI map can be traced to a source.
// ──────────────────────────────────────────────────────────────────────────────

import { fetchAllMetrics } from "@/lib/providers";
import type { RawQpuMetrics } from "@/lib/qci/types";
import {
  fetchBraketPriceCard,
  priceFor,
  priceObservation,
  type BraketPriceCard,
} from "./sources/awsPricing";
import { MODALITY_LAYER_RATE } from "./quality";
import {
  IBM_TEMPLATE,
  QUANDELA_TEMPLATE,
  REGISTRY,
  type RegistryEntry,
} from "./registry";
import type { DeviceObservation, Observation } from "./types";

/**
 * IBM's Pay-As-You-Go list rate. IBM exposes no machine-readable price feed —
 * the Cloud global catalog does not carry a public price for the quantum service
 * — so this is pinned with a citation and a review date, and reported as
 * `published` tier rather than `primary`. It is the one price in the basket that
 * a human has to re-verify; the UI surfaces its review date for exactly that
 * reason.
 *
 * $96/minute × 60 = $5,760 per QPU-hour, directly comparable to the AWS
 * reservation rates without any unit assumption.
 */
export const IBM_LIST_RATE_PER_MINUTE = 96;
export const IBM_RATE_CITATION =
  "IBM Quantum Platform Pay-As-You-Go published list rate, $96/minute (quantum.cloud.ibm.com/pricing)";
/** Re-verify the pinned IBM rate on or before this date. */
export const IBM_RATE_REVIEWED_ON = "2026-08-09";

/** Normalise a device name so "Aria-1", "aria-1" and "qpu.aria-1" all match. */
function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/^qpu[.:]/, "")
    .replace(/[^a-z0-9]/g, "");
}

function obs(
  value: number,
  o: Omit<Observation, "value">,
): Observation {
  return { value, ...o };
}

/**
 * Two-qubit error from an adapter's fidelity figure.
 *
 * Adapters report `fid2q` (fidelity). The quality model works in error, and the
 * conversion is the identity ε = 1 − F. Kept explicit because getting it
 * backwards would invert the entire quality ranking silently.
 */
function errorFromFidelity(fid2q: number): number {
  return Math.max(0, Math.min(1, 1 - fid2q));
}

interface Matched {
  entry: RegistryEntry;
  metric: RawQpuMetrics;
}

/**
 * Match live adapter output against the registry.
 *
 * A device only enters the day's observations if BOTH the registry knows about
 * it and a provider actually reported it live this run. That two-sided
 * requirement is what keeps decommissioned hardware out: AWS still lists prices
 * for five retired Rigetti Aspen machines, IonQ Harmony and the legacy
 * "IonQdevice", and pricing them as if they were purchasable would drag the
 * index down toward rates nobody can transact at.
 */
function matchRegistry(metrics: RawQpuMetrics[]): {
  matched: Matched[];
  unregistered: RawQpuMetrics[];
} {
  const byKey = new Map<string, RegistryEntry>();
  for (const r of REGISTRY) byKey.set(`${norm(r.provider)}|${norm(r.device)}`, r);

  const matched: Matched[] = [];
  const unregistered: RawQpuMetrics[] = [];

  for (const m of metrics) {
    const provider = norm(m.provider);
    const key = `${provider}|${norm(m.qpu)}`;
    const hit = byKey.get(key);
    if (hit) {
      matched.push({ entry: hit, metric: m });
      continue;
    }
    // IBM and Quandela are discovered dynamically — build a registry entry on
    // the fly from their template so new backends are picked up automatically.
    if (provider === "ibm") {
      matched.push({
        entry: { ...IBM_TEMPLATE, id: `ibm:${norm(m.qpu)}`, device: m.qpu },
        metric: m,
      });
      continue;
    }
    if (provider === "quandela") {
      matched.push({
        entry: { ...QUANDELA_TEMPLATE, id: `quandela:${norm(m.qpu)}`, device: m.qpu },
        metric: m,
      });
      continue;
    }
    unregistered.push(m);
  }

  return { matched, unregistered };
}

/** Resolve a device's USD/QPU-hour from the best available published source. */
function resolvePrice(
  entry: RegistryEntry,
  card: BraketPriceCard | null,
  fetchedAt: string,
): { price: Observation; basis: DeviceObservation["priceBasis"] } | null {
  // 1. AWS reservation rate — the seller's own $/hour. No conversion, no
  //    assumption. This is the ideal case and covers most of the basket.
  if (entry.braket && card) {
    const p = priceFor(card, entry.braket.providerName, entry.braket.deviceName);
    if (p?.perHour && p.perHour > 0) {
      return {
        price: priceObservation(card, p.perHour, fetchedAt),
        basis: "reservation-hour",
      };
    }
  }

  // 2. IBM's published per-minute list rate, converted by the exact factor 60.
  if (entry.provider === "IBM") {
    return {
      price: obs(IBM_LIST_RATE_PER_MINUTE * 60, {
        tier: "published",
        source: "ibm.list-rate",
        citation: `${IBM_RATE_CITATION} — last reviewed ${IBM_RATE_REVIEWED_ON}`,
        observedAt: `${IBM_RATE_REVIEWED_ON}T00:00:00Z`,
        fetchedAt,
        maxAgeDays: 120,
      }),
      basis: "metered-minute",
    };
  }

  // 3. No published hourly rate. Deliberately NOT converted from per-shot
  //    pricing: doing so needs a shots-per-hour assumption, and v1's arbitrary
  //    60,000-shots-per-hour constant is precisely what made cross-provider
  //    prices incomparable. A device with no hourly rate simply does not enter
  //    the headline index.
  return null;
}

export interface CollectResult {
  observations: DeviceObservation[];
  /** Registry devices we know of but that no provider reported live today. */
  missing: string[];
  /** Live devices no registry entry covers — surfaced so silent joins are visible. */
  unregistered: string[];
  /** Devices reported live but with no published hourly price. */
  unpriced: string[];
  priceCardVersion: string | null;
  priceCardDate: string | null;
  /** Non-fatal problems worth surfacing in the refresh result. */
  warnings: string[];
}

/**
 * Collect a full day of device observations.
 *
 * Fails soft on the price card: if AWS is unreachable, the run still produces
 * observations for IBM (whose price is pinned) and the ledger's imputation
 * handles the rest. A feed outage narrows coverage — which is measured and
 * published — instead of moving the index.
 */
export async function collectDeviceObservations(
  keys: Record<string, string>,
  now: Date = new Date(),
): Promise<CollectResult> {
  const fetchedAt = now.toISOString();
  const warnings: string[] = [];

  const [metrics, card] = await Promise.all([
    fetchAllMetrics(keys, now),
    fetchBraketPriceCard().catch((e) => {
      warnings.push(`AWS price list unavailable: ${e instanceof Error ? e.message : e}`);
      return null;
    }),
  ]);

  const { matched, unregistered } = matchRegistry(metrics);
  const observations: DeviceObservation[] = [];
  const unpriced: string[] = [];

  for (const { entry, metric } of matched) {
    if (!entry.inBasket) {
      // Candidate devices are collected but never priced into the index.
      continue;
    }
    const resolved = resolvePrice(entry, card, fetchedAt);
    if (!resolved) {
      unpriced.push(entry.id);
      continue;
    }

    const qubits = Math.max(1, Math.floor(metric.capacity || 0));
    const error = errorFromFidelity(metric.fid2q);
    const priceCard = entry.braket && card ? priceFor(card, entry.braket.providerName, entry.braket.deviceName) : undefined;

    observations.push({
      id: entry.id,
      provider: entry.provider,
      device: entry.device,
      modality: entry.modality,
      region: entry.region,
      usState: entry.usState,
      euCountry: entry.euCountry,
      pricePerHour: resolved.price,
      priceBasis: resolved.basis,
      qubits: obs(qubits, {
        tier: "primary",
        source: `provider.${norm(entry.provider)}`,
        citation: `${entry.provider} control plane, device ${entry.device}`,
        observedAt: fetchedAt,
        fetchedAt,
        maxAgeDays: 7,
      }),
      twoQubitError: obs(error, {
        tier: "primary",
        source: `provider.${norm(entry.provider)}.calibration`,
        citation: `${entry.provider} published calibration for ${entry.device}`,
        observedAt: fetchedAt,
        fetchedAt,
        maxAgeDays: 7,
      }),
      // No vendor publishes a comparable layer rate, so this is a per-modality
      // constant. It is safe precisely because it never changes: a constant
      // cancels exactly in the index's log ratio (see tornqvist.ts).
      layerRate: obs(MODALITY_LAYER_RATE[entry.modality], {
        tier: "assumed",
        source: "qci.modality-layer-rate",
        citation: `Per-modality layer rate for ${entry.modality}; constant, cancels in the index ratio`,
        observedAt: fetchedAt,
        fetchedAt,
        maxAgeDays: 3650,
      }),
      online: {
        value: true,
        tier: "primary",
        source: `provider.${norm(entry.provider)}`,
        citation: `${entry.provider} reported ${entry.device} available`,
        observedAt: fetchedAt,
        fetchedAt,
        maxAgeDays: 2,
      },
      queueSeconds:
        typeof metric.queueSeconds === "number"
          ? obs(metric.queueSeconds, {
              tier: "primary",
              source: `provider.${norm(entry.provider)}`,
              observedAt: fetchedAt,
              fetchedAt,
              maxAgeDays: 2,
            })
          : undefined,
      pricePerShot:
        priceCard?.perShot != null && card
          ? priceObservation(card, priceCard.perShot, fetchedAt)
          : undefined,
      pricePerTask:
        priceCard?.perTask != null && card
          ? priceObservation(card, priceCard.perTask, fetchedAt)
          : undefined,
    });
  }

  const seen = new Set(observations.map((o) => o.id));
  const missing = REGISTRY.filter((r) => r.inBasket && !seen.has(r.id)).map((r) => r.id);

  if (unpriced.length > 0) {
    warnings.push(
      `No published hourly rate for: ${unpriced.join(", ")} — excluded from the headline index.`,
    );
  }
  if (unregistered.length > 0) {
    warnings.push(
      `Live devices not in the registry: ${[...new Set(unregistered.map((m) => `${m.provider}/${m.qpu}`))].join(", ")}`,
    );
  }

  return {
    observations,
    missing,
    unregistered: [...new Set(unregistered.map((m) => `${m.provider}/${m.qpu}`))],
    unpriced,
    priceCardVersion: card?.version ?? null,
    priceCardDate: card?.publicationDate ?? null,
    warnings,
  };
}

/**
 * Build observations from the public rate card plus each device's PUBLISHED
 * REFERENCE SPEC, with no provider credentials and no database.
 *
 * This exists purely so the attribution map can be inspected — and a
 * methodology change sanity-checked — before credentials are configured or the
 * migration is applied. It is wired only to the dry-run preview page and is
 * never reachable from the refresh path, because a spec sheet is not a
 * measurement: quality here is marked `published` tier, not `primary`, and
 * nothing it produces is ever persisted or published.
 */
export async function collectDryRun(now: Date = new Date()): Promise<CollectResult> {
  const fetchedAt = now.toISOString();
  const warnings = [
    "Dry run: hardware metrics come from published reference specs, not live provider telemetry.",
  ];

  const card = await fetchBraketPriceCard().catch((e) => {
    warnings.push(`AWS price list unavailable: ${e instanceof Error ? e.message : e}`);
    return null;
  });

  const observations: DeviceObservation[] = [];
  const unpriced: string[] = [];

  for (const entry of REGISTRY) {
    if (!entry.inBasket || !entry.referenceSpec) continue;
    const resolved = resolvePrice(entry, card, fetchedAt);
    if (!resolved) {
      unpriced.push(entry.id);
      continue;
    }
    const priceCard =
      entry.braket && card
        ? priceFor(card, entry.braket.providerName, entry.braket.deviceName)
        : undefined;
    const specObs = (value: number): Observation => ({
      value,
      tier: "published",
      source: "qci.reference-spec",
      citation: `Published reference specification for ${entry.provider} ${entry.device}`,
      observedAt: fetchedAt,
      fetchedAt,
      maxAgeDays: 3650,
    });

    observations.push({
      id: entry.id,
      provider: entry.provider,
      device: entry.device,
      modality: entry.modality,
      region: entry.region,
      usState: entry.usState,
      euCountry: entry.euCountry,
      pricePerHour: resolved.price,
      priceBasis: resolved.basis,
      qubits: specObs(entry.referenceSpec.qubits),
      twoQubitError: specObs(entry.referenceSpec.twoQubitError),
      layerRate: obs(MODALITY_LAYER_RATE[entry.modality], {
        tier: "assumed",
        source: "qci.modality-layer-rate",
        citation: `Per-modality layer rate for ${entry.modality}; constant, cancels in the index ratio`,
        observedAt: fetchedAt,
        fetchedAt,
        maxAgeDays: 3650,
      }),
      online: {
        value: true,
        tier: "published",
        source: "qci.reference-spec",
        observedAt: fetchedAt,
        fetchedAt,
        maxAgeDays: 3650,
      },
      pricePerShot:
        priceCard?.perShot != null && card
          ? priceObservation(card, priceCard.perShot, fetchedAt)
          : undefined,
      pricePerTask:
        priceCard?.perTask != null && card
          ? priceObservation(card, priceCard.perTask, fetchedAt)
          : undefined,
    });
  }

  return {
    observations,
    missing: [],
    unregistered: [],
    unpriced,
    priceCardVersion: card?.version ?? null,
    priceCardDate: card?.publicationDate ?? null,
    warnings,
  };
}
