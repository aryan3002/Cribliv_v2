import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
