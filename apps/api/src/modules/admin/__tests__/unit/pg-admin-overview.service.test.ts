import { describe, it, expect, vi } from "vitest";
import { PgAdminAnalyticsService } from "../../pg-admin-analytics.service";
import type { DatabaseService } from "../../../../common/database.service";
import type { PgFunnelService } from "../../../pg-operator/services/pg-funnel.service";

function setup(dbEnabled = true) {
  const query = vi.fn();
  const db = { isEnabled: () => dbEnabled, query } as unknown as DatabaseService;
  const funnel = {} as unknown as PgFunnelService;
  return { svc: new PgAdminAnalyticsService(funnel, db), query };
}

describe("PgAdminAnalyticsService.getOverview", () => {
  it("returns zeroed overview when DB disabled", async () => {
    const { svc } = setup(false);
    const r = await svc.getOverview(30);
    expect(r.supply.total_beds).toBe(0);
    expect(r.operators.total).toBe(0);
  });

  it("assembles supply/demand/operators from batched reads", async () => {
    const { svc, query } = setup();
    query
      .mockResolvedValueOnce({
        rows: [
          {
            active: 3,
            paused: 1,
            archived: 0,
            total_beds: 50,
            vacant_beds: 12,
            avg_starting_rent_paise: 1200000,
            boys: 2,
            girls: 1,
            coed: 1
          }
        ]
      }) // supply
      .mockResolvedValueOnce({ rows: [{ city: "pune", locality: "kothrud", count: 2 }] }) // distribution
      .mockResolvedValueOnce({ rows: [{ total: 5, without_live: 2 }] }) // operators
      .mockResolvedValueOnce({ rows: [{ query: "near metro", count: 9 }] }) // top queries
      .mockResolvedValueOnce({ rows: [{ query: "pg with ac", count: 4 }] }); // zero-result
    const r = await svc.getOverview(30);
    expect(r.supply.properties_by_status.active).toBe(3);
    expect(r.supply.total_beds).toBe(50);
    expect(r.supply.vacancy_rate).toBeCloseTo(0.24);
    expect(r.distribution[0].city).toBe("pune");
    expect(r.operators.without_live_listing).toBe(2);
    expect(r.demand.top_queries[0].query).toBe("near metro");
    expect(r.demand.zero_result_queries[0].query).toBe("pg with ac");
  });
});
