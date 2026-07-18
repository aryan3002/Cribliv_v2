import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDashboardService } from "../services/pg-dashboard.service";
import { LeadsSliceAdapter } from "../services/dashboard-adapters";

function makeDeps() {
  const listings = {
    listOperatorListings: vi.fn(async () => [
      { id: "L1", pg_property_id: "P1", status: "active", updated_at: "2026-01-01T00:00:00Z" }
    ]),
    listOperatorCities: vi.fn(async () => ["pune"])
  };
  // Views come from analytics (listing_events). Unlocks/interest come from the
  // leads table — the SAME source the inbox shows — not listing_events('enquiry').
  const analytics = {
    listingViews7d: vi.fn(async () => [{ listing_id: "L1", views_7d: 42 }]),
    searchAppearances7d: vi.fn(async () => [{ listing_id: "L1", appearances: 100, clicks: 8 }]),
    funnelTimeseries: vi.fn(async () => [
      {
        listing_id: "L1",
        series: Array.from({ length: 7 }, (_, i) => ({
          day: `2026-05-2${i}`,
          appearances: i,
          clicks: 0,
          views: 0,
          leads: 0
        }))
      }
    ]),
    searchInsights: vi.fn(async () => ({
      top_queries: [],
      top_filters: [],
      zero_result_queries: []
    }))
  };
  const leads = {
    listingLeadCounts7d: vi.fn(async () => [{ listing_id: "L1", count: 3 }]),
    inboxForOperator: vi.fn(async () => [
      {
        lead_id: "lead-1",
        source: "contact_unlock",
        status: "new",
        created_at: "2026-01-01T00:00:00Z",
        contact: { phone_masked: "+9198***234" },
        // Lead monetization (Slice 3) — mirrors the exact fields
        // LeadsSliceAdapter.inboxForOperator now preserves from getOwnerLeads.
        access_state: "locked" as const,
        call_deadline_at: "2026-01-01T12:00:00Z",
        called_at: null,
        called_by: null,
        tenant_name: "Asha",
        tenant_phone: null
      }
    ])
  };
  const overrides = {
    getActiveForOperator: vi.fn(async () => ({ global: false, listing_ids: [] as string[] }))
  };
  return { listings, analytics, leads, overrides };
}

