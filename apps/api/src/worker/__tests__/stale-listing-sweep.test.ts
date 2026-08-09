import type { Pool, QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  STALE_SWEEP_MAX_PAUSE_RATIO,
  runStaleListingSweep,
  type StaleSweepResult
} from "../stale-listing-sweep";

function result<T>(rows: T[]): QueryResult<T & Record<string, unknown>> {
  return {
    command: "SELECT",
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows: rows as Array<T & Record<string, unknown>>
  };
}

/**
 * Pool double. `census` drives the count query; `pausable` is what the UPDATE
 * would return if it ran. Every statement is recorded so a test can assert that
 * the UPDATE never fired.
 */
function createPool(census: { active: number; stale: number }, pausable: string[] = []) {
  const queries: string[] = [];
  const pool = {
    query: vi.fn(async (text: string) => {
      queries.push(text);
      if (text.includes("active_count")) {
        return result([{ active_count: census.active, stale_count: census.stale }]);
      }
      if (text.includes("UPDATE listings")) {
        return result(pausable.map((id) => ({ id })));
      }
      return result([]);
    })
  } as unknown as Pool;
  return { pool, queries };
}

const ON = { ff_stale_listing_sweep: true };
const OFF = { ff_stale_listing_sweep: false };

function didPause(queries: string[]): boolean {
  return queries.some((q) => q.includes("UPDATE listings"));
}

describe("runStaleListingSweep", () => {
  it("does nothing when the flag is off", async () => {
    const { pool, queries } = createPool({ active: 100, stale: 90 });

    const res: StaleSweepResult = await runStaleListingSweep(pool, OFF);

    expect(res.skipped).toBe("flag_off");
    expect(res.paused).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it("pauses stale listings when the batch is within the cap", async () => {
    const { pool, queries } = createPool({ active: 100, stale: 4 }, ["a", "b", "c", "d"]);

    const res = await runStaleListingSweep(pool, ON);

    expect(res.skipped).toBeNull();
    expect(res.paused).toBe(4);
    expect(didPause(queries)).toBe(true);
  });

  // The 2026-08-09 outage: one run paused effectively the whole catalogue,
  // emptying search and 404-ing every listing detail page.
  it("aborts without pausing anything when the batch exceeds the cap", async () => {
    const { pool, queries } = createPool({ active: 95, stale: 93 }, []);

    const res = await runStaleListingSweep(pool, ON);

    expect(res.skipped).toBe("cap_exceeded");
    expect(res.paused).toBe(0);
    expect(res.candidates).toBe(93);
    expect(didPause(queries)).toBe(false);
  });

  it("caps at the configured ratio of active inventory", async () => {
    const { pool } = createPool({ active: 100, stale: 0 });

    const res = await runStaleListingSweep(pool, ON);

    expect(res.cap).toBe(Math.floor(100 * STALE_SWEEP_MAX_PAUSE_RATIO));
  });

  // A tiny catalogue must still be able to pause its one genuinely dead listing,
  // rather than deadlocking because 10% of 5 rounds down to zero.
  it("always allows at least one listing through on small catalogues", async () => {
    const { pool, queries } = createPool({ active: 5, stale: 1 }, ["a"]);

    const res = await runStaleListingSweep(pool, ON);

    expect(res.cap).toBe(1);
    expect(res.paused).toBe(1);
    expect(didPause(queries)).toBe(true);
  });

  it("skips the update entirely when nothing is stale", async () => {
    const { pool, queries } = createPool({ active: 100, stale: 0 });

    const res = await runStaleListingSweep(pool, ON);

    expect(res.paused).toBe(0);
    expect(res.skipped).toBeNull();
    expect(didPause(queries)).toBe(false);
  });

  // The cap must be enforced by the statement itself, not merely checked before
  // it — otherwise a listing going stale between the census and the UPDATE can
  // push the batch over the limit.
  it("bounds the update statement by the cap", async () => {
    const { pool } = createPool({ active: 100, stale: 4 }, ["a", "b", "c", "d"]);

    await runStaleListingSweep(pool, ON);

    const update = (pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => String(call[0]).includes("UPDATE listings")
    );
    expect(String(update?.[0])).toMatch(/LIMIT \$1/);
    expect(update?.[1]).toEqual([10]);
  });

  it("records a fraud flag for every paused listing", async () => {
    const { pool, queries } = createPool({ active: 100, stale: 2 }, ["a", "b"]);

    await runStaleListingSweep(pool, ON);

    expect(queries.filter((q) => q.includes("INSERT INTO fraud_flags"))).toHaveLength(2);
  });
});
