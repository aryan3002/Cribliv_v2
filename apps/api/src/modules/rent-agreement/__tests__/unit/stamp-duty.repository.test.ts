import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAMP_DUTY_SEED,
  StampDutyRepository,
  type StampDutyRule
} from "../../stamp-duty/stamp-duty.repository";

interface StubDb {
  readonly calls: number;
  isEnabled: () => boolean;
  query: (text: string, params: unknown[]) => Promise<{ rows: StampDutyRule[] }>;
}

function stubDb(rows: StampDutyRule[] = STAMP_DUTY_SEED, enabled = true): StubDb {
  const state = { calls: 0 };
  return {
    get calls() {
      return state.calls;
    },
    isEnabled: () => enabled,
    query: async (_text: string, params: unknown[]) => {
      state.calls += 1;
      const code = String(params[0]);
      return { rows: rows.filter((r) => r.state_code === code) };
    }
  };
}

describe("StampDutyRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the seeded rule for KA when DB is enabled", async () => {
    const db = stubDb();
    const repo = new StampDutyRepository(db);
    const rule = await repo.findActiveRule("KA");
    expect(rule?.state_code).toBe("KA");
    expect(rule?.formula_type).toBe("percentage_of_annual_rent");
    expect(rule?.percentage).toBeCloseTo(0.01);
  });

  it("falls back to STAMP_DUTY_SEED when DB is disabled", async () => {
    const db = stubDb([], false);
    const repo = new StampDutyRepository(db);
    const rule = await repo.findActiveRule("MH");
    expect(rule?.state_code).toBe("MH");
    expect(rule?.includes_deposit).toBe(true);
  });

  it("returns null for unknown state", async () => {
    const db = stubDb();
    const repo = new StampDutyRepository(db);
    expect(await repo.findActiveRule("XX")).toBeNull();
  });

  it("caches lookups for 5 minutes (no second DB call inside TTL)", async () => {
    const db = stubDb();
    const repo = new StampDutyRepository(db);
    await repo.findActiveRule("KA");
    await repo.findActiveRule("KA");
    await repo.findActiveRule("KA");
    expect(db.calls).toBe(1);
  });

  it("refreshes after the 5-minute TTL expires", async () => {
    const db = stubDb();
    const repo = new StampDutyRepository(db);
    await repo.findActiveRule("KA");
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await repo.findActiveRule("KA");
    expect(db.calls).toBe(2);
  });

  it("bustCache() forces the next lookup to refetch", async () => {
    const db = stubDb();
    const repo = new StampDutyRepository(db);
    await repo.findActiveRule("KA");
    repo.bustCache();
    await repo.findActiveRule("KA");
    expect(db.calls).toBe(2);
  });

  it("bustCache(stateCode) only clears that state", async () => {
    const db = stubDb();
    const repo = new StampDutyRepository(db);
    await repo.findActiveRule("KA");
    await repo.findActiveRule("MH");
    repo.bustCache("KA");
    await repo.findActiveRule("KA"); // refetch
    await repo.findActiveRule("MH"); // cached
    expect(db.calls).toBe(3); // 2 initial + 1 KA refetch
  });

  it("STAMP_DUTY_SEED covers all 8 supported states", () => {
    const codes = STAMP_DUTY_SEED.map((r) => r.state_code).sort();
    expect(codes).toEqual(["DL", "GJ", "HR", "KA", "MH", "RJ", "TN", "UP"]);
  });
});
