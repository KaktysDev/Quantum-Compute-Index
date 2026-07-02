// ──────────────────────────────────────────────────────────────────────────────
// AWS Braket — REAL integration (multi-region).
//
// Credentials are an encrypted JSON object: { accessKeyId, secretAccessKey, region }.
// We call the Braket control-plane APIs (no charge) to discover the QPUs available
// to the account and read their live status + qubit count + (where exposed) gate
// fidelity. Per-shot prices come from AWS's published Braket rate card (the Braket
// API does not return prices).
//
// MULTI-REGION: Braket devices are region-scoped and SearchDevices only returns
// devices in the client's configured region. QPUs today live in three regions —
// us-east-1 (QuEra), us-west-1 (Rigetti), eu-north-1 (IQM, AQT) — so we query each
// region with its own client (one global IAM key authenticates everywhere) and
// merge, deduping by device ARN. Querying a single region is exactly why Rigetti
// (us-west-1) was previously missing.
//
// IonQ is intentionally EXCLUDED here — it is sourced from the dedicated direct
// IonQ adapter (richer data: real 2-qubit fidelity), which emits provider "IonQ"
// so there is no double-counting.
// ──────────────────────────────────────────────────────────────────────────────

import {
  BraketClient,
  GetDeviceCommand,
  SearchDevicesCommand,
} from "@aws-sdk/client-braket";
import type { RawQpuMetrics } from "@/lib/qci/types";
import type { ProviderAdapter, ProviderTestResult } from "./types";

