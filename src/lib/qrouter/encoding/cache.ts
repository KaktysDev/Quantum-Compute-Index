/**
 * Tiny insertion-order LRU used by the encoding compose path.
 * Compile / parse / profile caches share this so eviction stays consistent.
 */

export function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const value = map.get(key);
  if (value === undefined) return undefined;
  map.delete(key);
  map.set(key, value);
  return value;
}

export function lruSet<K, V>(map: Map<K, V>, key: K, value: V, max: number): V {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
  return value;
}
