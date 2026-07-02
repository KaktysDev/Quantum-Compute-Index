// Provider registry + aggregate metric pulling.

import type { RawQpuMetrics } from "@/lib/qci/types";
import { braket } from "./braket";
import { ibm } from "./ibm";
import { iqm } from "./iqm";
import { quandela } from "./quandela";
import { quantumInspire } from "./quantumInspire";
import type { ProviderAdapter, ProviderDefinition, ProviderId } from "./types";
import { xanadu } from "./xanadu";

export const PROVIDERS: ProviderAdapter[] = [
  ibm,
  braket,
  iqm,
  xanadu,
  quandela,
  quantumInspire,
];

/** Public, key-free metadata for rendering the Settings page. */
export const PROVIDER_DEFINITIONS: ProviderDefinition[] = PROVIDERS.map(
  ({ id, name, description, docsUrl, keyPlaceholder, covers, fields, testable }) => ({
    id,
    name,
    description,
    docsUrl,
    keyPlaceholder,
    covers,
    fields,
    testable,
  }),
);

export function getProvider(id: string): ProviderAdapter | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export function isProviderId(id: string): id is ProviderId {
  return PROVIDERS.some((p) => p.id === id);
}

/**
 * Pull metrics from every enabled provider that has a key.
 * `keys` maps providerId → decrypted API key.
 */
export async function fetchAllMetrics(
  keys: Record<string, string>,
  date: Date = new Date(),
): Promise<RawQpuMetrics[]> {
  const results = await Promise.all(
    PROVIDERS.map(async (p) => {
      const key = keys[p.id];
      if (!key) return [];
      try {
        return await p.fetchMetrics(key, date);
      } catch (err) {
        console.error(`[providers] ${p.id} fetch failed:`, err);
        return [];
      }
    }),
  );
  return results.flat();
}

export type { ProviderAdapter, ProviderDefinition, ProviderId } from "./types";
