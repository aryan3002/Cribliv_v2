import { describe, it, expect, vi } from "vitest";
import { AdminController } from "../admin.controller";

// Mirrors the direct-instantiation pattern from
// pg-analytics.controller.integration.test.ts — no NestJS Test harness.

function makeCtrl() {
  const appState = { listings: new Map(), leases: new Map() } as any;
  const database = { isEnabled: () => false, query: vi.fn() } as any;
  const notifications = {} as any;
  const analytics = {} as any;
  const ops = {} as any;
  const ownerHealth = {} as any;
  const revenue = {} as any;
  const fraudFeed = {} as any;
  const rentAgreements = {} as any;
  const pgScore = {} as any;
  const pgFunnel = {} as any;
  const pgAnalytics = {
    getListingAnalytics: vi.fn(async () => ({})),
    getOverview: vi.fn(async () => ({
      range_days: 30,
      supply: {
        properties_by_status: { active: 0, paused: 0, archived: 0 },
        total_beds: 0,
        vacant_beds: 0,
        vacancy_rate: 0,
        avg_starting_rent_paise: null,
        gender_mix: { boys: 0, girls: 0, coed: 0 }
      },
      distribution: [],
      operators: { total: 0, without_live_listing: 0 },
      demand: { top_queries: [], zero_result_queries: [] }
    }))
  } as any;
  const pgProps = {
    listListings: vi.fn(async () => ({ items: [], total: 0 })),
    getListing: vi.fn(async () => ({
      listing: { id: "l-1", title: "x", status: "active" },
      property: null,
      owner: {},
      overrides: { global: false, listing: false },
      city_slug: null,
      locality_slug: null
    })),
    getListingAnalytics: vi.fn(async () => ({})),
    updateProperty: vi.fn(async () => {})
  } as any;
  const pgOverrides = {
    set: vi.fn(async () => {}),
    clear: vi.fn(async () => {})
  } as any;
  const pgEdit = {
    getFullListing: vi.fn(async () => ({}))
  } as any;
  const indexing = { enqueue: vi.fn(async () => null) } as any;

  const ctrl = new AdminController(
    appState,
    database,
    notifications,
    analytics,
    ops,
    ownerHealth,
    revenue,
    fraudFeed,
    rentAgreements,
    pgScore,
    pgFunnel,
    pgAnalytics,
    pgProps,
    pgOverrides,
    pgEdit,
    indexing
  );
  return { ctrl, pgProps, pgOverrides, pgAnalytics };
}

describe("Admin PG endpoints (unit)", () => {
  it("GET pg/listings delegates to pgProps.listListings and wraps in ok()", async () => {
    const { ctrl, pgProps } = makeCtrl();
    const res = await ctrl.pgListings(undefined, undefined, undefined, undefined, undefined);
    expect(pgProps.listListings).toHaveBeenCalledWith({
      q: undefined,
      status: undefined,
      city: undefined,
      page: 1,
      pageSize: 50
    });
    expect(res).toMatchObject({ data: [] });
  });

  it("GET pg/listings/:id delegates to pgProps.getListing", async () => {
    const { ctrl, pgProps } = makeCtrl();
    await ctrl.pgListing("l-1");
    expect(pgProps.getListing).toHaveBeenCalledWith("l-1");
  });

  it("GET pg/listings/:id/analytics delegates to pgProps.getListingAnalytics", async () => {
    const { ctrl, pgProps } = makeCtrl();
    await ctrl.pgListingAnalyticsDetail("l-1", "30");
    expect(pgProps.getListingAnalytics).toHaveBeenCalledWith("l-1", 30);
  });

  it("PATCH pg/properties/:id calls updateProperty (property-keyed edit)", async () => {
    const { ctrl, pgProps } = makeCtrl();
    const req = { user: { id: "admin-1" } };
    await ctrl.pgPropertyUpdate(req, "prop-1", { display_name: "New" });
    expect(pgProps.updateProperty).toHaveBeenCalledWith("admin-1", "prop-1", {
      display_name: "New"
    });
  });

  it("POST pg/listings/:id/override (scope=listing) cuts ONLY that listing", async () => {
    const { ctrl, pgOverrides } = makeCtrl();
    const req = { user: { id: "admin-1" } };
    await ctrl.pgListingOverrideSet(req, "l-1", {
      scope: "listing",
      operator_id: "op-1",
      reason: "test"
    });
    expect(pgOverrides.set).toHaveBeenCalledWith("admin-1", "op-1", { listingId: "l-1" }, "test");
  });

  it("POST pg/listings/:id/override (scope=global) cuts the whole operator", async () => {
    const { ctrl, pgOverrides } = makeCtrl();
    const req = { user: { id: "admin-1" } };
    await ctrl.pgListingOverrideSet(req, "l-1", { scope: "global", operator_id: "op-1" });
    expect(pgOverrides.set).toHaveBeenCalledWith("admin-1", "op-1", { listingId: null }, null);
  });

  it("DELETE pg/listings/:id/override (scope=listing) restores only that listing", async () => {
    const { ctrl, pgOverrides } = makeCtrl();
    const req = { user: { id: "admin-1" } };
    await ctrl.pgListingOverrideClear(req, "l-1", { scope: "listing", operator_id: "op-1" });
    expect(pgOverrides.clear).toHaveBeenCalledWith("admin-1", "op-1", { listingId: "l-1" }, null);
  });
});
