import type { RawQpuMetrics } from "@/lib/qci/types";

export type ProviderId =
  | "ibm"
  | "braket"
  | "ionq"
  | "iqm"
  | "xanadu"
  | "quandela"
  | "quantum-inspire";

/** A single credential input (for providers that need more than one value, e.g. AWS). */
export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
}

/** Static, public-facing description of a provider (shown in Settings). */
export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  /** One-line description shown under the provider in Settings. */
  description: string;
  /** Where to obtain an API key. */
  docsUrl: string;
  /** Placeholder shown in the (single) key input. */
  keyPlaceholder: string;
  /** QPUs this provider contributes to the index. */
  covers: string[];
  /**
   * Multi-field credentials. When present the Settings form renders these inputs
   * and stores them as an encrypted JSON object. Omit for a single key.
   */
  fields?: CredentialField[];
  /** Whether a "Test connection" button is shown (adapter implements testConnection). */
  testable?: boolean;
}

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  /** Human-readable lines (e.g. discovered devices). */
  details?: string[];
}

/** A provider adapter: definition + functions to pull/verify its data. */
export interface ProviderAdapter extends ProviderDefinition {
  /**
   * Fetch normalized-ready raw metrics for this provider's QPUs.
   * `apiKey` is the decrypted secret — a plain token for single-key providers,
   * or a JSON string of the credential fields for multi-field providers.
   */
  fetchMetrics(apiKey: string, date?: Date): Promise<RawQpuMetrics[]>;
  /** Optional: verify the credentials work and report what was found. */
  testConnection?(apiKey: string): Promise<ProviderTestResult>;
}
