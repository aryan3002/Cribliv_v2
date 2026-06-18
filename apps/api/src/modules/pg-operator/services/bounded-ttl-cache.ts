/**
 * Bounded, TTL'd cache backed by a Map (insertion order = LRU recency order).
 *
 * Replaces a raw `Map` that only gated freshness and never freed memory
 * (PERF-H4): an expired entry lingered until overwritten and there was no size
 * cap, so every operator who ever loaded the dashboard pinned a full payload →
 * unbounded growth → OOM at scale.
 *
 * Eviction happens two ways:
 *  - lazily on read when an entry is older than `ttlMs` (frees stale memory), and
 *  - on write when `size > max` (evicts the least-recently-used key, the oldest
 *    in Map insertion order).
 *
 * `now` is injectable for deterministic tests; defaults to Date.now so callers
 * relying on fake timers (vi.advanceTimersByTime) still work unchanged.
 */
export class BoundedTtlCache<V> {
  private readonly map = new Map<string, { at: number; value: V }>();

  constructor(
    private readonly max: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at >= this.ttlMs) {
      this.map.delete(key); // expired → free it now, don't wait for overwrite
      return undefined;
    }
    // Refresh recency: re-insert so this key becomes the newest (LRU bump).
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key); // ensure re-insert lands at the newest position
    this.map.set(key, { at: this.now(), value });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}
