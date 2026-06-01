import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../../../lib/pg-public-api", () => ({
  searchPgListings: async () => ({ items: [], total: 0, page: 1, page_size: 12 })
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
    expect(screen.getByText(/Verified PGs in Lucknow/i)).toBeTruthy();
    expect(screen.getAllByText(/Gomti Nagar/i).length).toBeGreaterThan(0);
  });

  it("calls notFound for an unknown city", async () => {
    await expect(PgCityPage({ params: { locale: "en", city: "atlantis" } })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    expect(notFound).toHaveBeenCalled();
  });
});
