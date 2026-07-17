import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PgListingCard } from "../PgListingCard";
import type { PgCard } from "../../../lib/pg-public-api";

const clickMock = vi.fn();
vi.mock("../../../lib/pg-track", () => ({
  trackPgCardClick: (...a: unknown[]) => clickMock(...a)
}));

const base: PgCard = {
  id: "abc",
  title: "Sunrise PG",
  city: "lucknow",
  city_name: "Lucknow",
  locality: "Gomti Nagar",
  listing_type: "pg",
  starting_rent: 7000,
  sharing_options: ["single", "double"],
  gender_policy: "girls",
  food_included: true,
  verified: true,
  cover_photo: null,
  lat: null,
  lng: null
};

describe("PgListingCard", () => {
  beforeEach(() => clickMock.mockClear());
  it("renders title, rent-from, sharing chips, gender + food + verified badges", () => {
    render(<PgListingCard listing={base} locale="en" />);
    expect(screen.getByText("Sunrise PG")).toBeTruthy();
    expect(screen.getByText(/from ₹7,000/i)).toBeTruthy();
    expect(screen.getByText(/single/i)).toBeTruthy();
    expect(screen.getByText(/double/i)).toBeTruthy();
    expect(screen.getByText(/girls/i)).toBeTruthy();
    expect(screen.getByText(/food/i)).toBeTruthy();
    expect(screen.getByText(/verified/i)).toBeTruthy();
  });

  it("renders a horizontally scrollable PG feature strip with controls", () => {
    render(<PgListingCard listing={base} locale="en" />);

    const strip = screen.getByTestId("pg-card-strip");
    expect(strip).toHaveTextContent(/single/i);
    expect(strip).toHaveTextContent(/double/i);
    expect(strip).toHaveTextContent(/girls/i);
    expect(strip).toHaveTextContent(/food/i);
    expect(screen.getByRole("button", { name: /previous pg feature/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /next pg feature/i })).toBeTruthy();
  });

  it("links to /[locale]/pg/[city]/[id] and shows no BHK/area", () => {
    const { container } = render(<PgListingCard listing={base} locale="en" />);
    const link = container.querySelector('a[href="/en/pg/lucknow/abc"]');
    expect(link).toBeTruthy();
    expect(screen.queryByText(/BHK/i)).toBeNull();
    expect(screen.queryByText(/sqft/i)).toBeNull();
  });
});

describe("PgListingCard click tracking", () => {
  beforeEach(() => clickMock.mockClear());

  it("fires trackPgCardClick with position + surface on click", () => {
    render(
      <PgListingCard
        listing={base}
        locale="en"
        position={3}
        surface="pg_search"
        filters={{ gender: "girls" }}
      />
    );
    fireEvent.click(screen.getByText("Sunrise PG"));
    expect(clickMock).toHaveBeenCalledWith(
      expect.objectContaining({ listing_id: "abc", position: 3, surface: "pg_search" })
    );
  });

  it("defaults filters to {} when omitted", () => {
    render(<PgListingCard listing={base} locale="en" position={0} surface="pg_city" />);
    fireEvent.click(screen.getByText("Sunrise PG"));
    expect(clickMock).toHaveBeenCalledWith(expect.objectContaining({ filters: {} }));
  });
});
