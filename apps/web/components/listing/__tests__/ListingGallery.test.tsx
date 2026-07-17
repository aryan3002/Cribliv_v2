import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ListingGallery } from "../listing-gallery";

const trackEvent = vi.fn();
let flagEnabled = true;
let localSession: { access_token: string } | null = null;

vi.mock("../../../lib/feature-flags", () => ({
  useFlag: () => flagEnabled
}));
vi.mock("../../../lib/client-auth", () => ({
  readAuthSession: () => localSession
}));
vi.mock("../../../lib/analytics", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args)
}));

beforeEach(() => {
  flagEnabled = true;
  localSession = null;
  trackEvent.mockClear();
});

describe("ListingGallery", () => {
  it("routes gated gallery signup back to the listing that opened it", () => {
    render(
      <ListingGallery
        photos={["/cover.jpg", "/locked.jpg"]}
        title="Sunrise PG"
        locale="en"
        isGuest
        returnPath="/en/pg/lucknow/L1"
      />
    );

    const cta = screen.getByTestId("gallery-gate-cta");

    expect(cta).toHaveAttribute("href", "/en/auth/login?tab=signup&from=%2Fen%2Fpg%2Flucknow%2FL1");

    cta.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(cta);
    expect(trackEvent).toHaveBeenCalledWith("guest_gate_signup_clicked", { surface: "gallery" });
  });

  it("keeps extra photos visibly locked for guests", () => {
    render(
      <ListingGallery
        photos={["/cover.jpg", "/locked.jpg"]}
        title="Sunrise PG"
        locale="en"
        isGuest
        returnPath="/en/pg/lucknow/L1"
      />
    );

    expect(screen.getByTestId("pg-thumb-1").querySelector("img")).toHaveStyle({
      filter: "blur(10px)"
    });
  });

  it("refuses unsafe return paths in signup URLs", () => {
    render(
      <ListingGallery
        photos={["/cover.jpg", "/locked.jpg"]}
        title="Sunrise PG"
        locale="en"
        isGuest
        returnPath="https://bad.example/phish"
      />
    );

    expect(screen.getByTestId("gallery-gate-cta")).toHaveAttribute(
      "href",
      "/en/auth/login?tab=signup"
    );
  });
});
