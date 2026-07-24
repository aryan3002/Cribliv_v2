import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Regression coverage for the Task 8 lesson: a flag check buried only in a
// child component let unavailable-listing UI leak when the flag was OFF.
// Mirrors the `useFlag` mocking pattern established in
// owner/__tests__/listing-card-luxe.availability-flag.test.tsx.
const { flagState } = vi.hoisted(() => ({
  flagState: { ff_unavailable_listings: false } as Record<string, boolean>
}));

vi.mock("../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={typeof href === "string" ? href : href?.pathname} {...props}>
      {children}
    </a>
  )
}));

// Task 13 gave NotifyAvailabilityButton a real useRouter().push() navigation
// — needed so the "flag ON + unavailable" case below (which mounts it) can
// render at all; Next's app-router useRouter() throws without a provider.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() })
}));

// The card's default heart slot pulls in next-auth session + API calls that
// are irrelevant to availability rendering; stub it out to keep this test
// focused on the availability treatment.
vi.mock("../listing-card-heart", () => ({
  ListingCardHeart: () => null
}));

import { ListingCardItem } from "../listing-card";

function baseListing(overrides: Record<string, unknown> = {}) {
  return {
    id: "L1",
    title: "2BHK in Gomti Nagar",
    city: "lucknow",
    listing_type: "flat_house",
    monthly_rent: 18000,
    verification_status: "verified",
    ...overrides
  };
}

beforeEach(() => {
  flagState.ff_unavailable_listings = false;
});

describe("ListingCardItem — availability (ff_unavailable_listings)", () => {
  it("flag ON + is_available:false renders the Unavailable badge and a Notify me button", () => {
    flagState.ff_unavailable_listings = true;
    render(<ListingCardItem listing={baseListing({ is_available: false }) as any} locale="en" />);

    expect(screen.getByText(/not available right now/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /notify me/i })).toBeInTheDocument();
  });

  it("flag ON + available renders a normal card (no badge, no notify button)", () => {
    flagState.ff_unavailable_listings = true;
    render(<ListingCardItem listing={baseListing({ is_available: true }) as any} locale="en" />);

    expect(screen.queryByText(/not available right now/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /notify me/i })).not.toBeInTheDocument();
    // Verified badge logic must stay intact for available cards.
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
  });

  it("flag OFF + is_available:false ignores availability entirely, renders a normal card", () => {
    flagState.ff_unavailable_listings = false;
    render(<ListingCardItem listing={baseListing({ is_available: false }) as any} locale="en" />);

    expect(screen.queryByText(/not available right now/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /notify me/i })).not.toBeInTheDocument();
    // With the flag off, the card renders exactly as it does today — Verified
    // badge included — regardless of is_available.
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
  });
});
