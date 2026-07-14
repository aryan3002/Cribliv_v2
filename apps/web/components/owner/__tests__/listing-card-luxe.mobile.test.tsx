import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ListingCardLuxe } from "../listing-card-luxe";
import { toggleListingAvailability, type OwnerListingVm } from "../../../lib/owner-api";

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
    toggleListingAvailability: vi.fn()
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
      onBoost={vi.fn()}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.style.overflow = "";
  toggleListingAvailabilityMock.mockResolvedValue({ listingId: "listing-1", status: "paused" });
});

describe("ListingCardLuxe mobile actions", () => {
  it("keeps the Edit command visible on a compact card", () => {
    renderCard(listing());

    expect(screen.getByRole("link", { name: /edit/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /more actions/i })).toBeVisible();
  });

  it("shows a labelled availability switch with a 44px control", () => {
    renderCard(listing());

    const availability = screen.getByRole("checkbox", { name: /available to tenants/i });
    expect(availability).toBeVisible();
    expect(availability.closest(".availability-toggle")).toHaveClass("availability-toggle--touch");
  });

  it("moves boost and verification into the mobile More actions sheet", () => {
    const onBoost = vi.fn();
    render(
      <ListingCardLuxe
        listing={listing()}
        locale="en"
        accessToken="owner-token"
        onStatusChange={vi.fn()}
        onBoost={onBoost}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));

    const sheet = screen.getByRole("dialog", { name: /listing actions/i });
    expect(within(sheet).getByRole("link", { name: /verify listing/i })).toBeVisible();
    fireEvent.click(within(sheet).getByRole("button", { name: /boost/i }));
    expect(onBoost).toHaveBeenCalledWith(expect.objectContaining({ id: "listing-1" }));
  });

  it("uses Fix and resubmit as the primary rejected-listing action", () => {
    renderCard(listing({ status: "rejected", verificationStatus: "failed" }));

    expect(screen.getByRole("link", { name: /fix and resubmit/i })).toBeVisible();
  });

  it("locks scroll, traps focus, closes on Escape, and restores the trigger", async () => {
    renderCard(listing());
    const trigger = screen.getByRole("button", { name: /more actions/i });
    fireEvent.click(trigger);

    const sheet = screen.getByRole("dialog", { name: /listing actions/i });
    const close = within(sheet).getByRole("button", { name: /close actions/i });
    const lastAction = within(sheet).getByRole("checkbox", { name: /available to tenants/i });

    await waitFor(() => expect(close).toHaveFocus());
    expect(document.body.style.overflow).toBe("hidden");

    lastAction.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: /listing actions/i })).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
    expect(trigger).toHaveFocus();
  });
});
