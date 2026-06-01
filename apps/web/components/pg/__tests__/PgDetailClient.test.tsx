import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PgPublicDetail } from "../../../lib/pg-public-api";

const detailView = vi.fn();
const photoViewed = vi.fn();
const share = vi.fn();
const similarClick = vi.fn();
vi.mock("../../../lib/pg-track", () => ({
  trackPgDetailView: (...a: unknown[]) => detailView(...a),
  trackPgPhotoViewed: (...a: unknown[]) => photoViewed(...a),
  trackPgShare: (...a: unknown[]) => share(...a),
  trackPgSimilarClicked: (...a: unknown[]) => similarClick(...a),
  trackPgInterestClicked: vi.fn(),
  trackPgInterestSubmitted: vi.fn()
}));
vi.mock("../../../lib/pg-public-api", async (orig) => ({
  ...(await orig<typeof import("../../../lib/pg-public-api")>()),
  searchPgListings: vi.fn(async () => ({ items: [], total: 0, page: 1, page_size: 4 }))
}));
vi.mock("../PgInterestButton", () => ({ PgInterestButton: () => <button>interested</button> }));

import { PgDetailClient } from "../PgDetailClient";

function makeDetail(over: Partial<PgPublicDetail> = {}): PgPublicDetail {
  return {
    id: "L1",
    status: "active",
    title: "Sunrise PG",
    monthly_rent: 7000,
    created_at: null,
    city_slug: "pune",
    locality_slug: "kothrud",
    pg_details: {
      total_beds: 10,
      gender_policy: "girls",
      tenant_type: "students",
      security_deposit_paise: 1500000,
      notice_period_days: 30,
      lock_in_months: 3,
      electricity_mode: "metered",
      rent_due_day: 5,
      price_negotiable: false,
      payment_modes: ["upi", "cash"],
      meals: null,
      amenities: { wifi: true, parking: false, unknown_x: true },
      house_rules: { smoking: "no" }
    },
    room_types: [
      {
        sharing: "double",
        ac: true,
        bathroom_kind: "attached",
        furnishing: "full",
        monthly_rent_paise: 700000,
        vacancy_count: 1,
        available_from: null
      }
    ],
    photos: [
      { blob_path: "p1.jpg", is_cover: true },
      { blob_path: "p2.jpg", is_cover: false }
    ],
    ...over
  };
}

beforeEach(() => {
  detailView.mockClear();
  photoViewed.mockClear();
  share.mockClear();
});

describe("PgDetailClient", () => {
  it("fires pg_detail_viewed + view once on mount", () => {
    const { rerender } = render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);
    rerender(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);
    expect(detailView).toHaveBeenCalledTimes(1);
    expect(detailView).toHaveBeenCalledWith(
      expect.objectContaining({ listing_id: "L1", city: "pune" })
    );
  });

  it("swaps main photo + tracks pg_photo_viewed on thumbnail click", () => {
    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);
    fireEvent.click(screen.getByTestId("pg-thumb-1"));
    expect(photoViewed).toHaveBeenCalledWith("L1", 1);
  });

  it("shows 'Only N beds left' when total vacancy <= 3", () => {
    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);
    expect(screen.getByText(/only 1 bed/i)).toBeTruthy();
  });

  it("hides vacancy urgency when plenty available", () => {
    render(
      <PgDetailClient
        detail={makeDetail({
          room_types: [
            {
              sharing: "double",
              ac: true,
              bathroom_kind: null,
              furnishing: null,
              monthly_rent_paise: 700000,
              vacancy_count: 50,
              available_from: null
            }
          ]
        })}
        city="pune"
        locale="en"
      />
    );
    expect(screen.queryByText(/beds left/i)).toBeNull();
  });

  it("renders only present facts (null deposit → no deposit card)", () => {
    const d = makeDetail();
    d.pg_details.security_deposit_paise = null;
    render(<PgDetailClient detail={d} city="pune" locale="en" />);
    expect(screen.queryByText(/security deposit/i)).toBeNull();
    expect(screen.getByText(/notice period/i)).toBeTruthy();
  });

  it("renders amenities with truthy values only; unknown key gets generic icon", () => {
    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);
    expect(screen.getByText(/wifi/i)).toBeTruthy();
    expect(screen.queryByText(/parking/i)).toBeNull(); // value false
    expect(screen.getByText(/unknown_x/i)).toBeTruthy();
  });

  it("omits house rules when empty", () => {
    render(
      <PgDetailClient
        detail={makeDetail({ pg_details: { ...makeDetail().pg_details, house_rules: {} } })}
        city="pune"
        locale="en"
      />
    );
    expect(screen.queryByText(/house rules/i)).toBeNull();
  });

  it("share button fires trackPgShare", async () => {
    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);
    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith(expect.objectContaining({ listing_id: "L1" }))
    );
  });
});
