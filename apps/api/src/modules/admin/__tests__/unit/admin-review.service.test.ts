import { describe, expect, it, vi } from "vitest";
import { AdminReviewService } from "../../admin-review.service";

function makeService(queryImpl: ReturnType<typeof vi.fn>) {
  const database = { isEnabled: () => true, query: queryImpl } as any;
  const appState = { listings: new Map(), users: new Map() } as any;
  const sas = {
    issue: vi.fn(() => ({ url: "https://x", expiresAt: "2026-01-01T00:00:00.000Z" }))
  } as any;
  return new AdminReviewService(database, appState, sas);
}

describe("AdminReviewService.getListingDetail", () => {
  it("assembles listing + owner + photos + verification for a flat_house listing", async () => {
    const query = vi
      .fn()
      // 1. main row
      .mockResolvedValueOnce({
        rows: [
          {
            id: "L1",
            listing_type: "flat_house",
            title_en: "2BHK",
            title_hi: null,
            description_en: "nice",
            description_hi: null,
            status: "pending_review",
            verification_status: "pending",
            monthly_rent: 32000,
            security_deposit: 160000,
            available_from: "2026-08-01",
            furnishing: "semi_furnished",
            bhk: 2,
            bathrooms: 2,
            area_sqft: 1100,
            preferred_tenant: "family",
            whatsapp_available: true,
            amenities: ["Parking", "Lift"],
            rules: { smoking: false },
            created_at: "2026-07-12T10:00:00.000Z",
            address_line1: "142, 5th Cross",
            landmark: "Forum Mall",
            pincode: "560034",
            lat: 12.93,
            lng: 77.62,
            masked_address: "Koramangala, Bengaluru",
            locality_name: "Koramangala",
            city_slug: "bengaluru",
            city_name: "Bengaluru",
            owner_id: "O1",
            owner_name: "Ramesh Kumar",
            owner_phone: "+919876543210",
            owner_whatsapp: true,
            owner_language: "hi",
            owner_role: "owner",
            owner_blocked: false,
            owner_created_at: "2024-07-01T00:00:00.000Z"
          }
        ],
        rowCount: 1
      })
      // 2. owner aggregates
      .mockResolvedValueOnce({ rows: [{ active_listings: 4, report_count: 0 }], rowCount: 1 })
      // 3. photos
      .mockResolvedValueOnce({
        rows: [
          {
            blob_path: "L1/cover.jpg",
            is_cover: true,
            sort_order: 0,
            moderation_status: "approved"
          }
        ],
        rowCount: 1
      })
      // 4. verification attempts
      .mockResolvedValueOnce({
        rows: [
          {
            id: "V1",
            verification_type: "video_liveness",
            result: "manual_review",
            liveness_score: 82,
            address_match_score: null,
            threshold: 85,
            artifact_paths: ["L1/verification/video_liveness/clip.mp4"],
            created_at: "2026-07-12T10:05:00.000Z",
            provider: "mock",
            provider_result_code: "LOW_CONFIDENCE",
            review_reason: "score below threshold"
          }
        ],
        rowCount: 1
      });

    const svc = makeService(query);
    const detail = await svc.getListingDetail("L1");

    expect(detail).not.toBeNull();
    expect(detail!.listing.title_en).toBe("2BHK");
    expect(detail!.owner).toMatchObject({
      name: "Ramesh Kumar",
      phone: "+919876543210",
      active_listings: 4,
      report_count: 0
    });
    expect(detail!.photos).toHaveLength(1);
    expect(detail!.photos[0].is_cover).toBe(true);
    expect(detail!.pg).toBeNull();
    expect(detail!.verification).toHaveLength(1);
    expect(detail!.verification[0]).toMatchObject({
      attempt_id: "V1",
      kind: "video_liveness",
      liveness_score: 82,
      threshold: 85,
      artifact_available: true
    });
    // flat_house: no pg queries (main, owner-agg, photos, verification = 4 calls)
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("returns null when the listing does not exist", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const svc = makeService(query);
    expect(await svc.getListingDetail("missing")).toBeNull();
  });
});
