import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { pgListingsResponse } = vi.hoisted(() => ({
  pgListingsResponse: {
    items: [
      {
        id: "pg-lko-1",
        title: "Gomti Nagar PG",
        city: "lucknow",
        city_name: "Lucknow",
        locality: "Gomti Nagar",
        listing_type: "pg",
        starting_rent: 9000,
        sharing_options: ["double"],
        gender_policy: "coed",
        food_included: true,
        verified: true,
        cover_photo: null,
        lat: 26.8551,
        lng: 80.941
      }
    ],
    total: 1,
    page: 1,
    page_size: 12
  }
}));

vi.mock("../../../../../lib/pg-public-api", () => ({
  searchPgListings: async () => pgListingsResponse
}));
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  })
}));
vi.mock("next/navigation", () => ({ notFound }));

import PgCityPage, { generateStaticParams } from "../page";

describe("PG city landing", () => {
  it("generateStaticParams returns the 8 known cities", async () => {
    const params = await generateStaticParams();
    expect(params.map((p) => p.city)).toContain("lucknow");
    expect(params).toHaveLength(8);
  });

  it("renders curated copy for a known city", async () => {
    const ui = await PgCityPage({ params: { locale: "en", city: "lucknow" } });
    render(ui);
    expect(screen.getAllByText(/Verified PGs in Lucknow/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Gomti Nagar/i).length).toBeGreaterThan(0);
  });

  it("renders a full CriblMap link for live city inventory with coordinates", async () => {
    const ui = await PgCityPage({ params: { locale: "en", city: "lucknow" } });
    render(ui);

    const link = screen.getByRole("link", { name: /open full criblmap/i });
    expect(link.getAttribute("href")).toContain("/en/map?");
    expect(link.getAttribute("href")).toContain("city=lucknow");
    expect(link.getAttribute("href")).toContain("listing_type=pg");
  });

  it("calls notFound for an unknown city", async () => {
    await expect(PgCityPage({ params: { locale: "en", city: "atlantis" } })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    expect(notFound).toHaveBeenCalled();
  });
});

describe("PG city landing with no inventory", () => {
  it("does not render a full CriblMap link", async () => {
    pgListingsResponse.items = [];
    pgListingsResponse.total = 0;

    const ui = await PgCityPage({ params: { locale: "en", city: "lucknow" } });
    render(ui);

    expect(screen.queryByRole("link", { name: /open full criblmap/i })).toBeNull();
  });
});
