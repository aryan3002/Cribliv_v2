import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OwnerOverviewClient } from "../owner-overview-client";
import type { LeadVm, OwnerListingVm } from "../../../lib/owner-api";
import {
  createSalesLead,
  fetchOwnerLeads,
  listOwnerListings,
  makeIdempotencyKey
} from "../../../lib/owner-api";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={typeof href === "string" ? href : href?.pathname} {...props}>
      {children}
    </a>
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

vi.mock("../../../lib/analytics", () => ({
  trackEvent: vi.fn()
}));

vi.mock("../../../lib/owner-api", () => ({
  createSalesLead: vi.fn(),
  fetchOwnerLeads: vi.fn(),
  listOwnerListings: vi.fn(),
  makeIdempotencyKey: vi.fn(() => "pm-assist-test-key")
}));

const listOwnerListingsMock = vi.mocked(listOwnerListings);
const fetchOwnerLeadsMock = vi.mocked(fetchOwnerLeads);
const createSalesLeadMock = vi.mocked(createSalesLead);
const makeIdempotencyKeyMock = vi.mocked(makeIdempotencyKey);

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

function lead(overrides: Partial<LeadVm>): LeadVm {
  return {
    id: "lead-1",
    listingId: "listing-1",
    listingTitle: "Listing",
    tenantName: "Tenant",
    tenantPhoneMasked: "+9198XXXXX34",
    status: "new",
    statusChangedAt: "2026-07-12T00:00:00.000Z",
    ownerNotes: null,
    createdAt: "2026-07-12T00:00:00.000Z",
    accessState: "free",
    callDeadlineAt: null,
    calledAt: null,
    tenantPhone: null,
    ...overrides
  };
}

const listings = [
  listing({
    id: "active-unverified",
    title: "Unverified Active Studio",
    status: "active",
    verificationStatus: "unverified"
  }),
  listing({ id: "active-verified", title: "Verified 2BHK", status: "active" }),
  listing({ id: "pending", title: "Pending Review PG", status: "pending_review" }),
  listing({ id: "draft", title: "Draft Duplex", status: "draft" }),
  listing({ id: "paused", title: "Paused Villa", status: "paused" })
];

const leads = [
  lead({
    id: "lead-new-1",
    tenantName: "Riya Shah",
    listingTitle: "Verified 2BHK",
    createdAt: "2026-07-12T00:00:00.000Z"
  }),
  lead({
    id: "lead-new-2",
    tenantName: "Kabir Mehta",
    listingTitle: "Unverified Active Studio",
    createdAt: "2026-07-08T00:00:00.000Z"
  }),
  lead({
    id: "lead-old",
    tenantName: "Meera Singh",
    listingTitle: "Pending Review PG",
    createdAt: "2026-07-01T00:00:00.000Z"
  }),
  lead({
    id: "lead-new-3",
    tenantName: "Arjun Rao",
    listingTitle: "Draft Duplex",
    createdAt: "2026-07-13T00:00:00.000Z"
  })
];

async function renderOverview() {
  render(<OwnerOverviewClient locale="en" />);
  await screen.findAllByTestId("overview-listing-row");
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-07-13T12:00:00.000Z").getTime());
  listOwnerListingsMock.mockResolvedValue({ items: listings, total: listings.length });
  fetchOwnerLeadsMock.mockResolvedValue({
    items: leads,
    total: leads.length,
    page: 1,
    pageSize: 200
  });
  createSalesLeadMock.mockResolvedValue({
    id: "sales-lead-1",
    status: "new",
    source: "property_management",
    listingId: null,
    createdAt: "2026-07-13T12:00:00.000Z"
  });
  makeIdempotencyKeyMock.mockReturnValue("pm-assist-test-key");
});

describe("OwnerOverviewClient", () => {
  it("renders active listings and seven-day leads as headline metrics", async () => {
    await renderOverview();

    expect(screen.getByTestId("overview-metric-active")).toHaveTextContent("2");
    expect(screen.getByTestId("overview-metric-leads-7d")).toHaveTextContent("3");
  });

  it("renders pending, drafts and total as compact secondary metrics", async () => {
    await renderOverview();

    const secondaryMetrics = screen.getByLabelText(/portfolio summary/i);
    expect(within(secondaryMetrics).getByText("Pending")).toBeInTheDocument();
    expect(within(secondaryMetrics).getByText("Drafts")).toBeInTheDocument();
    expect(within(secondaryMetrics).getByText("Total")).toBeInTheDocument();
    expect(within(secondaryMetrics).getAllByText("1")).toHaveLength(2);
    expect(within(secondaryMetrics).getByText("5")).toBeInTheDocument();
  });

  it("shows no more than three recent listings and three recent leads", async () => {
    await renderOverview();

    expect(screen.getAllByTestId("overview-listing-row")).toHaveLength(3);
    expect(screen.getAllByTestId("overview-lead-row")).toHaveLength(3);
    expect(screen.queryByText("Paused Villa")).not.toBeInTheDocument();
    expect(screen.queryByText("Meera Singh")).not.toBeInTheDocument();
  });

  it("keeps listings usable when lead loading fails", async () => {
    fetchOwnerLeadsMock.mockRejectedValueOnce(new Error("Lead service unavailable"));

    render(<OwnerOverviewClient locale="en" />);

    expect(await screen.findByText("Verified 2BHK")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Lead service unavailable");
    expect(screen.getAllByRole("link", { name: /manage listings/i })[0]).toHaveAttribute(
      "href",
      "/en/owner/listings"
    );
  });

  it("links urgent verification work to /owner/verification", async () => {
    await renderOverview();

    expect(screen.getByRole("link", { name: /complete verification/i })).toHaveAttribute(
      "href",
      "/en/owner/verification"
    );
  });

  it("links portfolio management to /owner/listings and /owner/leads", async () => {
    await renderOverview();

    expect(screen.getAllByRole("link", { name: /manage listings/i })[0]).toHaveAttribute(
      "href",
      "/en/owner/listings"
    );
    expect(screen.getAllByRole("link", { name: /review leads/i })[0]).toHaveAttribute(
      "href",
      "/en/owner/leads"
    );
  });

  it("submits the existing property-management assistance request", async () => {
    await renderOverview();

    fireEvent.click(screen.getByRole("button", { name: /request management help/i }));

    await waitFor(() => expect(createSalesLeadMock).toHaveBeenCalledTimes(1));
    expect(createSalesLeadMock).toHaveBeenCalledWith("owner-token", {
      source: "property_management",
      notes: "Property management consultation requested from owner dashboard",
      metadata: { locale: "en", listing_count: listings.length },
      idempotencyKey: "pm-assist-test-key"
    });
    expect(await screen.findByText(/request submitted/i)).toBeInTheDocument();
  });
});
