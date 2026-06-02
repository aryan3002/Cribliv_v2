import { describe, it, expect, vi } from "vitest";
import { PgScoreService } from "../src/modules/pg-operator/services/pg-score.service";
import type { PgListingPayload } from "../../packages/shared-types/src/pg-operator";
import type { PgScoreSignals } from "../../packages/shared-types/src/pg-listing-score";

const basePaylod: PgListingPayload = {
  property: { display_name: "Sunshine PG", city_slug: "delhi" },
  pg_details: { total_beds: 5, gender_policy: "boys", tenant_type: "students" },
  room_types: [
    {
      sharing: "double",
      ac: false,
      monthly_rent_paise: 1000000,
      vacancy_count: 2,
      security_deposit_paise: 500000
    }
  ]
} as any;

const baseSignals: PgScoreSignals = {
  verification_status: "unverified",
  has_exact_geo: true,
  photo_count: 4
};

function makeService(dbEnabled = true) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    isEnabled: () => dbEnabled,
    query: vi.fn(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [], rowCount: 0 };
    })
  };
  const svc = new PgScoreService(db as never);
  return { svc, queries, db };
}

describe("PgScoreService", () => {
  it("compute returns a PgScoreResult with correct structure", () => {
    const { svc } = makeService();
    const result = svc.compute(basePaylod, baseSignals);
    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(100);
    expect(result.factors).toHaveLength(7);
    expect(result.factors.every((f) => f.weight > 0)).toBe(true);
  });

  it("recordScore UPSERTs listing_scores when db is enabled", async () => {
    const { svc, queries } = makeService(true);
    const result = await svc.recordScore("abc-123", basePaylod, baseSignals);
    expect(result.composite).toBeGreaterThan(0);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toMatch(/INSERT INTO listing_scores/);
    expect(queries[0].sql).toMatch(/ON CONFLICT \(listing_id\)/);
    // first param is the listing id
    expect(queries[0].params[0]).toBe("abc-123");
    // composite_score = composite / 100 (REAL 0..1)
    const compositeArg = queries[0].params[5] as number;
    expect(compositeArg).toBeCloseTo(result.composite / 100, 2);
  });

  it("recordScore skips DB write when db disabled", async () => {
    const { svc, queries } = makeService(false);
    const result = await svc.recordScore("abc-123", basePaylod, baseSignals);
    expect(result.composite).toBeGreaterThan(0);
    expect(queries).toHaveLength(0);
  });

  it("recordScore maps has_exact_geo=true to higher geo_precision factor", async () => {
    const { svc } = makeService(false);
    const a = await svc.recordScore("x", basePaylod, { ...baseSignals, has_exact_geo: false });
    const b = await svc.recordScore("x", basePaylod, { ...baseSignals, has_exact_geo: true });
    expect(b.composite).toBeGreaterThan(a.composite);
  });
});
