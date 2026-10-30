/**
 * Sliding-window counter kept in memory. Enough for the single API instance this app runs on;
 * a multi-instance deployment would need a shared store (e.g. a table or Redis) instead.
 */
export function createLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  const recent = (key: string, now = Date.now()) => {
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  };

  return {
    /** Milliseconds until `key` may try again, or 0 if it isn't blocked. */
    retryAfter(key: string) {
      const list = recent(key);
      return list.length >= max ? windowMs - (Date.now() - list[list.length - max]) : 0;
    },
    hit(key: string) {
      const list = recent(key);
      list.push(Date.now());
      hits.set(key, list);
      if (hits.size > 10_000) for (const k of hits.keys()) recent(k); // drop stale keys
    },
    reset(key: string) {
      hits.delete(key);
    },
  };
}