describe("PgDashboardService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates listing health: views from analytics, unlocks from leads", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    expect(r.listing_health[0].listing_id).toBe("L1");
    expect(r.listing_health[0].views_7d).toBe(42);
    // The bug fix: the contact-unlock count reflects the lead created by the
    // unlock (was always 0 because it read listing_events('enquiry')).
    expect(r.listing_health[0].contact_unlocks_7d).toBe(3);
    expect(r.leads_inbox.length).toBe(1);
    expect(d.leads.listingLeadCounts7d).toHaveBeenCalledWith("op-1", ["L1"]);
    // Lead monetization (Slice 3): the service passes the adapter's
    // access/call fields straight through into leads_inbox — PgLeadsBoard
    // needs these to reuse the shared owner unlock/call-click controls.
    expect(r.leads_inbox[0]).toMatchObject({
      access_state: "locked",
      call_deadline_at: "2026-01-01T12:00:00Z",
      called_at: null,
      called_by: null,
      tenant_name: "Asha",
      tenant_phone: null
    });
  });

  it("returns cached payload within 60s for the same operator", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    await svc.getDashboard("op-1");
    await svc.getDashboard("op-1");
    expect(d.listings.listOperatorListings).toHaveBeenCalledOnce();
    expect(d.analytics.listingViews7d).toHaveBeenCalledOnce();
    expect(d.leads.listingLeadCounts7d).toHaveBeenCalledOnce();
    expect(d.leads.inboxForOperator).toHaveBeenCalledOnce();
  });

  it("invalidates cache after 60s and refetches", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    await svc.getDashboard("op-1");
    vi.advanceTimersByTime(61_000);
    await svc.getDashboard("op-1");
    expect(d.listings.listOperatorListings).toHaveBeenCalledTimes(2);
  });

  it("treats different operators as separate cache keys", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    await svc.getDashboard("op-1");
    await svc.getDashboard("op-2");
    expect(d.listings.listOperatorListings).toHaveBeenCalledTimes(2);
  });

  it("skips analytics + lead-count calls when operator has zero listings", async () => {
    const d = makeDeps();
    d.listings.listOperatorListings.mockResolvedValueOnce([]);
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-empty");
    expect(r.listing_health).toEqual([]);
    expect(d.analytics.listingViews7d).not.toHaveBeenCalled();
    expect(d.leads.listingLeadCounts7d).not.toHaveBeenCalled();
  });

  it("computes ctr_7d = clicks/appearances (2dp) and passes appearances + trend", async () => {
    const d = makeDeps();
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    const h = r.listing_health[0];
    expect(h.search_appearances_7d).toBe(100);
    expect(h.ctr_7d).toBe(0.08); // 8/100
    expect(h.trend_7d).toHaveLength(7);
  });

  it("computes interest_rate_7d = contact_unlocks_7d/views_7d (2dp)", async () => {
    const d = makeDeps(); // leads=3, views=42
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    expect(r.listing_health[0].interest_rate_7d).toBe(0.07); // 3/42 = 0.0714 → 0.07
  });

  it("guards zero denominators (no NaN/Infinity)", async () => {
    const d = makeDeps();
    d.analytics.searchAppearances7d = vi.fn(async () => [
      { listing_id: "L1", appearances: 0, clicks: 0 }
    ]);
    d.analytics.listingViews7d = vi.fn(async () => [{ listing_id: "L1", views_7d: 0 }]);
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    expect(r.listing_health[0].ctr_7d).toBe(0);
    expect(r.listing_health[0].interest_rate_7d).toBe(0);
  });

  it("zero-fills new fields for a listing with no analytics rows", async () => {
    const d = makeDeps();
    d.analytics.searchAppearances7d = vi.fn(async () => []);
    d.analytics.funnelTimeseries = vi.fn(async () => []);
    d.analytics.listingViews7d = vi.fn(async () => []);
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    const h = r.listing_health[0];
    expect(h.search_appearances_7d).toBe(0);
    expect(h.ctr_7d).toBe(0);
    expect(h.interest_rate_7d).toBe(0);
    expect(h.trend_7d).toEqual([]);
  });

  it("masks analytics when a global override is active", async () => {
    const d = makeDeps();
    d.overrides.getActiveForOperator = vi.fn(async () => ({ global: true, listing_ids: [] }));
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    expect(r.analytics_status).toBe("restricted");
    expect(r.listing_health[0].views_7d).toBe(0);
    expect(r.portfolio.views).toBe(0);
  });
});

