import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HomeHeroMap } from "../../../components/home-hero-map";

const MARKERS = [
  { id: "a", xPct: 40, yPct: 30, rentLabel: "₹14,000" },
  { id: "b", xPct: 70, yPct: 60, rentLabel: "₹6,000" }
];

describe("HomeHeroMap", () => {
  it("renders one price pill per marker at projected positions", () => {
    const { container } = render(
      <HomeHeroMap markers={MARKERS} featured={null} featuredHref={null} locale="en" />
    );
    const pills = container.querySelectorAll(".hero-map__marker");
    expect(pills).toHaveLength(2);
    expect(pills[0].textContent).toContain("₹14,000");
    expect((pills[0] as HTMLElement).style.left).toBe("40%");
    expect((pills[0] as HTMLElement).style.top).toBe("30%");
  });

  it("renders the SVG art and no markers when the market is empty", () => {
    const { container } = render(
      <HomeHeroMap markers={[]} featured={null} featuredHref={null} locale="en" />
    );
    expect(container.querySelector(".hero-map__art")).toBeTruthy();
    expect(container.querySelectorAll(".hero-map__marker")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/unavailable|error/i);
  });

  it("shows the featured listing card only when a photo listing is provided", () => {
    const listing = {
      id: "l1",
      title: "3BHK Semi-Furnished Flat in LDA Colony, Lucknow",
      locality: "LDA Colony",
      monthly_rent: 20000,
      cover_photo: "https://example.com/p.jpg",
      verification_status: "verified" as const
    };
    const { container } = render(
      <HomeHeroMap markers={[]} featured={listing} featuredHref="/en/listing/l1" locale="en" />
    );
    const card = container.querySelector(".hero-map__card");
    expect(card).toBeTruthy();
    expect(card?.textContent).toContain("₹20,000");
    expect(card?.getAttribute("href")).toBe("/en/listing/l1");
  });
});
