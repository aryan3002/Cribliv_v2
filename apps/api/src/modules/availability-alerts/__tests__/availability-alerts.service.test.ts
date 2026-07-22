import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AvailabilityAlertsService } from "../availability-alerts.service";
import { AppStateService } from "../../../common/app-state.service";
import { DatabaseService } from "../../../common/database.service";

// `request.user` only ever carries `{ id, role }` (see AuthGuard / common/types.ts
// UserContext) — there is no `phone` on the auth payload. The service must resolve
// the waitlist phone itself via `AppStateService.users` (a `Map<string, UserRecord>`
// keyed by id), never trust a phone passed in from the caller. Seed a user here to
// control that lookup.
function makeService() {
  const app = new AppStateService();
  const db = { isEnabled: () => false } as unknown as DatabaseService;
  const svc = new AvailabilityAlertsService(app, db);
  return { app, svc };
}

function seedUser(app: AppStateService, id: string, phone: string) {
  app.users.set(id, { id, phone, role: "tenant", preferred_language: "en" });
}

describe("AvailabilityAlertsService (in-memory dual-mode path)", () => {
  const previousFlag = process.env.FF_UNAVAILABLE_LISTINGS;
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = "true";
    ctx = makeService();
  });

  afterEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = previousFlag;
  });

  it("join is idempotent per (listing, phone)", async () => {
    seedUser(ctx.app, "u1", "+919000000002");

    const first = await ctx.svc.join("u1", "L1", "en");
    expect(first.already_on_list).toBe(false);
    expect(first.status).toBe("waiting");

    const second = await ctx.svc.join("u1", "L1", "en");
    expect(second.already_on_list).toBe(true);

    expect((await ctx.svc.listForListing("L1")).length).toBe(1);
  });

  it("rejects join when ff_unavailable_listings is off (feature_disabled, no capture)", async () => {
    process.env.FF_UNAVAILABLE_LISTINGS = "false";
    seedUser(ctx.app, "u1", "+919000000003");

    await expect(ctx.svc.join("u1", "L1", "en")).rejects.toThrow();
    expect(ctx.app.listAvailabilityAlerts("L1")).toHaveLength(0);
  });

  it("resolves the phone from the user id, not from a caller-supplied value", async () => {
    seedUser(ctx.app, "u1", "+919000000004");

    await ctx.svc.join("u1", "L1", "en");

    const alerts = ctx.app.listAvailabilityAlerts("L1");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].phone).toBe("+919000000004");
    expect(alerts[0].user_id).toBe("u1");
  });

  it("leave removes the alert and allows a clean rejoin", async () => {
    seedUser(ctx.app, "u1", "+919000000005");
    await ctx.svc.join("u1", "L1", "en");

    const left = await ctx.svc.leave("u1", "L1");
    expect(left).toEqual({ ok: true });
    expect(ctx.app.listAvailabilityAlerts("L1")).toHaveLength(0);

    const rejoined = await ctx.svc.join("u1", "L1", "en");
    expect(rejoined.already_on_list).toBe(false);
  });

  it("listForUser returns the caller's alerts across listings, keyed by their phone", async () => {
    seedUser(ctx.app, "u1", "+919000000006");
    await ctx.svc.join("u1", "L1", "en");
    await ctx.svc.join("u1", "L2", "en");

    const items = await ctx.svc.listForUser("u1");
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.listing_id).sort()).toEqual(["L1", "L2"]);
    expect(items.every((i) => i.status === "waiting")).toBe(true);
  });

  it("listForListing reflects multiple distinct waitlisters for one listing", async () => {
    seedUser(ctx.app, "u1", "+919000000007");
    seedUser(ctx.app, "u2", "+919000000008");
    await ctx.svc.join("u1", "L1", "en");
    await ctx.svc.join("u2", "L1", "hi");

    const items = await ctx.svc.listForListing("L1");
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.phone).sort()).toEqual(["+919000000007", "+919000000008"]);
  });
});

