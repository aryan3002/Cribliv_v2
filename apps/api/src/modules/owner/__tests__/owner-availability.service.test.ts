import { describe, it, expect, beforeEach } from "vitest";
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
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctx = makeService();
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
});
