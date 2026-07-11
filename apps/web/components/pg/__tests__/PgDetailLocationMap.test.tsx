import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PgDetailLocationMap } from "../PgDetailLocationMap";

const pt = {
  lat: 26.8551,
  lng: 80.941,
  source: "exact" as const,
  label: "Gomti Nagar, Lucknow",
  city_slug: "lucknow",
  locality_slug: "gomti-nagar"
};

describe("PgDetailLocationMap", () => {
  it("exact point -> 'Exact location' + CriblMap link with coords + zoom 15", () => {
    render(<PgDetailLocationMap point={pt} citySlug="lucknow" listingId="abc" locale="en" />);

    const href = screen.getByRole("link", { name: /criblmap/i }).getAttribute("href")!;
    expect(href).toContain("listing_type=pg");
    expect(href).toContain("city=lucknow");
    expect(href).toContain("lat=26.8551");
    expect(href).toContain("lng=80.941");
    expect(href).toContain("zoom=15");
    expect(href).toContain("listing=abc");
    expect(screen.getByText(/exact location/i)).toBeTruthy();
  });

  it("locality point -> 'Approximate area', zoom 13", () => {
    render(
      <PgDetailLocationMap
        point={{ ...pt, source: "locality" }}
        citySlug="lucknow"
        listingId="abc"
        locale="en"
      />
    );

    expect(screen.getByText(/approximate area/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /criblmap/i }).getAttribute("href")).toContain(
      "zoom=13"
    );
  });

  it("null point + known city -> city fallback map, 'City area', zoom 12", () => {
    render(<PgDetailLocationMap point={null} citySlug="lucknow" listingId="abc" locale="en" />);

    expect(screen.getByText(/city area/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /criblmap/i }).getAttribute("href")).toContain(
      "zoom=12"
    );
  });

  it("null point + unknown city -> text fallback, no link", () => {
    const { container } = render(
      <PgDetailLocationMap point={null} citySlug="nowhere" listingId="abc" locale="en" />
    );

    expect(container.querySelector("a")).toBeNull();
  });
});
