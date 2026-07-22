import { describe, it, expect, beforeEach } from "vitest";
import { ListingsController } from "../listings.controller";
import { AppStateService } from "../../../common/app-state.service";
import { DatabaseService } from "../../../common/database.service";
import { AnalyticsService } from "../../analytics/analytics.service";

// `AppStateService.listings` is a `Map<string, ListingRecord>` keyed by id, not an
// array — iterate via `.values()` / read via `.get(id)`. Field names on ListingRecord
// are camelCase (`listingType`, `verificationStatus`) except `is_available`, which
// mirrors the DB column name verbatim (see app-state.service.ts).
//
// `database.isEnabled()` is forced to `false` so `ListingsController.detail()` always
// takes the in-memory branch (the DB branch requires a real Postgres connection).
function makeController() {
  const app = new AppStateService();
  const db = { isEnabled: () => false } as unknown as DatabaseService;
  const analytics = {} as unknown as AnalyticsService;
  const controller = new ListingsController(app, db, analytics);
  return { app, controller };
}

describe("ListingsController.detail exposes availability", () => {
  let ctx: ReturnType<typeof makeController>;
  beforeEach(() => {
    ctx = makeController();
  });

  it("returns is_available on the detail payload for an active listing", async () => {
    const l = [...ctx.app.listings.values()].find(
      (x) => x.status === "active" && x.listingType === "flat_house"
    )!;
    const res: any = await ctx.controller.detail(l.id, undefined, undefined);
    expect(res.data.listing_detail).toHaveProperty("is_available");
    expect(res.data.listing_detail.is_available).toBe(true);
  });

  it("reflects waitlist_count from waiting + ready alerts on the detail payload", async () => {
    const l = [...ctx.app.listings.values()].find(
      (x) => x.status === "active" && x.listingType === "flat_house"
    )!;
    ctx.app.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000010",
      user_id: null,
      locale: "en"
    });
    ctx.app.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000011",
      user_id: null,
      locale: "en"
    });

    const res: any = await ctx.controller.detail(l.id, undefined, undefined);
    expect(res.data.listing_detail.waitlist_count).toBe(2);
  });

  it("does not count cancelled/notified alerts toward waitlist_count", async () => {
    const l = [...ctx.app.listings.values()].find(
      (x) => x.status === "active" && x.listingType === "flat_house"
    )!;
    const { alert } = ctx.app.addAvailabilityAlert({
      listing_id: l.id,
      phone: "+919000000012",
      user_id: null,
      locale: "en"
    });
    alert.status = "cancelled";

    const res: any = await ctx.controller.detail(l.id, undefined, undefined);
    expect(res.data.listing_detail.waitlist_count).toBe(0);
  });
});