// DB-mode path: `database.isEnabled()` returns true and every DB call is a mocked
// `vi.fn()` (no live Postgres). Mirrors the mock-query pattern established in
// admin-homes.service.test.ts (`new AdminHomesService({ isEnabled: () => true, query } as any, ...)`),
// adapted to this service's real constructor order: (appState, database).
//
// `join`'s DB branch (availability-alerts.service.ts:74-97) issues query() up to
// three times in this exact order:
//   1. resolvePhone(): `SELECT phone_e164 FROM users WHERE id = $1::uuid LIMIT 1`
//   2. `INSERT ... ON CONFLICT (listing_id, phone) DO NOTHING RETURNING id, status`
//   3. only when the insert returns no row (conflict): the fallback
//      `SELECT status FROM listing_availability_alerts WHERE listing_id = $1::uuid
//      AND phone = $2 LIMIT 1`
// Each test below queues mockResolvedValueOnce responses in that same call order.
describe("AvailabilityAlertsService (DB-mode path)", () => {
  const previousFlag = process.env.FF_UNAVAILABLE_LISTINGS;

  beforeEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = "true";
  });

  afterEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = previousFlag;
  });

  function makeDbService() {
    const app = new AppStateService();
    const query = vi.fn();
    const db = { isEnabled: () => true, query } as unknown as DatabaseService;
    const svc = new AvailabilityAlertsService(app, db);
    return { svc, query };
  }

  it("join: fresh insert returns the inserted row's status with already_on_list false", async () => {
    const { svc, query } = makeDbService();

    query
      .mockResolvedValueOnce({ rows: [{ phone_e164: "+919000000010" }], rowCount: 1 }) // resolvePhone
      .mockResolvedValueOnce({ rows: [{ id: "alert-1", status: "waiting" }], rowCount: 1 }); // INSERT ... RETURNING

    const result = await svc.join("u1", "L1", "en");

    expect(result).toEqual({ status: "waiting", already_on_list: false });
    expect(query).toHaveBeenCalledTimes(2);

    const [insertSql, insertParams] = query.mock.calls[1];
    expect(insertSql).toMatch(/INSERT INTO listing_availability_alerts/);
    expect(insertSql).toMatch(/ON CONFLICT \(listing_id, phone\) DO NOTHING/);
    expect(insertSql).toMatch(/RETURNING id, status/);
    expect(insertParams).toEqual(["L1", "u1", "+919000000010", "en"]);
  });

  it("join: conflict (no row from insert) falls back to SELECT and reports already_on_list true with the real status", async () => {
    const { svc, query } = makeDbService();

    query
      .mockResolvedValueOnce({ rows: [{ phone_e164: "+919000000011" }], rowCount: 1 }) // resolvePhone
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // INSERT ... DO NOTHING (conflict, no row)
      .mockResolvedValueOnce({ rows: [{ status: "ready" }], rowCount: 1 }); // fallback SELECT status

    const result = await svc.join("u1", "L1", "en");

    // Asserts the real fallback status ("ready") flows through rather than a
    // hardcoded "waiting" guess — this is the exact branch the task flagged as
    // having zero coverage.
    expect(result).toEqual({ status: "ready", already_on_list: true });
    expect(query).toHaveBeenCalledTimes(3);

    const [selectSql, selectParams] = query.mock.calls[2];
    expect(selectSql).toMatch(/SELECT status FROM listing_availability_alerts/);
    expect(selectSql).toMatch(/WHERE listing_id = \$1::uuid AND phone = \$2/);
    expect(selectParams).toEqual(["L1", "+919000000011"]);
  });

  it("sends parameterized SQL (placeholders + params array) for every query, never string-interpolated", async () => {
    const { svc, query } = makeDbService();

    query
      .mockResolvedValueOnce({ rows: [{ phone_e164: "+919000000012" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "alert-2", status: "waiting" }], rowCount: 1 });

    await svc.join("u1", "L1", "en");

    expect(query).toHaveBeenCalledTimes(2);
    for (const [sql, params] of query.mock.calls) {
      expect(sql).toMatch(/\$1/);
      expect(sql).not.toContain("'u1'");
      expect(sql).not.toContain("'L1'");
      expect(Array.isArray(params)).toBe(true);
      expect((params as unknown[]).length).toBeGreaterThan(0);
    }
  });
});
