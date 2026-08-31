import { decodeProviderResult, resultSetToNormalized } from "./encoding/decode";
import type { DecodeMap } from "./encoding/types";

type NumericMap = Record<string, number>;

export interface NormalizedResult extends Record<string, unknown> {
  counts: NumericMap;
  probabilities: NumericMap;
  shots: number;
  backend: string;
  metadata: Record<string, unknown> & { normalized: boolean };
}

export function normalizeProviderResult(
  backendId: string,
  result: Record<string, unknown> | undefined,
  expectedShots: number,
  decodeMap?: DecodeMap,
): NormalizedResult {
  const payload = result ?? {};
  const decoded = decodeProviderResult({ backendId, raw: payload, expectedShots, decodeMap });
  const normalized = resultSetToNormalized(decoded, expectedShots);
  const hasData = decoded.data.length > 0;
  return {
    ...normalized,
    metadata: {
      ...(payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : {}),
      ...normalized.metadata,
      normalized: hasData,
      ...(!hasData ? { providerResult: payload } : {}),
    },
  };
}