describe("PgDashboardService portfolio + trends", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // 30-day series: filler 0 for days 0–15, prior week (16–22) and last week (23–29).
  function series(prior: { a: number; c: number; v: number; l: number }, last: typeof prior) {
    return Array.from({ length: 30 }, (_, i) => {
      const win = i >= 23 ? last : i >= 16 ? prior : { a: 0, c: 0, v: 0, l: 0 };
      return { day: `d${i}`, appearances: win.a, clicks: win.c, views: win.v, leads: win.l };
    });
  }

  function portfolioDeps(
    listingsRows: Array<{ id: string }>,
    seriesByListing: Record<string, any[]>
  ) {
    return {
      listings: {
        listOperatorListings: vi.fn(async () =>
          listingsRows.map((l) => ({
            id: l.id,
            status: "active",
            updated_at: "2026-01-01T00:00:00Z"
          }))
        ),
        listOperatorCities: vi.fn(async () => ["pune"])
      },
      analytics: {
        listingViews7d: vi.fn(async () => []),
        searchAppearances7d: vi.fn(async () => []),
        funnelTimeseries: vi.fn(async () =>
          listingsRows.map((l) => ({ listing_id: l.id, series: seriesByListing[l.id] }))
        ),
        searchInsights: vi.fn(async () => ({
          top_queries: [{ query: "ac pg", count: 3 }],
          top_filters: [],
          zero_result_queries: []
        }))
      },
      leads: {
        listingLeadCounts7d: vi.fn(async () => []),
        inboxForOperator: vi.fn(async () => [])
      }
    };
  }

  it("fetches a 30-day timeseries (not 7)", async () => {
    const d = portfolioDeps([{ id: "L1" }], {
      L1: series({ a: 0, c: 0, v: 0, l: 0 }, { a: 0, c: 0, v: 0, l: 0 })
    });
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    await svc.getDashboard("op-1");
    expect(d.analytics.funnelTimeseries).toHaveBeenCalledWith(["L1"], 30);
  });

  it("computes portfolio totals from the last 7 days + ratios", async () => {
    const d = portfolioDeps([{ id: "L1" }], {
      L1: series({ a: 10, c: 0, v: 5, l: 1 }, { a: 20, c: 4, v: 10, l: 2 })
    });
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    const p = r.portfolio;
    expect(p.appearances).toBe(140); // 20×7
    expect(p.clicks).toBe(28); // 4×7
    expect(p.views).toBe(70); // 10×7
    expect(p.leads).toBe(14); // 2×7
    expect(p.ctr).toBe(0.2); // 28/140
    expect(p.interest_rate).toBe(0.2); // 14/70
    expect(p.conversion).toBe(0.1); // 14/140
  });

  it("computes week-over-week deltas (cur vs prior 7d)", async () => {
    const d = portfolioDeps([{ id: "L1" }], {
      L1: series({ a: 10, c: 0, v: 5, l: 1 }, { a: 20, c: 4, v: 10, l: 2 })
    });
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    expect(r.portfolio.deltas.appearances).toBe(1); // (140-70)/70
    expect(r.portfolio.deltas.views).toBe(1); // (70-35)/35
    expect(r.portfolio.deltas.leads).toBe(1); // (14-7)/7
  });

  it("delta is null when the prior period had no data", async () => {
    const d = portfolioDeps([{ id: "L1" }], {
      L1: series({ a: 0, c: 0, v: 0, l: 0 }, { a: 20, c: 4, v: 10, l: 2 })
    });
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    expect(r.portfolio.deltas.appearances).toBeNull();
    expect(r.portfolio.deltas.views).toBeNull();
    expect(r.portfolio.deltas.leads).toBeNull();
  });

  it("aggregates trend_30d across listings by day", async () => {
    const d = portfolioDeps([{ id: "L1" }, { id: "L2" }], {
      L1: series({ a: 1, c: 0, v: 0, l: 0 }, { a: 2, c: 0, v: 0, l: 0 }),
      L2: series({ a: 3, c: 0, v: 0, l: 0 }, { a: 4, c: 0, v: 0, l: 0 })
    });
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    expect(r.trend_30d).toHaveLength(30);
    expect(r.trend_30d[29]).toMatchObject({ day: "d29", appearances: 6 }); // 2 + 4
    expect(r.trend_30d[16]).toMatchObject({ day: "d16", appearances: 4 }); // 1 + 3
  });

  it("passes search insights through from the operator's cities", async () => {
    const d = portfolioDeps([{ id: "L1" }], {
      L1: series({ a: 0, c: 0, v: 0, l: 0 }, { a: 0, c: 0, v: 0, l: 0 })
    });
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-1");
    expect(d.analytics.searchInsights).toHaveBeenCalledWith(["pune"], expect.any(Date));
    expect(r.search_insights.top_queries[0]).toEqual({ query: "ac pg", count: 3 });
  });

  it("no listings → zeroed portfolio, empty trend, empty insights", async () => {
    const d = portfolioDeps([], {});
    d.listings.listOperatorCities = vi.fn(async () => []); // no markets when no listings
    const svc = new PgDashboardService(
      d.listings as any,
      d.analytics as any,
      d.leads as any,
      (d as any).overrides ??
        ({ getActiveForOperator: async () => ({ global: false, listing_ids: [] }) } as any)
    );
    const r = await svc.getDashboard("op-empty");
    expect(r.portfolio.appearances).toBe(0);
    expect(r.portfolio.ctr).toBe(0);
    expect(r.portfolio.deltas.appearances).toBeNull();
    expect(r.trend_30d).toEqual([]);
    expect(r.search_insights.top_queries).toEqual([]);
    expect(d.analytics.funnelTimeseries).not.toHaveBeenCalled();
    expect(d.analytics.searchInsights).not.toHaveBeenCalled();
  });
});

