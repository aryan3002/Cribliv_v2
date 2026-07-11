import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("../../../../lib/pg-public-api", () => ({
  searchPgListings: async () => ({
    items: [
      {
        id: "a1",
        title: "PG One",
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
    page_size: 20
  })
}));

import PgPage from "../page";

describe("/pg browse map", () => {
  it("does not render the old static-aside labels", async () => {
    render(await PgPage({ params: { locale: "en" }, searchParams: { city: "lucknow" } }));

    expect(screen.queryByText("PG · ₹9.5k")).toBeNull();
    expect(screen.queryByText("Verified PG")).toBeNull();
  });

  it("links to full CriblMap with listing_type=pg and city", async () => {
    render(await PgPage({ params: { locale: "en" }, searchParams: { city: "lucknow" } }));

    const link = screen.getByRole("link", { name: /criblmap/i });
    expect(link.getAttribute("href")).toContain("listing_type=pg");
    expect(link.getAttribute("href")).toContain("city=lucknow");
  });
});
