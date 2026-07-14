import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminListings: vi.fn(),
  decideAdminListing: vi.fn(),
  fetchAdminListingDetail: vi.fn()
}));
vi.mock("../../pg-properties/LocationMapPicker", () => ({ LocationMapPicker: () => <div /> }));

import { ListingReviewTab } from "../ListingReviewTab";
import { fetchAdminListings, fetchAdminListingDetail } from "../../../../lib/admin-api";

const mockedList = vi.mocked(fetchAdminListings);
const mockedDetail = vi.mocked(fetchAdminListingDetail);

describe("ListingReviewTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the workspace when a row is clicked", async () => {
    mockedList.mockResolvedValueOnce({
      items: [
        {
          id: "L1",
          title: "2BHK",
          listingType: "flat_house",
          status: "pending_review",
          ownerUserId: "O1",
          verificationStatus: "pending",
          createdAt: "2026-07-12T10:00:00.000Z",
          city: "bengaluru",
          monthlyRent: 32000
        }
      ],
      total: 1
    } as any);
    mockedDetail.mockResolvedValueOnce({
      listing: {
        id: "L1",
        listing_type: "flat_house",
        title_en: "2BHK",
        title_hi: null,
        description_en: null,
        description_hi: null,
        status: "pending_review",
        verification_status: "pending",
        monthly_rent: 32000,
        security_deposit: null,
        available_from: null,
        furnishing: null,
        bhk: 2,
        bathrooms: 1,
        area_sqft: null,
        preferred_tenant: null,
        whatsapp_available: false,
        amenities: [],
        rules: {},
        created_at: "2026-07-12T10:00:00.000Z"
      },
      location: null,
      owner: {
        id: "O1",
        name: "Ramesh",
        phone: "+91",
        whatsapp_opt_in: false,
        preferred_language: null,
        role: "owner",
        is_blocked: false,
        member_since: null,
        active_listings: 1,
        report_count: 0
      },
      photos: [],
      pg: null,
      verification: []
    } as any);

    render(<ListingReviewTab accessToken="tok" onToast={vi.fn()} onCountChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("2BHK")).toBeInTheDocument());
    fireEvent.click(screen.getByText("2BHK"));
    await waitFor(() => expect(screen.getByText(/back to queue/i)).toBeInTheDocument());
  });
});