describe("LeadsSliceAdapter.inboxForOperator", () => {
  // Lead monetization (Slice 3): getOwnerLeads rows carry access/call fields
  // (and tenant_phone_masked) as TOP-LEVEL columns, not nested under
  // `.contact` — this adapter must map them straight through instead of
  // discarding them, which is what lets PgLeadsBoard reuse the shared owner
  // unlock/call-click controls without a second query.
  function makeLeadsService(rows: Record<string, unknown>[]) {
    return {
      getOwnerLeads: vi.fn(async () => ({
        items: rows,
        total: rows.length,
        page: 1,
        page_size: 20
      }))
    };
  }

  it("maps access_state, call_deadline_at, called_at, called_by, tenant_name, tenant_phone from getOwnerLeads", async () => {
    const leads = makeLeadsService([
      {
        id: "lead-1",
        listing_id: "L1",
        listing_title: "Cosy 2BHK",
        tenant_user_id: "u1",
        tenant_name: "Asha",
        tenant_phone_masked: "+9198***234",
        status: "new",
        status_changed_at: "2026-01-01T00:00:00Z",
        owner_notes: null,
        created_at: "2026-01-01T00:00:00Z",
        access_state: "locked",
        call_deadline_at: "2026-01-02T00:00:00Z",
        called_at: null,
        called_by: null,
        tenant_phone: null
      }
    ]);
    const adapter = new LeadsSliceAdapter(leads as any);
    const result = await adapter.inboxForOperator("op-1");
    expect(result).toEqual([
      {
        lead_id: "lead-1",
        source: "unknown",
        status: "new",
        created_at: "2026-01-01T00:00:00Z",
        contact: { phone_masked: "+9198***234" },
        access_state: "locked",
        call_deadline_at: "2026-01-02T00:00:00Z",
        called_at: null,
        called_by: null,
        tenant_name: "Asha",
        tenant_phone: null,
        preferred_sharing: null
      }
    ]);
  });

  it("carries a real tenant_phone and called_at/called_by through for a called, unlocked lead", async () => {
    const leads = makeLeadsService([
      {
        id: "lead-2",
        tenant_name: "Rahul",
        tenant_phone_masked: "+9198***999",
        status: "contacted",
        created_at: "2026-01-01T00:00:00Z",
        access_state: "unlocked",
        call_deadline_at: "2026-01-02T00:00:00Z",
        called_at: "2026-01-01T05:00:00Z",
        called_by: "owner",
        tenant_phone: "+919812345678"
      }
    ]);
    const adapter = new LeadsSliceAdapter(leads as any);
    const [row] = await adapter.inboxForOperator("op-1");
    expect(row.access_state).toBe("unlocked");
    expect(row.called_at).toBe("2026-01-01T05:00:00Z");
    expect(row.called_by).toBe("owner");
    expect(row.tenant_phone).toBe("+919812345678");
  });

  it("defaults access_state to locked and phone_masked to *** when getOwnerLeads omits them", async () => {
    const leads = makeLeadsService([{ id: "lead-3", created_at: "2026-01-01T00:00:00Z" }]);
    const adapter = new LeadsSliceAdapter(leads as any);
    const [row] = await adapter.inboxForOperator("op-1");
    expect(row.access_state).toBe("locked");
    expect(row.contact.phone_masked).toBe("***");
    expect(row.tenant_name).toBe("Tenant");
  });
});
