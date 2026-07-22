import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WaitlistLead } from "@cribliv/shared-types";

// Mirrors the `useFlag` mocking pattern used by
// `owner/__tests__/listing-availability-toggle.test.tsx` for the sibling
// `ff_unavailable_listings` flag: this panel self-hides behind the flag, so it
// must be forced on for these tests to exercise the real UI.
const { flagState } = vi.hoisted(() => ({
  flagState: { ff_unavailable_listings: true } as Record<string, boolean>
}));

vi.mock("../../../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminHomeWaitlist: vi.fn()
}));

import { fetchAdminHomeWaitlist } from "../../../../lib/admin-api";
import { WaitlistLeadsPanel } from "../WaitlistLeadsPanel";

const mockedFetchWaitlist = vi.mocked(fetchAdminHomeWaitlist);

const leads: WaitlistLead[] = [
  {
    id: "a1",
    phone: "+919000000001",
    user_id: null,
    status: "waiting",
    created_at: new Date(Date.now() - 60_000).toISOString()
  },
  {
    id: "a2",
    phone: "+919000000002",
    user_id: "user-1",
    status: "waiting",
    created_at: new Date(Date.now() - 3_600_000).toISOString()
  }
];

beforeEach(() => {
  vi.clearAllMocks();
  flagState.ff_unavailable_listings = true;
});

describe("WaitlistLeadsPanel", () => {
  it("loads and renders phone rows with joined time, guest/logged-in labels, and a call action", async () => {
    mockedFetchWaitlist.mockResolvedValue(leads);
    render(<WaitlistLeadsPanel token="tok" listingId="L1" count={2} />);

    expect(await screen.findByText("+919000000001")).toBeInTheDocument();
    expect(screen.getByText("+919000000002")).toBeInTheDocument();
    expect(screen.getByText("Guest")).toBeInTheDocument();
    expect(screen.getByText("Logged in")).toBeInTheDocument();

    const callLinks = screen.getAllByRole("link", { name: /call/i });
    expect(callLinks[0]).toHaveAttribute("href", "tel:+919000000001");
    expect(callLinks[1]).toHaveAttribute("href", "tel:+919000000002");

    expect(mockedFetchWaitlist).toHaveBeenCalledWith("tok", "L1");
  });

  it("shows the count badge from the count prop", async () => {
    mockedFetchWaitlist.mockResolvedValue(leads);
    render(<WaitlistLeadsPanel token="tok" listingId="L1" count={2} />);

    await screen.findByText("+919000000001");
    expect(screen.getByText(/2 waiting/i)).toBeInTheDocument();
  });

  it("offers a view-all/export affordance", async () => {
    mockedFetchWaitlist.mockResolvedValue(leads);
    render(<WaitlistLeadsPanel token="tok" listingId="L1" count={2} />);

    await screen.findByText("+919000000001");
    expect(screen.getByRole("button", { name: /export csv/i })).toBeInTheDocument();
  });

  it("shows an empty state when nobody is waiting", async () => {
    mockedFetchWaitlist.mockResolvedValue([]);
    render(<WaitlistLeadsPanel token="tok" listingId="L1" count={0} />);

    expect(await screen.findByText(/no one is waiting/i)).toBeInTheDocument();
  });

  it("shows an error state when the fetch fails", async () => {
    mockedFetchWaitlist.mockRejectedValue(new Error("network down"));
    render(<WaitlistLeadsPanel token="tok" listingId="L1" count={1} />);

    expect(await screen.findByText(/could not load the waitlist/i)).toBeInTheDocument();
  });

  it("renders nothing and does not fetch when ff_unavailable_listings is off", () => {
    flagState.ff_unavailable_listings = false;
    render(<WaitlistLeadsPanel token="tok" listingId="L1" count={2} />);

    expect(screen.queryByText("Waitlist leads")).not.toBeInTheDocument();
    expect(mockedFetchWaitlist).not.toHaveBeenCalled();
  });
});
