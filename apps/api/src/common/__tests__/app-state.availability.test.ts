import { describe, it, expect, beforeEach } from "vitest";
import { AppStateService } from "../app-state.service";

describe("AppStateService availability", () => {
  let app: AppStateService;
  beforeEach(() => {
    app = new AppStateService();
  });

  it("listings default to available", () => {
    // `listings` is a Map<string, ListingRecord> (keyed by id), not an array.
    const l = [...app.listings.values()][0];
    if (l) expect(l.is_available).toBe(true);
  });

  it("adds a waitlist alert and lists it, idempotently by phone", () => {
    const listingId = [...app.listings.values()][0]?.id ?? "seed-listing";
    app.addAvailabilityAlert({
      listing_id: listingId,
      phone: "+919999900000",
      user_id: null,
      locale: "en"
    });
    app.addAvailabilityAlert({
      listing_id: listingId,
      phone: "+919999900000",
      user_id: null,
      locale: "en"
    });
    expect(app.listAvailabilityAlerts(listingId)).toHaveLength(1);
  });

  it("returns already_on_list: true on duplicate add and keeps the original alert", () => {
    const listingId = [...app.listings.values()][0]?.id ?? "seed-listing";
    const first = app.addAvailabilityAlert({
      listing_id: listingId,
      phone: "+919999900001",
      user_id: null,
      locale: "en"
    });
    const second = app.addAvailabilityAlert({
      listing_id: listingId,
      phone: "+919999900001",
      user_id: null,
      locale: "en"
    });

    expect(first.already_on_list).toBe(false);
    expect(second.already_on_list).toBe(true);
    expect(second.alert.id).toBe(first.alert.id);
  });

  it("setListingAvailability flips waiting alerts to ready when set to true", () => {
    const listingId = [...app.listings.values()][0]?.id ?? "seed-listing";
    app.addAvailabilityAlert({
      listing_id: listingId,
      phone: "+919999900002",
      user_id: null,
      locale: "en"
    });

    app.setListingAvailability(listingId, false);
    let alerts = app.listAvailabilityAlerts(listingId);
    expect(alerts[0]?.status).toBe("waiting");
    expect(alerts[0]?.ready_at).toBeNull();

    const updated = app.setListingAvailability(listingId, true);
    expect(updated?.is_available).toBe(true);

    alerts = app.listAvailabilityAlerts(listingId);
    expect(alerts[0]?.status).toBe("ready");
    expect(alerts[0]?.ready_at).not.toBeNull();
  });

  it("setListingAvailability returns null for an unknown listing id", () => {
    expect(app.setListingAvailability("does-not-exist", true)).toBeNull();
  });
});
