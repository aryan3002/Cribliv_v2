import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Bug 5: the listing-card heart used to be `onClick={(e) => e.preventDefault()}`
// — a no-op that saved nothing, so Saved Homes was always empty. The fix writes
// to the same shortlist store the Saved Homes page reads. In guest mode that is
// localStorage via toggleGuestShortlist; these tests pin the real write.

const toggleGuestShortlist = vi.fn(() => ({ active: true }));
let guestShortlist: string[] = [];

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated", data: null })
}));

vi.mock("../../lib/client-auth", () => ({
  readAuthSession: () => null,
  readGuestShortlist: () => guestShortlist,
  toggleGuestShortlist: (id: string) => toggleGuestShortlist(id)
}));

vi.mock("../../lib/api", () => ({
  fetchApi: vi.fn()
}));

vi.mock("../../lib/analytics", () => ({
  trackEvent: vi.fn()
}));

import { ListingCardHeart } from "../listing-card-heart";

describe("ListingCardHeart — guest persistence", () => {
  beforeEach(() => {
    toggleGuestShortlist.mockClear();
    guestShortlist = [];
  });

  it("starts unpressed when the listing is not yet saved", () => {
    render(<ListingCardHeart listingId="abc-123" />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("persists the save on tap (writes to the guest shortlist store)", async () => {
    render(<ListingCardHeart listingId="abc-123" />);
    fireEvent.click(screen.getByRole("button"));

    expect(toggleGuestShortlist).toHaveBeenCalledWith("abc-123");
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true"));
  });

  it("reflects an already-saved listing as pressed on mount", async () => {
    guestShortlist = ["abc-123"];
    render(<ListingCardHeart listingId="abc-123" />);
    await waitFor(() => expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true"));
  });
});
