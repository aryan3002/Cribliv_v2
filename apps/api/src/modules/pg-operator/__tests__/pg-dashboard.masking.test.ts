import { describe, it, expect } from "vitest";
import { applyMasking } from "../services/pg-dashboard.masking";
import type { PgDashboardData, PgActiveOverrides } from "@cribliv/shared-types";

// All listings belong to the SAME property P1 — mirrors production where one
// operator owns one pg_property containing many pg_listings. Per-listing
// masking must therefore key off listing_id, NOT pg_property_id.
function sampleData(): PgDashboardData {
  return {
    analytics_status: "live",
    listing_health: [
      {
        listing_id: "L1",
        pg_property_id: "P1",
        status: "active",
        views_7d: 42,
        contact_unlocks_7d: 3,
        search_appearances_7d: 100,
        ctr_7d: 0.08,
        interest_rate_7d: 0.07,
        trend_7d: [],
        last_updated: "x"
      },
      {
        listing_id: "L2",
        pg_property_id: "P1",
        status: "active",
        views_7d: 10,
        contact_unlocks_7d: 1,
        search_appearances_7d: 20,
        ctr_7d: 0.05,
        interest_rate_7d: 0.1,
        trend_7d: [],
        last_updated: "x"
      }
    ],
    leads_inbox: [],
    portfolio: {
      appearances: 120,
      clicks: 9,
      views: 52,
      leads: 4,
      ctr: 0.075,
      interest_rate: 0.077,
      conversion: 0.033,
      deltas: { appearances: null, views: null, leads: null }
    },
    trend_30d: [{ day: "2026-06-01", appearances: 120, clicks: 9, views: 52, leads: 4 }],
    search_insights: {
      top_queries: [{ query: "near metro", count: 5 }],
      top_filters: [],
      zero_result_queries: []
    }
  } as unknown as PgDashboardData;
}

const NO_OVERRIDES: PgActiveOverrides = { global: false, listing_ids: [] };

describe("applyMasking", () => {
  it("returns data unchanged when no override is active", () => {
    const out = applyMasking(sampleData(), NO_OVERRIDES);
    expect(out.analytics_status).toBe("live");
    expect(out.listing_health[0].views_7d).toBe(42);
    expect(out.portfolio.views).toBe(52);
  });

  it("global override zeroes everything and flags restricted", () => {
    const out = applyMasking(sampleData(), { global: true, listing_ids: [] });
    expect(out.analytics_status).toBe("restricted");
    expect(
      out.listing_health.every(
        (l) => l.views_7d === 0 && l.contact_unlocks_7d === 0 && l.search_appearances_7d === 0
      )
    ).toBe(true);
    expect(out.portfolio.views).toBe(0);
    expect(out.portfolio.leads).toBe(0);
    expect(out.trend_30d.every((p) => p.views === 0 && p.leads === 0 && p.appearances === 0)).toBe(
      true
    );
    expect(out.search_insights.top_queries).toHaveLength(0);
  });

  // Regression for the reported bug: cutting ONE listing must not cut its
  // siblings, even though they share the same pg_property_id.
  it("per-listing override zeroes ONLY that listing; siblings on the same property survive", () => {
    const out = applyMasking(sampleData(), { global: false, listing_ids: ["L1"] });
    expect(out.analytics_status).toBe("restricted");
    const l1 = out.listing_health.find((l) => l.listing_id === "L1")!;
    const l2 = out.listing_health.find((l) => l.listing_id === "L2")!;
    expect(l1.views_7d).toBe(0);
    expect(l2.views_7d).toBe(10); // sibling on SAME property P1 untouched
    expect(l2.contact_unlocks_7d).toBe(1);
    // portfolio recomputed from survivors (L2 only): views=10, leads=1
    expect(out.portfolio.views).toBe(10);
    expect(out.portfolio.leads).toBe(1);
    // trend_30d retained (not all listings cut), insights retained (not global)
    expect(out.search_insights.top_queries).toHaveLength(1);
  });
});