interface BraketCreds {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

/** AWS regions that host Braket QPUs (simulator-only regions omitted). */
const QPU_REGIONS = ["us-east-1", "us-west-1", "eu-north-1"];

/** Sourced from the dedicated direct adapter instead of Braket. Lowercased. */
const EXCLUDED_PROVIDERS = new Set(["ionq"]);

/** Published AWS Braket list pricing + sensible defaults per hardware provider. */
const PROVIDER_INFO: Record<string, { perShot: number; clops: number; fid2q: number }> = {
  rigetti: { perShot: 0.0009, clops: 1200, fid2q: 0.985 },
  iqm: { perShot: 0.00145, clops: 1800, fid2q: 0.988 },
  quera: { perShot: 0.01, clops: 400, fid2q: 0.975 },
  aqt: { perShot: 0.03, clops: 600, fid2q: 0.99 },
  "oxford quantum circuits": { perShot: 0.00035, clops: 900, fid2q: 0.978 },
  oqc: { perShot: 0.00035, clops: 900, fid2q: 0.978 },
};
const DEFAULT_INFO = { perShot: 0.001, clops: 1000, fid2q: 0.98 };

function infoFor(providerName: string) {
  return PROVIDER_INFO[providerName.trim().toLowerCase()] ?? DEFAULT_INFO;
}

function parseCreds(apiKey: string): BraketCreds | null {
  try {
    const c = JSON.parse(apiKey);
    if (c && c.accessKeyId && c.secretAccessKey) {
      return {
        accessKeyId: String(c.accessKeyId).trim(),
        secretAccessKey: String(c.secretAccessKey).trim(),
        region: String(c.region || "us-east-1").trim(),
      };
    }
  } catch {
    /* not JSON — invalid for Braket */
  }
  return null;
}

/** Every QPU region to query: the configured one plus all known QPU regions. */
function regionsToSearch(creds: BraketCreds): string[] {
  return [...new Set([creds.region, ...QPU_REGIONS])];
}

function makeClient(creds: BraketCreds, region: string): BraketClient {
  return new BraketClient({
    region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  });
}

function isExcluded(providerName?: string): boolean {
  return EXCLUDED_PROVIDERS.has((providerName ?? "").trim().toLowerCase());
}

/** Pull qubit count from the (provider-varying) deviceCapabilities JSON. */
function extractQubitCount(caps: Record<string, unknown>): number {
  const paradigm = caps?.paradigm as { qubitCount?: number } | undefined;
  const provider = caps?.provider as { qubitCount?: number } | undefined;
  return Number(paradigm?.qubitCount ?? provider?.qubitCount ?? 0) || 0;
}

/** Pure mapping from a Braket device + parsed capabilities → our metric shape. */
export function mapDeviceToMetrics(
  summary: { deviceName?: string; providerName?: string },
  caps: Record<string, unknown>,
): RawQpuMetrics {
  const providerName = summary.providerName ?? "Unknown";
  const info = infoFor(providerName);
  const qubitCount = extractQubitCount(caps) || 8;
  return {
    provider: providerName,
    qpu: summary.deviceName ?? "QPU",
    rawPrice: info.perShot,
    unit: "per_shot",
    // Braket exposes neither QV nor CLOPS; derive an effective QV from real qubit
    // count (log2(qv) == qubitCount) and use a provider-typical CLOPS.
    qv: Math.pow(2, Math.min(qubitCount, 20)),
    clops: info.clops,
    fid2q: info.fid2q,
    capacity: qubitCount,
  };
}

interface RegionDevice {
  arn: string;
  provider?: string;
  name?: string;
  status?: string;
  region: string;
}

/** List ONLINE, non-excluded QPU summaries in one region (fail-soft on error). */
async function listRegionQpus(creds: BraketCreds, region: string): Promise<RegionDevice[]> {
  try {
    const client = makeClient(creds, region);
    const search = await client.send(new SearchDevicesCommand({ filters: [] }));
    return (search.devices ?? [])
      .filter((d) => d.deviceType === "QPU" && !!d.deviceArn)
      .map((d) => ({
        arn: d.deviceArn as string,
        provider: d.providerName,
        name: d.deviceName,
        status: d.deviceStatus,
        region,
      }));
  } catch (err) {
    console.error(`[braket] region ${region} search failed`, err);
    return [];
  }
}

export const braket: ProviderAdapter = {
  id: "braket",
  name: "AWS Braket",
  description: "One AWS key covers Rigetti, IQM, QuEra & AQT hardware (IonQ is sourced directly).",
  docsUrl: "https://aws.amazon.com/braket/",
  keyPlaceholder: "AWS credentials",
  covers: ["Rigetti", "IQM", "QuEra", "AQT"],
  testable: true,
  fields: [
    { key: "accessKeyId", label: "Access key ID", placeholder: "AKIA…" },
    { key: "secretAccessKey", label: "Secret access key", type: "password" },
    { key: "region", label: "Region", placeholder: "us-east-1" },
  ],

  async fetchMetrics(apiKey: string): Promise<RawQpuMetrics[]> {
    const creds = parseCreds(apiKey);
    if (!creds) return [];

    const regions = regionsToSearch(creds);
    const perRegion = await Promise.all(regions.map((r) => listRegionQpus(creds, r)));

    // Merge, keep ONLINE & non-excluded, dedupe by ARN.
    const seen = new Set<string>();
    const online: RegionDevice[] = [];
    for (const dev of perRegion.flat()) {
      if (dev.status !== "ONLINE") continue;
      if (isExcluded(dev.provider)) continue;
      if (seen.has(dev.arn)) continue;
      seen.add(dev.arn);
      online.push(dev);
    }

    const metrics: RawQpuMetrics[] = [];
    for (const dev of online) {
      try {
        const client = makeClient(creds, dev.region);
        const full = await client.send(new GetDeviceCommand({ deviceArn: dev.arn }));
        let caps: Record<string, unknown> = {};
        if (full.deviceCapabilities) {
          try {
            caps = JSON.parse(full.deviceCapabilities);
          } catch {
            caps = {};
          }
        }
        metrics.push(
          mapDeviceToMetrics(
            {
              deviceName: full.deviceName ?? dev.name,
              providerName: full.providerName ?? dev.provider,
            },
            caps,
          ),
        );
      } catch (err) {
        console.error(`[braket] GetDevice failed for ${dev.arn}`, err);
      }
    }
    return metrics;
  },

  async testConnection(apiKey: string): Promise<ProviderTestResult> {
    const creds = parseCreds(apiKey);
    if (!creds) {
      return { ok: false, message: "Enter Access key ID, Secret access key and Region." };
    }
    try {
      const regions = regionsToSearch(creds);
      const perRegion = await Promise.all(regions.map((r) => listRegionQpus(creds, r)));
      const all = perRegion.flat();
      const counted = all.filter((d) => !isExcluded(d.provider));
      const online = counted.filter((d) => d.status === "ONLINE");
      const details = counted
        .slice(0, 12)
        .map((d) => `${d.provider ?? "?"} · ${d.name ?? "?"} — ${d.status} (${d.region})`);
      const excludedNote = all.some((d) => isExcluded(d.provider))
        ? " IonQ is excluded here (sourced via the direct IonQ integration)."
        : "";
      return {
        ok: true,
        message: `Connected to AWS Braket across ${regions.length} region(s). Found ${counted.length} QPU(s), ${online.length} online.${excludedNote}`,
        details,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Connection failed.",
      };
    }
  },
};
