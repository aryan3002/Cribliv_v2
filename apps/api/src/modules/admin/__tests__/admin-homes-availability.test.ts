import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import { AvailabilityAlertsService } from "../../availability-alerts/availability-alerts.service";
import { AdminHomesService } from "../admin-homes.service";

const now = Date.now();

function installFixtures(appState: AppStateService) {
  (appState as any).users = new Map([
    [
      "owner-1",
      {
        id: "owner-1",
        phone: "+919999999901",
        role: "owner",
        preferred_language: "en",
        full_name: "Ramesh Kumar"
      }
    ]
  ]);
  (appState as any).listings = new Map([
    [
      "active-home",
      {
        id: "active-home",
        ownerUserId: "owner-1",
        listingType: "flat_house",
        title: "Gomti View Residence",
        city: "lucknow",
        locality: "gomti-nagar",
        monthlyRent: 20000,
        verificationStatus: "verified",
        status: "active",
        createdAt: now - 1_000,
        updatedAt: now - 1_000
      }
    ],
    [
      "pg-home",
      {
        id: "pg-home",
        ownerUserId: "owner-1",
        listingType: "pg",
        title: "Verified PG",
        city: "lucknow",
        monthlyRent: 8000,
        verificationStatus: "verified",
        status: "active",
        createdAt: now
      }
    ]
  ]);
  (appState as any).leads = new Map();
}

describe("AdminHomesService — availability toggle + waitlist leads", () => {
  // `setAvailability` is flag-gated (mirrors AvailabilityAlertsService.join / the owner
  // equivalent in owner.service.ts): it throws feature_disabled as its first statement
  // when ff_unavailable_listings is off. Every existing test in this describe block
  // predates that gate and calls setAvailability expecting it to succeed, so force the
  // flag on here — same mechanism as availability-alerts.service.test.ts.
  const previousFlag = process.env.FF_UNAVAILABLE_LISTINGS;
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let appState: AppStateService;
  let availabilityAlerts: AvailabilityAlertsService;
  let service: AdminHomesService;

  beforeEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = "true";
    database = { isEnabled: () => false, query: vi.fn() };
    appState = new AppStateService();
    installFixtures(appState);
    availabilityAlerts = new AvailabilityAlertsService(appState, database as any);
    service = new AdminHomesService(database as any, appState, availabilityAlerts);
  });

  afterEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = previousFlag;
  });

  it("admin marks unavailable and lists waitlist leads with phone", async () => {
    const l = [...appState.listings.values()].find(
      (x: any) => x.status === "active" && x.listingType === "flat_house"
    )! as any;
    appState.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000009",
      user_id: null,
      locale: "en"
    });

    const result = await service.setAvailability(l.id, false, "admin-1");

    expect(result).toEqual({ listing_id: l.id, is_available: false });
    expect((appState.listings.get(l.id) as any).is_available).toBe(false);

    const leads = await service.listWaitlist(l.id);
    expect(leads[0].phone).toBe("+919000000009");
  });

  it("records an admin_actions audit entry with action availability_change", async () => {
    const l = appState.listings.get("active-home")!;
    await service.setAvailability(l.id, false, "admin-1", "went off-market");

    const action = (appState as any).adminActions.find(
      (a: any) => a.target_id === l.id && a.action === "availability_change"
    );
    expect(action).toBeDefined();
    expect(action.admin_id ?? action.admin_user_id).toBe("admin-1");
    expect(action.reason).toBe("went off-market");
  });

  it("flips waiting alerts to ready when availability is restored", async () => {
    const l = appState.listings.get("active-home")!;
    appState.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000009",
      user_id: null,
      locale: "en"
    });
    await service.setAvailability(l.id, false, "admin-1");

    await service.setAvailability(l.id, true, "admin-1");

    const leads = await service.listWaitlist(l.id);
    expect(leads[0].status).toBe("ready");
  });

  it("rejects availability changes for non-flat_house listings", async () => {
    await expect(service.setAvailability("pg-home", false, "admin-1")).rejects.toBeTruthy();
  });

  it("does not require owner scoping — any admin can flip any listing", async () => {
    const result = await service.setAvailability("active-home", false, "admin-999");
    expect(result.is_available).toBe(false);
  });

  it("rejects setAvailability when ff_unavailable_listings is off, and does not mutate is_available", async () => {
    process.env.FF_UNAVAILABLE_LISTINGS = "false";
    const l = appState.listings.get("active-home")!;
    const before = (l as any).is_available;

    await expect(service.setAvailability(l.id, false, "admin-1")).rejects.toMatchObject({
      response: { code: "feature_disabled" }
    });

    expect((appState.listings.get(l.id) as any).is_available).toBe(before);
  });
});

