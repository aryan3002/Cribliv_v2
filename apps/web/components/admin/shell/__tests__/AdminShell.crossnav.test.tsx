import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// AdminShell mounts on the "live" tab by default, so LiveOpsTab actually
// renders (not just imports) and fires real fetch calls in its effect,
// which reject under jsdom and fail the run. The two pre-existing
// AdminShell tests mock this for the same reason; mirror that here.
vi.mock("../../tabs/LiveOpsTab", () => ({
  LiveOpsTab: () => <div data-testid="live-tab" />
}));

// Mock the two tabs to tiny stand-ins that exercise the wiring.
vi.mock("../../tabs/VerificationTab", () => ({
  VerificationTab: ({ onOpenListing }: { onOpenListing?: (id: string) => void }) => (
    <button onClick={() => onOpenListing?.("L1")}>jump</button>
  )
}));
vi.mock("../../tabs/ListingReviewTab", () => ({
  ListingReviewTab: ({ initialListingId }: { initialListingId?: string | null }) => (
    <div>listing-tab:{initialListingId ?? "none"}</div>
  )
}));
// Stub the remaining tabs/topbar/sidebar so the shell mounts cheaply.
vi.mock("../AdminSidebar", () => ({
  AdminSidebar: ({ onChange }: { onChange: (t: string) => void }) => (
    <button onClick={() => onChange("verifications")}>go-verif</button>
  )
}));

import { AdminShell } from "../AdminShell";

describe("AdminShell cross-nav", () => {
  beforeEach(() => sessionStorage.clear());

  it("openListingReview switches to the listings tab preselected", async () => {
    render(<AdminShell accessToken="tok" />);
    fireEvent.click(screen.getByText("go-verif"));
    fireEvent.click(await screen.findByText("jump"));
    await waitFor(() => expect(screen.getByText("listing-tab:L1")).toBeInTheDocument());
  });
});
