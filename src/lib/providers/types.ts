import type { RawQpuMetrics } from "@/lib/qci/types";

export type ProviderId =
  | "ibm"
  | "braket"
  | "xanadu"
  | "quandela"
  | "quantum-inspire";

/** Static, public-facing description of a provider (shown in Settings). */
export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  /** One-line description shown under the provider in Settings. */
  description: string;
  /** Where to obtain an API key. */
  docsUrl: string;
  /** Placeholder shown in the key input. */
  keyPlaceholder: string;
  /** QPUs this provider contributes to the index. */
  covers: string[];
}

/** A provider adapter: definition + a function to pull its metrics. */
export interface ProviderAdapter extends ProviderDefinition {
  /**
   * Fetch normalized-ready raw metrics for this provider's QPUs.
   *
   * SCAFFOLD: real provider APIs do not expose QV/CLOPS/queue via a single key,
   * so today this returns the benchmark defaults (with small deterministic daily
   * drift) whenever a key is present — making the pipeline genuinely "live" the
   * moment a key is saved. Replace the body with real API calls per provider.
   */
  fetchMetrics(apiKey: string, date?: Date): Promise<RawQpuMetrics[]>;
}
