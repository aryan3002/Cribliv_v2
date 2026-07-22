import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ListingCardLuxe } from "../listing-card-luxe";
import { toggleListingAvailability, type OwnerListingVm } from "../../../lib/owner-api";

// Regression coverage for: ListingCardLuxe never checked ff_unavailable_listings
// itself — only the child ListingAvailabilityToggle self-gated (`if (!flagOn)
// return null`). With the flag off, the waitlist nudge still rendered real
// data and the toggle's wrapper divs (which carry visible box styling in the
// actions sheet, `.lcl-sheet__availability`) still rendered an empty shell.
// Mirrors the `useFlag` mocking pattern from `listing-availability-toggle.test.tsx`.
const { flagState } = vi.hoisted(() => ({
  flagState: { ff_unavailable_listings: false } as Record<string, boolean>
}));

vi.mock("../../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={typeof href === "string" ? href : href?.pathname} {...props}>
      {children}
    </a>
  )
}));

vi.mock("next/image", () => ({
  default: ({ alt, src, ...props }: any) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} {...props} />
  )
}));

vi.mock("../seeker-near-widget", () => ({
  SeekerNearWidget: () => null
}));

vi.mock("../../../lib/owner-api", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/owner-api")>("../../../lib/owner-api");
  return {
    ...actual,
    toggleListingAvailability: vi.fn(),
    setListingAvailability: vi.fn()
  };
});

const toggleListingAvailabilityMock = vi.mocked(toggleListingAvailability);

function listing(overrides: Partial<OwnerListingVm> = {}): OwnerListingVm {
  return {
    id: "listing-1",
    title: "Koregaon Park Studio",
    city: "Pune",
    locality: "Koregaon Park",
    listingType: "flat_house",
    monthlyRent: 32000,
    status: "active",
    verificationStatus: "unverified",
    createdAt: "2026-07-11T00:00:00.000Z",
    is_available: false,
    waitlist_count: 5,
    ...overrides
  };
}

function renderCard(item: OwnerListingVm) {
  return render(
    <ListingCardLuxe
      listing={item}
      locale="en"
      accessToken="owner-token"
      onStatusChange={vi.fn()}
      onAvailabilityChange={vi.fn()}
      onBoost={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.style.overflow = "";
  flagState.ff_unavailable_listings = false;
  toggleListingAvailabilityMock.mockResolvedValue({ listingId: "listing-1", status: "paused" });
});

describe("ListingCardLuxe availability flag gating", () => {
  it("hides the waitlist nudge and renders no empty availability box when the flag is off", () => {
    flagState.ff_unavailable_listings = false;
    const { container } = renderCard(
      listing({ status: "active", is_available: false, waitlist_count: 5 })
    );

    expect(screen.queryByText(/people want to be notified/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: /availability/i })).not.toBeInTheDocument();

    // Open the "More actions" sheet and confirm no availability wrapper box
    // (which carries border/padding/background styling) renders empty. Note:
    // `.lcl-sheet__availability` is shared by BOTH the old Visibility toggle's
    // wrapper (still valid here — unrelated to this flag) and the new
    // Availability toggle's wrapper, so we can't just assert the class is
    // absent — we must assert none of the matching boxes are empty shells.
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const boxes = container.querySelectorAll(".lcl-sheet__availability");
    const emptyBoxes = Array.from(boxes).filter((box) => box.childElementCount === 0);
    expect(emptyBoxes).toHaveLength(0);
  });

  it("shows the waitlist nudge when the flag is on for an active flat_house listing", () => {
    flagState.ff_unavailable_listings = true;
    renderCard(listing({ status: "active", is_available: false, waitlist_count: 5 }));

    expect(
      screen.getByText(/5 people want to be notified when this is available/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /availability/i })).toBeInTheDocument();
  });

  it("hides the waitlist nudge on a paused listing even when the flag is on", () => {
    flagState.ff_unavailable_listings = true;
    renderCard(listing({ status: "paused", is_available: false, waitlist_count: 5 }));

    expect(screen.queryByText(/people want to be notified/i)).not.toBeInTheDocument();
  });
});
