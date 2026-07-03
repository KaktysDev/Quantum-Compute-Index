// ──────────────────────────────────────────────────────────────────────────────
// Provider carry-forward ("last known good").
//
// When a refresh can't pull a provider's live data (the provider is offline or the
// API call fails), dropping it would change the basket and CRASH the VWAP — it
// would look like the price of a quantum-compute hour moved, when really a feed
// just went dark. Instead we reuse that provider's metrics from the previous
// snapshot and keep doing so on every refresh until the provider comes back.
//
// The "saved" data is simply the previous snapshot's `components` (already stored
// in qci_snapshots.components), so no extra storage is needed — each snapshot is
// the running record of last-known-good per provider.
// ──────────────────────────────────────────────────────────────────────────────

import { collapseOnePerProvider } from "./compute";
import type { ProviderDataStatus, QpuComponent, RawQpuMetrics } from "./types";

/**
 * Provider display names each adapter can emit. Used only to decide whether a
 * missing provider should be carried forward (its key is still enabled → it's
 * offline) or dropped (its key was removed → stop pinning stale data). Unknown
 * names are carried forward by default (protection-first).
 */
const ADAPTER_PROVIDER_NAMES: Record<string, string[]> = {
  ibm: ["IBM"],
  ionq: ["IonQ"],
  iqm: ["IQM"],
  quandela: ["Quandela"],
  xanadu: ["Xanadu"],
  "quantum-inspire": ["Quantum Inspire"],
  braket: ["Rigetti", "IQM", "QuEra", "AQT", "OQC", "Oxford Quantum Circuits"],
};

const ALL_OWNED_PROVIDERS = new Set(Object.values(ADAPTER_PROVIDER_NAMES).flat());

/**
 * Reconstruct raw metrics from a stored (already-normalized) component so it can
 * be re-fed to the index unchanged. Using unit "per_nqh" with rawPrice = the
 * stored price-per-NQH makes normalization a no-op, so the provider's price and
 * quality metrics come through identical to the day they were last live.
 */
export function componentToRaw(c: QpuComponent): RawQpuMetrics {
  const capacity =
    typeof c.capacity === "number" && c.capacity > 0
      ? c.capacity
      : Math.max(1, Math.round(Math.log2(Math.max(2, c.qv))));
  return {
    provider: c.provider,
    qpu: c.qpu,
    rawPrice: c.pricePerNqh,
    unit: "per_nqh",
    qv: c.qv,
    clops: c.clops,
    fid2q: c.fid2q,
    capacity,
    queueSeconds: c.queueSeconds,
  };
}

export interface CarryForwardResult {
  /** Live metrics plus carried-forward metrics for offline providers. */
  metrics: RawQpuMetrics[];
  /** provider display name → "active" (fresh) | "stale" (carried forward). */
  statusByProvider: Record<string, ProviderDataStatus>;
}

/**
 * Merge this refresh's live metrics with carried-forward data for any provider
 * present in the previous snapshot but missing now. A provider is only carried if
 * an enabled key could still produce it (so removing a key drops its provider
 * instead of pinning stale data forever); unknown provider names are carried
 * defensively.
 */
export function mergeWithCarryForward(
  live: RawQpuMetrics[],
  previousComponents: QpuComponent[],
  enabledAdapterIds: string[],
): CarryForwardResult {
  const liveProviders = new Set(collapseOnePerProvider(live).map((m) => m.provider));
  const statusByProvider: Record<string, ProviderDataStatus> = {};
  for (const p of liveProviders) statusByProvider[p] = "active";

  const expected = new Set<string>();
  for (const id of enabledAdapterIds) {
    for (const name of ADAPTER_PROVIDER_NAMES[id] ?? []) expected.add(name);
  }

  // One previous component per provider (they're already collapsed, but be safe).
  const prevByProvider = new Map<string, QpuComponent>();
  for (const c of previousComponents) {
    if (c && c.provider && !prevByProvider.has(c.provider)) prevByProvider.set(c.provider, c);
  }

  const carried: RawQpuMetrics[] = [];
  for (const [provider, comp] of prevByProvider) {
    if (liveProviders.has(provider)) continue; // fresh data exists → nothing to carry
    // Drop only when a known provider's key is clearly gone (owned but not enabled).
    const keyRemoved = ALL_OWNED_PROVIDERS.has(provider) && !expected.has(provider);
    if (keyRemoved) continue;
    carried.push(componentToRaw(comp));
    statusByProvider[provider] = "stale";
  }

  return { metrics: [...live, ...carried], statusByProvider };
}
