import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
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
vi.mock("../PgInterestButton", () => ({
  PgInterestButton: ({ children }: { children?: React.ReactNode }) => (
    <button>{children ?? "interested"}</button>
  )
}));

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
    location_point: null,
    total_floors: null,
    verification_status: "verified",
    pg_details: {
      total_beds: 10,
      gender_policy: "girls",
      tenant_type: "students",
      security_deposit_paise: 1500000,
      meal_charges_paise: null,
      deposit_refundable_pct: null,
      maintenance_paise: null,
      notice_period_days: 30,
      lock_in_months: 3,
      electricity_mode: "metered",
      rent_due_day: 5,
      price_negotiable: false,
      payment_modes: ["upi", "cash"],
      meals: null,
      nearby: null,
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
  it("styles the PG detail bottom CTA as a direct card jump", () => {
    const styles = readFileSync("app/globals.css", "utf8");

    expect(styles).toMatch(/\.pg-detail__cta-jump\s*\{[^}]*flex:\s*1/);
    expect(styles).toMatch(/\.pg-detail__cta-jump\s*\{[^}]*min-height:\s*52px/);
  });

  it("keeps desktop gallery inset and only shows room carousel arrows on touch-width screens", () => {
    const styles = readFileSync("app/globals.css", "utf8");

    expect(styles).toMatch(
      /\.tenant-detail-page--pg\s*\{[^}]*max-width:\s*min\(calc\(100% - clamp\(48px,\s*6vw,\s*96px\)\),\s*1320px\)/
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*720px\)[\s\S]*\.tenant-detail-page--pg\s*\{[^}]*max-width:\s*100%/
    );
    expect(styles).toMatch(
      /\.tenant-detail-page--pg \.gallery\s*\{[^}]*margin-inline:\s*var\(--space-4\)/
    );
    expect(styles).toMatch(/\.tenant-detail-page--pg \.gallery\s*\{[^}]*gap:\s*0/);
    expect(styles).toMatch(/\.tenant-detail-page--pg \.gallery\s*\{[^}]*border:\s*0/);
    expect(styles).toMatch(/\.pg-fact-strip\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.pg-fact-strip\s*\{[^}]*border:\s*0/);
    expect(styles).toMatch(/\.pg-fact-strip\s*\{[^}]*box-shadow:\s*none/);
    expect(styles).toMatch(/\.pg-carousel-actions\s*\{[^}]*display:\s*none/);
    expect(styles).toMatch(
      /@media \(max-width:\s*1024px\)[\s\S]*\.pg-carousel-actions\s*\{[^}]*display:\s*flex/
    );
    expect(styles).toMatch(/\.pg-rail-deposit\s*\{[^}]*background:\s*transparent/);
    expect(styles).toMatch(/\.pg-rail-deposit\s*\{[^}]*border:\s*0/);
  });

  it("places share beside PG badges and collapses its label below 560px", () => {
    const { container } = render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);
    const styles = readFileSync("app/globals.css", "utf8");

    const heroTopline = container.querySelector(".pg-hero__topline");
    expect(heroTopline).toBeTruthy();
    expect(heroTopline?.querySelector(".badge--verified")).toBeTruthy();
    expect(within(heroTopline as HTMLElement).getByRole("button", { name: /share/i })).toBeTruthy();
    expect(styles).toMatch(
      /@media \(max-width:\s*559px\)[\s\S]*\.pg-hero__share-label\s*\{[^}]*display:\s*none/
    );
  });

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

  it("does not show vacancy count to tenants", () => {
    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);
    expect(screen.queryByText(/only 1 bed/i)).toBeNull();
    expect(screen.queryByText(/beds left/i)).toBeNull();
  });

  it("keeps visible pricing to rent and move-in terms without all-in monthly copy", () => {
    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);

    const pricing = screen.getByRole("region", { name: /pg pricing and trust summary/i });
    expect(within(pricing).getByText(/^rent$/i)).toBeTruthy();
    expect(within(pricing).getByText("from ₹7,000")).toBeTruthy();
    expect(within(pricing).getByText("per person / month")).toBeTruthy();
    expect(pricing.querySelector(".tenant-cost-card--price")).toBeNull();
    expect(within(pricing).queryByText(/^total monthly cost$/i)).toBeNull();
    expect(screen.queryByText(/Total monthly cost/i)).toBeNull();
    expect(screen.queryByText(/all-in/i)).toBeNull();
  });

  it("uses one interest action in the sticky price card and a mobile jump to it", () => {
    const originalRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };

    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);

    try {
      const interestCard = screen.getByTestId("pg-interest-card");
      const scrollIntoView = vi.fn();
      const focus = vi.fn();
      interestCard.scrollIntoView = scrollIntoView;
      interestCard.focus = focus;

      const cta = document.querySelector(".pg-detail__cta") as HTMLElement;
      expect(cta).toBeTruthy();
      expect(cta.querySelector('a[href="#main-content"]')).toBeNull();
      expect(screen.getAllByText("from ₹7,000")).toHaveLength(3);
      expect(screen.getAllByText("/mo rent")).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: /show interest/i })).toHaveLength(1);

      fireEvent.click(within(cta).getByRole("button", { name: /show interest/i }));

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      window.requestAnimationFrame = originalRaf;
    }
  });

  it("shows free-interest reassurance in the rail without charge or refund copy", () => {
    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);

    const interestCard = screen.getByTestId("pg-interest-card");

    expect(within(interestCard).getByText("₹15,000 security deposit")).toBeTruthy();
    expect(
      within(interestCard).getByText(/The PG operator will contact you shortly/i)
    ).toBeTruthy();
    expect(within(interestCard).getByText(/Showing interest is free/i)).toBeTruthy();
    expect(within(interestCard).queryByText(/won't be charged/i)).toBeNull();
    expect(within(interestCard).queryByText(/Auto-refund/i)).toBeNull();
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

  it("renders CriblMap link from detail location point", () => {
    render(
      <PgDetailClient
        detail={makeDetail({
          location_point: {
            lat: 26.8551,
            lng: 80.941,
            source: "exact",
            label: "Gomti Nagar, Lucknow",
            city_slug: "lucknow",
            locality_slug: "gomti-nagar"
          }
        })}
        city="lucknow"
        locale="en"
      />
    );

    const href = screen.getByRole("link", { name: /criblmap/i }).getAttribute("href")!;
    expect(href).toContain("listing_type=pg");
    expect(href).toContain("city=lucknow");
    expect(href).toContain("lat=26.8551");
    expect(href).toContain("lng=80.941");
    expect(href).toContain("zoom=15");
    expect(href).toContain("listing=L1");
  });

  it("keeps text fallback without link when location point and city are missing", () => {
    const { container } = render(
      <PgDetailClient
        detail={makeDetail({
          city_slug: null,
          locality_slug: null,
          location_point: null
        })}
        city="nowhere"
        locale="en"
      />
    );

    expect(screen.getByRole("heading", { name: /where you'll be/i })).toBeTruthy();
    expect(screen.getAllByText("Location").length).toBeGreaterThan(0);
    expect(container.querySelector('a[href*="/en/map"]')).toBeNull();
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

  it("renders room options in a labelled carousel with previous and next controls", () => {
    render(
      <PgDetailClient
        detail={makeDetail({
          room_types: [
            { ...makeDetail().room_types[0], sharing: "single", monthly_rent_paise: 900000 },
            { ...makeDetail().room_types[0], sharing: "double", monthly_rent_paise: 700000 },
            { ...makeDetail().room_types[0], sharing: "triple", monthly_rent_paise: 600000 }
          ]
        })}
        city="pune"
        locale="en"
      />
    );

    expect(screen.getByTestId("pg-room-carousel")).toBeTruthy();
    expect(screen.getByTestId("pg-room-carousel")).toHaveAttribute(
      "aria-labelledby",
      "pg-room-carousel-label"
    );
    expect(screen.getByRole("button", { name: /previous room type/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /next room type/i })).toBeTruthy();
  });

  it("scrolls room options in response to carousel controls", () => {
    const scrollBy = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollBy");
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: scrollBy
    });

    try {
      render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);

      fireEvent.click(screen.getByRole("button", { name: /previous room type/i }));
      fireEvent.click(screen.getByRole("button", { name: /next room type/i }));

      expect(scrollBy).toHaveBeenNthCalledWith(1, { left: -280, behavior: "smooth" });
      expect(scrollBy).toHaveBeenNthCalledWith(2, { left: 280, behavior: "smooth" });
    } finally {
      if (descriptor) {
        Object.defineProperty(HTMLElement.prototype, "scrollBy", descriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollBy");
      }
    }
  });

  it("does not render the hero price card when the sticky/mobile price surfaces own conversion", () => {
    render(<PgDetailClient detail={makeDetail()} city="pune" locale="en" />);

    expect(screen.queryByTestId("pg-hero-price")).toBeNull();
  });

  it("renders human bathroom labels, not raw enum values", () => {
    render(
      <PgDetailClient
        detail={makeDetail({
          room_types: [{ ...makeDetail().room_types[0], bathroom_kind: "shared_western" }]
        })}
        city="lucknow"
        locale="en"
      />
    );
    expect(screen.queryByText("shared_western")).toBeNull();
    expect(screen.getByText("Shared · Western")).toBeTruthy();
  });

  it("does not show room vacancy when low", () => {
    render(
      <PgDetailClient
        detail={makeDetail({
          room_types: [{ ...makeDetail().room_types[0], vacancy_count: 2 }]
        })}
        city="lucknow"
        locale="en"
      />
    );
    expect(screen.queryByText("2 beds left")).toBeNull();
  });

  it("renders the What's nearby section from nearby data", () => {
    render(
      <PgDetailClient
        detail={makeDetail({
          pg_details: {
            ...makeDetail().pg_details,
            nearby: { metro: ["Munshipulia"], college: [], office: [] }
          }
        })}
        city="lucknow"
        locale="en"
      />
    );
    expect(screen.getByText("What's nearby")).toBeTruthy();
    expect(screen.getByText("Munshipulia")).toBeTruthy();
  });

  it("renders snacks meal chip (snack key)", () => {
    render(
      <PgDetailClient
        detail={makeDetail({
          pg_details: {
            ...makeDetail().pg_details,
            meals: { provided: true, snack: true }
          }
        })}
        city="lucknow"
        locale="en"
      />
    );
    expect(screen.getByText("Snacks")).toBeTruthy();
  });
});
