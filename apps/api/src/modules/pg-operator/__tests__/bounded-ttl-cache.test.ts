import { describe, it, expect } from "vitest";
import { BoundedTtlCache } from "../services/bounded-ttl-cache";

describe("BoundedTtlCache", () => {
  it("returns a stored value within TTL", () => {
    const c = new BoundedTtlCache<number>(10, 1000, () => 0);
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
  });

  it("expires + frees an entry once older than ttl (lazy, on read)", () => {
    let t = 0;
    const c = new BoundedTtlCache<number>(10, 1000, () => t);
    c.set("a", 1);
    t = 1000; // exactly ttl → expired
    expect(c.get("a")).toBeUndefined();
    expect(c.size).toBe(0); // freed, not lingering
  });

  it("never exceeds max — evicts the least-recently-used key (PERF-H4 bound)", () => {
    const c = new BoundedTtlCache<number>(2, 10_000, () => 0);
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3); // over max → oldest ("a") evicted
    expect(c.size).toBe(2);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });

  it("a read bumps recency so the bumped key survives eviction", () => {
    let t = 0;
    const c = new BoundedTtlCache<number>(2, 10_000, () => t);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1); // bump "a" to newest; "b" now oldest
    c.set("c", 3); // evicts oldest → "b"
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });
});