// DB-mode path: `database.isEnabled()` returns true and every DB call is a mocked
// `vi.fn()` (no live Postgres). Mirrors the mock-query pattern established in
// availability-alerts.service.test.ts's "DB-mode path" describe block
// (query.mockResolvedValueOnce(...) chained per call, asserting SQL shape + params).
//
// `setAvailability`'s DB branch (admin-homes.service.ts) issues `query()` in this
// exact order:
//   1. `UPDATE listings SET is_available = $2, became_unavailable_at = ..., ...
//      WHERE id = $1::uuid AND listing_type = 'flat_house' RETURNING id::text, is_available`
//   2. `INSERT INTO admin_actions(...) VALUES ($1::uuid, 'listing', $2::uuid,
//      'availability_change', $3, null, $4::jsonb)`
//   3. only when `available === true`: the conditional ready-flip
//      `UPDATE listing_availability_alerts SET status = 'ready', ready_at = now()
//      WHERE listing_id = $1::uuid AND status = 'waiting'`
describe("AdminHomesService.setAvailability — DB-mode path", () => {
  const listingId = "33333333-3333-4333-8333-333333333333";
  // Same flag-gate as the in-memory describe block above — force it on so these
  // pre-existing DB-mode tests keep exercising the DB branch instead of short-circuiting.
  const previousFlag = process.env.FF_UNAVAILABLE_LISTINGS;

  beforeEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = "true";
  });

  afterEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = previousFlag;
  });

  function makeDbService() {
    const query = vi.fn();
    const database = { isEnabled: () => true, query };
    const dbAppState = new AppStateService();
    const dbAvailabilityAlerts = new AvailabilityAlertsService(dbAppState, database as any);
    const dbService = new AdminHomesService(database as any, dbAppState, dbAvailabilityAlerts);
    return { service: dbService, query };
  }

  it("available=true: UPDATE guards on flat_house + sets is_available, writes an availability_change admin_actions row, and flips waiting alerts to ready", async () => {
    const { service: dbService, query } = makeDbService();
    query
      .mockResolvedValueOnce({ rows: [{ id: listingId, is_available: true }], rowCount: 1 }) // UPDATE listings
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT admin_actions
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // UPDATE listing_availability_alerts (ready-flip)

    const result = await dbService.setAvailability(listingId, true, "admin-1", "back on market");

    expect(result).toEqual({ listing_id: listingId, is_available: true });
    expect(query).toHaveBeenCalledTimes(3);

    const [updateSql, updateParams] = query.mock.calls[0];
    expect(updateSql).toMatch(/UPDATE listings/);
    expect(updateSql).toContain("SET is_available = $2");
    expect(updateSql).toContain("listing_type = 'flat_house'");
    expect(updateParams).toEqual([listingId, true]);

    const [insertSql, insertParams] = query.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO admin_actions/);
    expect(insertSql).toContain("'availability_change'");
    expect(insertParams).toEqual([
      "admin-1",
      listingId,
      "back on market",
      JSON.stringify({ is_available: true })
    ]);

    const [readyFlipSql, readyFlipParams] = query.mock.calls[2];
    expect(readyFlipSql).toMatch(/UPDATE listing_availability_alerts/);
    expect(readyFlipSql).toContain("status = 'ready'");
    expect(readyFlipSql).toContain("status = 'waiting'");
    expect(readyFlipParams).toEqual([listingId]);
  });

  it("available=false: same UPDATE + admin_actions insert, but the ready-flip UPDATE does not run", async () => {
    const { service: dbService, query } = makeDbService();
    query
      .mockResolvedValueOnce({ rows: [{ id: listingId, is_available: false }], rowCount: 1 }) // UPDATE listings
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT admin_actions

    const result = await dbService.setAvailability(listingId, false, "admin-1");

    expect(result).toEqual({ listing_id: listingId, is_available: false });
    expect(query).toHaveBeenCalledTimes(2);

    const [updateSql, updateParams] = query.mock.calls[0];
    expect(updateSql).toContain("listing_type = 'flat_house'");
    expect(updateSql).toContain("SET is_available = $2");
    expect(updateParams).toEqual([listingId, false]);

    const [insertSql] = query.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO admin_actions/);
    expect(insertSql).toContain("'availability_change'");

    expect(
      query.mock.calls.some(([sql]) => String(sql).includes("listing_availability_alerts"))
    ).toBe(false);
  });
});
