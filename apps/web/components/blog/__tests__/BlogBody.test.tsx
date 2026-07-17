import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/blog-embed-cards", () => ({
  fetchListingCard: vi.fn(),
  fetchPgCard: vi.fn()
}));

import { BlogBody } from "../BlogBody";
import { fetchListingCard, fetchPgCard } from "../../../lib/blog-embed-cards";

const mockedListing = vi.mocked(fetchListingCard);
const mockedPg = vi.mocked(fetchPgCard);

const LID = "11111111-2222-4333-8444-555555555555";
const PID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeEach(() => vi.clearAllMocks());

async function renderBody(html: string) {
  const ui = await BlogBody({ html, locale: "en", slug: "my-post" });
  render(ui);
}

describe("BlogBody", () => {
  it("renders html around a live listing card, in order, with a crawlable link", async () => {
    mockedListing.mockResolvedValue({
      id: LID,
      title: "2BHK in Gomti Nagar",
      city: "lucknow",
      city_name: null,
      locality: "gomti-nagar",
      listing_type: "flat_house",
      monthly_rent: 18000,
      bhk: 2,
      furnishing: "semi_furnished",
      area_sqft: 900,
      verification_status: "verified",
      cover_photo: null
    });

    await renderBody(`<p>Intro para</p>{{listing:${LID}}}<p>Outro para</p>`);

    expect(screen.getByText("Intro para")).toBeInTheDocument();
    expect(screen.getByText("Outro para")).toBeInTheDocument();
    expect(screen.getByText("2BHK in Gomti Nagar")).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain(`/en/listing/${LID}`);
  });

  it("renders nothing for an unavailable listing but keeps the surrounding html", async () => {
    mockedListing.mockResolvedValue(null);

    await renderBody(`<p>Before</p>{{listing:${LID}}}<p>After</p>`);

    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders a PG card linking to the pg route", async () => {
    mockedPg.mockResolvedValue({
      id: PID,
      title: "Cozy PG",
      city: "lucknow",
      city_name: null,
      locality: "hazratganj",
      listing_type: "pg",
      starting_rent: 9000,
      sharing_options: ["double"],
      gender_policy: "female",
      food_included: true,
      verified: true,
      cover_photo: null,
      lat: null,
      lng: null
    });

    await renderBody(`{{pg:lucknow/${PID}}}`);

    expect(screen.getByText("Cozy PG")).toBeInTheDocument();
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain(`/en/pg/lucknow/${PID}`);
  });
});
