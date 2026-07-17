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
vi.mock("../../homes/AdminHomesTab", () => ({
  AdminHomesTab: ({
    initialListingId,
    onOpenLeadCenter,
    onOpenListingReview
  }: {
    initialListingId?: string | null;
    onOpenLeadCenter: (id: string) => void;
    onOpenListingReview: (id: string) => void;
  }) => (
    <div>
      <div>homes-target:{initialListingId ?? "none"}</div>
      <button onClick={() => onOpenLeadCenter("11111111-1111-4111-8111-111111111111")}>
        open-home-leads
      </button>
      <button onClick={() => onOpenListingReview("11111111-1111-4111-8111-111111111111")}>
        open-home-review
      </button>
    </div>
  )
}));
vi.mock("../../lead-center/LeadCenterTab", () => ({
  LeadCenterTab: ({
    initialListingId,
    onOpenHome
  }: {
    initialListingId?: string | null;
    onOpenHome: (id: string) => void;
  }) => (
    <div>
      <div>lead-center:{initialListingId ?? "none"}</div>
      <button onClick={() => onOpenHome("11111111-1111-4111-8111-111111111111")}>
        open-lead-home
      </button>
    </div>
  )
}));
// Stub the remaining tabs/topbar/sidebar so the shell mounts cheaply.
vi.mock("../AdminSidebar", () => ({
  AdminSidebar: ({ onChange }: { onChange: (t: string) => void }) => (
    <div>
      <button onClick={() => onChange("verifications")}>go-verif</button>
      <button onClick={() => onChange("homes")}>go-homes</button>
    </div>
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

  it("opens Lead Center with the listing selected from Verified Homes", async () => {
    render(<AdminShell accessToken="tok" />);
    fireEvent.click(screen.getByText("go-homes"));
    fireEvent.click(await screen.findByText("open-home-leads"));
    expect(
      await screen.findByText("lead-center:11111111-1111-4111-8111-111111111111")
    ).toBeInTheDocument();
  });

  it("opens Listing Review with the listing selected from Verified Homes", async () => {
    render(<AdminShell accessToken="tok" />);
    fireEvent.click(screen.getByText("go-homes"));
    fireEvent.click(await screen.findByText("open-home-review"));
    expect(
      await screen.findByText("listing-tab:11111111-1111-4111-8111-111111111111")
    ).toBeInTheDocument();
  });

  it("opens the verified home selected from Lead Center", async () => {
    render(<AdminShell accessToken="tok" />);
    fireEvent.click(screen.getByText("go-homes"));
    fireEvent.click(await screen.findByText("open-home-leads"));
    fireEvent.click(await screen.findByText("open-lead-home"));
    expect(
      await screen.findByText("homes-target:11111111-1111-4111-8111-111111111111")
    ).toBeInTheDocument();
  });
});
