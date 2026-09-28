/** Least-recently-used cache bounded by total bytes and entry count. `touch` refreshes recency without reading. */
export interface CacheStats { entries: number; bytes: number; maxBytes: number; maxEntries: number; hits: number; misses: number; evictions: number }

export class LruByteCache<K, V> {
  #map = new Map<K, { value: V; bytes: number }>();
  #bytes = 0;
  #hits = 0;
  #misses = 0;
  #evictions = 0;
  constructor(readonly maxBytes: number, readonly maxEntries = Number.POSITIVE_INFINITY, readonly onEvict?: (key: K, value: V) => void) {
    if (!(maxBytes > 0)) throw new Error("maxBytes must be positive");
  }
  get size() { return this.#map.size; }
  get bytes() { return this.#bytes; }
  has(key: K) { return this.#map.has(key); }
  get(key: K): V | undefined {
    const e = this.#map.get(key);
    if (!e) { this.#misses++; return undefined; }
    this.#hits++;
    this.#map.delete(key);
    this.#map.set(key, e);
    return e.value;
  }
  /** Read without changing recency or hit statistics. */
  peek(key: K): V | undefined { return this.#map.get(key)?.value; }
  /** Mark as most recently used; returns false when absent. */
  touch(key: K) {
    const e = this.#map.get(key);
    if (!e) return false;
    this.#map.delete(key);
    this.#map.set(key, e);
    return true;
  }
  /** Insert or replace. An entry bigger than the whole budget is rejected (returns false) rather than flushing everything. */
  set(key: K, value: V, bytes: number) {
    if (!(bytes >= 0) || bytes > this.maxBytes) return false;
    this.delete(key, false);
    this.#map.set(key, { value, bytes });
    this.#bytes += bytes;
    while (this.#bytes > this.maxBytes || this.#map.size > this.maxEntries) {
      const oldest = this.#map.keys().next().value as K;
      this.delete(oldest, true);
      this.#evictions++;
    }
    return true;
  }
  delete(key: K, notify = true) {
    const e = this.#map.get(key);
    if (!e) return false;
    this.#map.delete(key);
    this.#bytes -= e.bytes;
    if (notify) this.onEvict?.(key, e.value);
    return true;
  }
  clear() { for (const k of [...this.#map.keys()]) this.delete(k, true); }
  keys() { return [...this.#map.keys()]; }
  stats(): CacheStats {
    return { entries: this.#map.size, bytes: this.#bytes, maxBytes: this.maxBytes, maxEntries: this.maxEntries, hits: this.#hits, misses: this.#misses, evictions: this.#evictions };
  }
}
