import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OwnerListingsClient } from "../owner-listings-client";
import { listOwnerListings, type OwnerListingVm } from "../../../lib/owner-api";

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

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      accessToken: "owner-token",
      user: { name: "Asha Owner", role: "owner" }
    }
  }),
  signOut: vi.fn()
}));

vi.mock("../boost-modal", () => ({
  BoostModal: () => null
}));

vi.mock("../seeker-near-widget", () => ({
  SeekerNearWidget: () => null
}));

vi.mock("../../../lib/owner-api", async () => {
  const actual =
    await vi.importActual<typeof import("../../../lib/owner-api")>("../../../lib/owner-api");
  return {
    ...actual,
    listOwnerListings: vi.fn()
  };
});

const listOwnerListingsMock = vi.mocked(listOwnerListings);

function listing(overrides: Partial<OwnerListingVm>): OwnerListingVm {
  return {
    id: "listing-1",
    title: "Listing",
    city: "Pune",
    locality: "Koregaon Park",
    listingType: "flat_house",
    monthlyRent: 32000,
    status: "active",
    verificationStatus: "verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    ...overrides
  };
}

const listings = [
  listing({ id: "active", title: "Active Studio", status: "active" }),
  listing({ id: "draft", title: "Draft Duplex", status: "draft" }),
  listing({ id: "pending", title: "Pending Review PG", status: "pending_review" }),
  listing({ id: "rejected", title: "Rejected Flat", status: "rejected" }),
  listing({ id: "paused", title: "Paused Villa", status: "paused" })
];

beforeEach(() => {
  vi.clearAllMocks();
  listOwnerListingsMock.mockResolvedValue({ items: listings, total: listings.length });
});

describe("OwnerListingsClient", () => {
  it("loads all listings and exposes status filters", async () => {
    render(<OwnerListingsClient locale="en" />);

    expect(await screen.findByText("Active Studio")).toBeInTheDocument();
    expect(screen.getByText("Draft Duplex")).toBeInTheDocument();
    expect(screen.getByText("Pending Review PG")).toBeInTheDocument();
    expect(screen.getByText("Rejected Flat")).toBeInTheDocument();
    expect(screen.getByText("Paused Villa")).toBeInTheDocument();

    const filters = screen.getByRole("group", { name: /listing status filters/i });
    expect(within(filters).getByRole("button", { name: /^all/i })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: /^drafts/i })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: /^pending/i })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: /^active/i })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: /^rejected/i })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: /^paused/i })).toBeInTheDocument();

    fireEvent.click(within(filters).getByRole("button", { name: /^active/i }));

    await waitFor(() =>
      expect(listOwnerListingsMock).toHaveBeenLastCalledWith("owner-token", "active")
    );
  });

  it("retries after a listing request fails", async () => {
    listOwnerListingsMock
      .mockRejectedValueOnce(new Error("Request failed with status 500"))
      .mockResolvedValueOnce({ items: [listings[0]], total: 1 });

    render(<OwnerListingsClient locale="en" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't refresh your listings. Please try again."
    );
    expect(screen.queryByText(/Request failed with status 500/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Active Studio")).toBeInTheDocument();
    expect(listOwnerListingsMock).toHaveBeenCalledTimes(2);
  });
});
