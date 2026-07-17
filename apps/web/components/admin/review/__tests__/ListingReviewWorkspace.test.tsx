// apps/web/components/admin/review/__tests__/ListingReviewWorkspace.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminListingDetail: vi.fn()
}));
vi.mock("../../pg-properties/LocationMapPicker", () => ({ LocationMapPicker: () => <div /> }));

import { ListingReviewWorkspace } from "../ListingReviewWorkspace";
import { fetchAdminListingDetail } from "../../../../lib/admin-api";

const mockedDetail = vi.mocked(fetchAdminListingDetail);

const detail = {
  listing: {
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
    available_from: null,
    furnishing: "semi_furnished",
    bhk: 2,
    bathrooms: 2,
    area_sqft: 1100,
    preferred_tenant: "family",
    whatsapp_available: true,
    amenities: ["Parking"],
    rules: {},
    created_at: "2026-07-12T10:00:00.000Z"
  },
  location: { address_line1: "142", city_name: "Bengaluru", lat: null, lng: null },
  owner: {
    id: "O1",
    name: "Ramesh Kumar",
    phone: "+919876543210",
    whatsapp_opt_in: true,
    preferred_language: "hi",
    role: "owner",
    is_blocked: false,
    member_since: null,
    active_listings: 4,
    report_count: 0
  },
  photos: [],
  pg: null,
  verification: []
};

describe("ListingReviewWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads and renders owner + title", async () => {
    mockedDetail.mockResolvedValueOnce(detail as any);
    render(
      <ListingReviewWorkspace
        accessToken="tok"
        listingId="L1"
        onBack={vi.fn()}
        onDecide={vi.fn()}
        busy={null}
        onToast={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(screen.getByText("2BHK")).toBeInTheDocument();
      expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
    });
  });
});
