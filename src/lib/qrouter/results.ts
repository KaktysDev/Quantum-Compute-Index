type NumericMap = Record<string, number>;

export interface NormalizedResult extends Record<string, unknown> {
  counts: NumericMap;
  probabilities: NumericMap;
  shots: number;
  backend: string;
  metadata: Record<string, unknown> & { normalized: boolean };
}

function numericMap(value: unknown): NumericMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.some(([, item]) => typeof item !== "number" || !Number.isFinite(item))) return null;
  return Object.fromEntries(entries) as NumericMap;
}

function stateKey(state: string, width: number) {
  const clean = state.replace(/[|>\s]/g, "");
  return /^\d+$/.test(clean) && !/^[01]+$/.test(clean)
    ? Number(clean).toString(2).padStart(width, "0")
    : clean.padStart(width, "0");
}

function normalizedStates(values: NumericMap) {
  const width = Math.max(1, ...Object.keys(values).map((state) => {
    const clean = state.replace(/[|>\s]/g, "");
    return /^\d+$/.test(clean) && !/^[01]+$/.test(clean) ? Number(clean).toString(2).length : clean.length;
  }));
  return Object.fromEntries(Object.entries(values).map(([state, value]) => [stateKey(state, width), value]));
}

function probabilitiesToCounts(probabilities: NumericMap, shots: number) {
  const entries = Object.entries(probabilities).map(([state, probability]) => {
    const exact = Math.max(0, probability) * shots;
    return { state, count: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = shots - entries.reduce((sum, item) => sum + item.count, 0);
  entries.sort((a, b) => b.remainder - a.remainder);
  for (let index = 0; remaining > 0 && entries.length; index = (index + 1) % entries.length, remaining--) entries[index].count++;
  return Object.fromEntries(entries.map(({ state, count }) => [state, count]));
}

export function normalizeProviderResult(backendId: string, result: Record<string, unknown> | undefined, expectedShots: number): NormalizedResult {
  const payload = result ?? {};
  const countsSource = numericMap(payload.counts) ?? numericMap(payload.measurementCounts);
  const probabilitySource = numericMap(payload.probabilities)
    ?? numericMap(payload.measurementProbabilities)
    ?? numericMap(payload.quasiDistribution)
    ?? (Array.isArray(payload.quasi_dists) ? numericMap(payload.quasi_dists[0]) : null);
  const counts = countsSource ? normalizedStates(countsSource) : null;
  const shots = Number(payload.shots) > 0 ? Number(payload.shots) : counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : expectedShots;
  const probabilities = probabilitySource
    ? normalizedStates(probabilitySource)
    : counts && shots > 0 ? Object.fromEntries(Object.entries(counts).map(([state, count]) => [state, count / shots])) : null;
  const normalizedCounts = counts ?? (probabilities ? probabilitiesToCounts(probabilities, shots) : {});

  return {
    counts: normalizedCounts,
    probabilities: probabilities ?? {},
    shots,
    backend: backendId,
    metadata: {
      ...(payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata) ? payload.metadata : {}),
      normalized: Boolean(counts || probabilities),
      ...(!counts && !probabilities ? { providerResult: payload } : {}),
    },
  };
}
