import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OwnerService } from "../owner.service";
import { AppStateService } from "../../../common/app-state.service";
import { DatabaseService } from "../../../common/database.service";
import { NotificationService } from "../../notifications/notification.service";
import { AzureBlobPhotoStorageService } from "../azure-blob-photo-storage.service";

// `AppStateService.listings` is a `Map<string, ListingRecord>` keyed by id, not an
// array — iterate via `.values()` / read via `.get(id)`. Field names on ListingRecord
// are camelCase (`ownerUserId`, `listingType`) except `is_available`, which mirrors the
// DB column name verbatim (see app-state.service.ts).
function makeService() {
  const app = new AppStateService();
  const db = { isEnabled: () => false } as unknown as DatabaseService;
  const notifications = {} as unknown as NotificationService;
  const photoStorage = {} as unknown as AzureBlobPhotoStorageService;
  const svc = new OwnerService(app, db, notifications, photoStorage);
  return { app, svc };
}

describe("OwnerService.setAvailability", () => {
  // `setAvailability` is flag-gated (mirrors AvailabilityAlertsService.join): it throws
  // feature_disabled as its first statement when ff_unavailable_listings is off. Every
  // existing test in this describe block predates that gate and calls setAvailability
  // expecting it to succeed, so the flag must be forced on here — same mechanism as
  // availability-alerts.service.test.ts.
  const previousFlag = process.env.FF_UNAVAILABLE_LISTINGS;
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = "true";
    ctx = makeService();
  });

  afterEach(() => {
    process.env.FF_UNAVAILABLE_LISTINGS = previousFlag;
  });

  it("marks an owned active flat unavailable", async () => {
    const l = [...ctx.app.listings.values()].find(
      (x) => x.listingType === "flat_house" && x.status === "active"
    )!;
    l.ownerUserId = "owner-1";
    const res = await ctx.svc.setAvailability("owner-1", l.id, false);
    expect(res.is_available).toBe(false);
    expect(res.listing_id).toBe(l.id);
    expect(ctx.app.listings.get(l.id)!.is_available).toBe(false);
  });

  it("flips a listing back to available and rings the waitlist ready", async () => {
    const l = [...ctx.app.listings.values()].find(
      (x) => x.listingType === "flat_house" && x.status === "active"
    )!;
    l.ownerUserId = "owner-1";
    ctx.app.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919999900010",
      user_id: null,
      locale: "en"
    });

    await ctx.svc.setAvailability("owner-1", l.id, false);
    const res = await ctx.svc.setAvailability("owner-1", l.id, true);

    expect(res.is_available).toBe(true);
    expect(ctx.app.listAvailabilityAlerts(l.id)[0]?.status).toBe("ready");
  });

  it("rejects a listing the caller does not own", async () => {
    const l = [...ctx.app.listings.values()].find((x) => x.listingType === "flat_house")!;
    l.ownerUserId = "someone-else";
    await expect(ctx.svc.setAvailability("owner-1", l.id, false)).rejects.toThrow();
  });

  it("rejects a listing that is not a flat/house", async () => {
    const l = [...ctx.app.listings.values()].find(
      (x) => x.listingType === "pg" && x.status === "active"
    )!;
    l.ownerUserId = "owner-1";
    await expect(ctx.svc.setAvailability("owner-1", l.id, false)).rejects.toThrow();
  });

  it("rejects a listing that is not active", async () => {
    const l = [...ctx.app.listings.values()].find((x) => x.status !== "active")!;
    l.ownerUserId = "owner-1";
    l.listingType = "flat_house";
    await expect(ctx.svc.setAvailability("owner-1", l.id, false)).rejects.toThrow();
  });

  it("rejects setAvailability when ff_unavailable_listings is off, and does not mutate is_available", async () => {
    process.env.FF_UNAVAILABLE_LISTINGS = "false";
    const l = [...ctx.app.listings.values()].find(
      (x) => x.listingType === "flat_house" && x.status === "active"
    )!;
    l.ownerUserId = "owner-1";
    const before = ctx.app.listings.get(l.id)!.is_available;

    await expect(ctx.svc.setAvailability("owner-1", l.id, false)).rejects.toMatchObject({
      response: { code: "feature_disabled" }
    });

    expect(ctx.app.listings.get(l.id)!.is_available).toBe(before);
  });
});

describe("OwnerService listing reads expose availability + waitlist_count", () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
  });

  it("exposes is_available and waitlist_count on owner listings", async () => {
    const l = [...ctx.app.listings.values()].find((x) => x.listingType === "flat_house")!;
    l.ownerUserId = "owner-1";
    ctx.app.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000001",
      user_id: null,
      locale: "en"
    });
    const result = await ctx.svc.listOwnerListings("owner-1");
    const row = result.items.find((r: any) => r.id === l.id);
    expect(row!.is_available).toBe(true);
    expect(row!.waitlist_count).toBe(1);
  });

  it("exposes is_available and waitlist_count on a single owner listing", async () => {
    const l = [...ctx.app.listings.values()].find((x) => x.listingType === "flat_house")!;
    l.ownerUserId = "owner-1";
    ctx.app.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000002",
      user_id: null,
      locale: "en"
    });
    const row: any = await ctx.svc.getOwnerListing("owner-1", l.id);
    expect(row.is_available).toBe(true);
    expect(row.waitlist_count).toBe(1);
  });
});
