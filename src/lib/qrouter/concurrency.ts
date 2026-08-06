/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * A v2 job may carry up to 25 executions, each doing a full remote transpile
 * and an artifact upload. `Promise.all` over all of them at once is a 25x burst
 * against the Qiskit worker and object storage from a single request, which is
 * both a self-inflicted denial of service and an easy amplification primitive.
 *
 * Results keep the input order, and the first rejection propagates — matching
 * `Promise.all` so callers need no other change.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const bounded = Math.max(1, Math.floor(limit));
  if (items.length <= bounded) return Promise.all(items.map(worker));

  const results = new Array<R>(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: bounded }, run));
  return results;
}
