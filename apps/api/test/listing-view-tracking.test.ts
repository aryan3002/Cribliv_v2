import { describe, it, expect, vi } from "vitest";
import { ListingsController } from "../src/modules/listings/listings.controller";

const UUID = "11111111-1111-4111-8111-111111111111";

function detailRow(ownerId: string) {
  return {
    id: UUID,
    owner_user_id: ownerId,
    title: "Sunrise PG",
    description: null,
    listing_type: "pg",
    monthly_rent: 9000,
    verification_status: "verified",
    city: "delhi",
    locality: null,
    lat: null,
    lng: null,
    bhk: null,
    bathrooms: null,
    area_sqft: null,
    furnishing: null,
    preferred_tenant: null,
    security_deposit: null,
    available_from: null,
    whatsapp_available: false,
    amenities: [],
    rules: null,
    owner_phone: null,
    owner_full_name: null,
    owner_created_at: null,
    owner_preferred_language: null,
    pg_total_beds: 10,
    pg_occupancy_type: null,
    pg_room_sharing_options: [],
    pg_food_included: false,
    pg_curfew_time: null,
    pg_attached_bathroom: false,
    photos: []
  };
}

describe("ListingsController.detail — view recording", () => {
  it("records a 'view' for a non-owner (anonymous) viewer", async () => {
    const db = {
      isEnabled: () => true,
      query: vi.fn(async () => ({ rows: [detailRow("owner-1")], rowCount: 1 }))
    };
    const analytics = { trackEvent: vi.fn(async () => undefined) };
    const ctrl = new ListingsController({} as any, db as any, analytics as any);

    const res: any = await ctrl.detail(UUID, undefined);
    expect(res.data.listing_detail.id).toBe(UUID);
    expect(analytics.trackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ listing_id: UUID, event_type: "view" })
    );
  });

  it("does NOT record a view when the owner previews their own listing", async () => {
    const db = {
      isEnabled: () => true,
      query: vi.fn(async (sql: string) => {
        if (/FROM sessions/i.test(sql)) return { rows: [{ user_id: "owner-1" }], rowCount: 1 };
        return { rows: [detailRow("owner-1")], rowCount: 1 };
      })
    };
    const analytics = { trackEvent: vi.fn(async () => undefined) };
    const ctrl = new ListingsController({} as any, db as any, analytics as any);

    // Auth header resolves (via sessions) to owner-1 == the listing owner.
    await ctrl.detail(UUID, "Bearer acc_22222222-2222-2222-2222-222222222222");
    expect(analytics.trackEvent).not.toHaveBeenCalled();
  });
});
