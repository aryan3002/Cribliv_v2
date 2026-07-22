import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminHomeDetail } from "@cribliv/shared-types";

// Mirrors the `useFlag` mocking pattern used across the codebase (e.g.
// owner/__tests__/listing-availability-toggle.test.tsx,
// pg-operator/dashboard/__tests__/PgLeadsBoard.test.tsx) for any component
// that calls `useFlag`: the real hook reads a module-level PostHog client
// that is undefined outside a <PostHogProvider>, so it must be mocked here
// now that AdminHomeWorkspace uses it to gate the availability toggle.
const { flagState } = vi.hoisted(() => ({
  flagState: { ff_unavailable_listings: true } as Record<string, boolean>
}));

vi.mock("../../../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));
vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminHomeDetail: vi.fn(),
  setAdminHomeAvailability: vi.fn()
}));
vi.mock("../../../../lib/admin-home-url", () => ({
  adminHomePublicUrl: (publicPath: string) => `https://cribliv.com${publicPath}`,
  copyAdminHomeUrl: vi.fn()
}));
vi.mock("../../pg-properties/LocationMapPicker", () => ({
  LocationMapPicker: () => <div />
}));
// WaitlistLeadsPanel has its own dedicated test file
// (components/admin/homes/__tests__/WaitlistLeadsPanel.test.tsx) — stub it
// here so this file only asserts on the wiring (when it's shown), not its
// internals.
vi.mock("../WaitlistLeadsPanel", () => ({
  WaitlistLeadsPanel: ({ count }: { count: number }) => (
    <div data-testid="waitlist-panel-stub">Waitlist panel stub: {count}</div>
  )
}));

import { fetchAdminHomeDetail, setAdminHomeAvailability } from "../../../../lib/admin-api";
import { copyAdminHomeUrl } from "../../../../lib/admin-home-url";
import { AdminHomeWorkspace } from "../AdminHomeWorkspace";

const mockedFetchAdminHomeDetail = vi.mocked(fetchAdminHomeDetail);
const mockedCopyAdminHomeUrl = vi.mocked(copyAdminHomeUrl);
const mockedSetAdminHomeAvailability = vi.mocked(setAdminHomeAvailability);

const homeDetailFixture: AdminHomeDetail = {
  listing: {
    id: "11111111-1111-4111-8111-111111111111",
    title_en: "2BHK in Gomti Nagar",
    title_hi: null,
    description_en: "Furnished verified home",
    description_hi: null,
    status: "active",
    verification_status: "verified",
    monthly_rent: 22000,
    security_deposit: 44000,
    available_from: "2026-08-01",
    furnishing: "fully_furnished",
    bhk: 2,
    bathrooms: 2,
    area_sqft: 1050,
    preferred_tenant: "family",
    whatsapp_available: true,
    amenities: ["parking"],
    rules: { pets: false },
    created_at: "2026-07-01T08:00:00.000Z",
    updated_at: "2026-07-15T08:00:00.000Z",
    last_owner_activity_at: "2026-07-15T07:00:00.000Z"
  },
  location: {
    address_line1: "Vibhuti Khand",
    landmark: "Near metro",
    pincode: "226010",
    lat: 26.8467,
    lng: 80.9462,
    masked_address: "Gomti Nagar, Lucknow",
    locality_name: "Gomti Nagar",
    city_slug: "lucknow",
    city_name: "Lucknow"
  },
  photos: [],
  owner: {
    id: "O1",
    name: "Ramesh Gupta",
    phone: "+919999999901",
    whatsapp_opt_in: true,
    preferred_language: "en",
    role: "owner",
    is_blocked: false,
    member_since: "2026-01-01T00:00:00.000Z",
    last_login_at: "2026-07-15T07:00:00.000Z",
    active_homes: 1,
    paused_homes: 0,
    archived_homes: 0,
    report_count: 0,
    lead_health: {
      health_score: 86,
      health_grade: "A",
      leads_30d: 14,
      called_rate_30d: 10 / 14,
      refund_rate_30d: 0,
      median_response_minutes_30d: 42
    }
  },
  metrics_30d: { views: 428, leads: 14, open_leads: 4, conversion_rate: 14 / 428 },
  lead_summary: {
    by_status: { new: 4, contacted: 6, visit_scheduled: 3, deal_done: 1, lost: 0 },
    by_access_state: { free: 10, locked: 1, unlocked: 3, expired: 0 },
    called: 10,
    uncalled: 4,
    refunded: 0,
    open: 4,
    median_response_minutes: 42
  },
  recent_leads: [
    {
      lead_id: "LD1",
      seeker_name: "Seeker One",
      access_state: "free",
      status: "new",
      called_at: null,
      called_by: null,
      response_deadline_at: null,
      refund_state: "pending",
      created_at: "2026-07-15T06:00:00.000Z"
    }
  ],
  verification_status: "verified",
  verified_at: "2026-07-10T08:00:00.000Z",
  verification_attempts: [
    {
      attempt_id: "V1",
      kind: "video_liveness",
      result: "pass",
      liveness_score: 96,
      address_match_score: null,
      threshold: 85,
      provider: "mock",
      provider_result_code: "PASS",
      review_reason: null,
      artifact_available: true,
      reviewed_by: "A1",
      reviewed_at: "2026-07-10T08:00:00.000Z",
      created_at: "2026-07-10T07:00:00.000Z"
    }
  ],
  activity: [],
  public_path: "/en/listing/11111111-1111-4111-8111-111111111111"
};

interface WorkspaceProps {
  accessToken: string;
  listingId: string;
  onBack: () => void;
  onOpenListingReview: (listingId: string) => void;
  onOpenLeadCenter: (listingId: string) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

function renderWorkspace(overrides: Partial<WorkspaceProps> = {}) {
  return render(
    <AdminHomeWorkspace
      accessToken="tok"
      listingId="11111111-1111-4111-8111-111111111111"
      onBack={vi.fn()}
      onOpenListingReview={vi.fn()}
      onOpenLeadCenter={vi.fn()}
      onToast={vi.fn()}
      {...overrides}
    />
  );
}

describe("AdminHomeWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flagState.ff_unavailable_listings = true;
    mockedFetchAdminHomeDetail.mockResolvedValue(homeDetailFixture);
    vi.spyOn(window, "open").mockReturnValue(null);
  });

  it("loads the selected home and exposes all six tabs", async () => {
    renderWorkspace();

    await screen.findByText("2BHK in Gomti Nagar");
    for (const label of ["Overview", "Property", "Leads", "Verification", "Owner", "Activity"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("copies, opens the active public page, and delegates moderation to Listing Review", async () => {
    const onOpenListingReview = vi.fn();
    renderWorkspace({ onOpenListingReview });

    await screen.findByText("2BHK in Gomti Nagar");
    fireEvent.click(screen.getByRole("button", { name: "Copy public URL" }));
    await waitFor(() =>
      expect(mockedCopyAdminHomeUrl).toHaveBeenCalledWith(
        "/en/listing/11111111-1111-4111-8111-111111111111"
      )
    );
    fireEvent.click(screen.getByRole("button", { name: "Open public page" }));
    expect(window.open).toHaveBeenCalledWith(
      "https://cribliv.com/en/listing/11111111-1111-4111-8111-111111111111",
      "_blank",
      "noopener,noreferrer"
    );
    fireEvent.click(screen.getByRole("button", { name: "Open in Listing Review" }));
    expect(onOpenListingReview).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it.each(["paused", "archived"] as const)("hides public actions for %s homes", async (status) => {
    mockedFetchAdminHomeDetail.mockResolvedValueOnce({
      ...homeDetailFixture,
      listing: { ...homeDetailFixture.listing, status }
    });
    renderWorkspace();

    expect(await screen.findByText("Not publicly available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy public URL" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open public page" })).not.toBeInTheDocument();
  });

  it("shows recent lead metrics but delegates actions to Lead Center", async () => {
    const onOpenLeadCenter = vi.fn();
    renderWorkspace({ onOpenLeadCenter });

    await screen.findByText("2BHK in Gomti Nagar");
    fireEvent.click(screen.getByRole("button", { name: "Leads" }));
    expect(screen.getByText("Seeker One")).toBeInTheDocument();
    expect(screen.queryByText("+919999999902")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /call/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /nudge/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Manage in Lead Center" }));
    expect(onOpenLeadCenter).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("reuses secure verification evidence loading", async () => {
    renderWorkspace();

    await screen.findByText("2BHK in Gomti Nagar");
    fireEvent.click(screen.getByRole("button", { name: "Verification" }));
    expect(screen.getByRole("button", { name: /play liveness video/i })).toBeInTheDocument();
  });

  describe("availability toggle (ff_unavailable_listings)", () => {
    it("marks a home not available, confirming with an optional reason, and shows the waitlist panel", async () => {
      mockedSetAdminHomeAvailability.mockResolvedValue({ listingId: "L1", isAvailable: false });
      renderWorkspace();

      await screen.findByText("2BHK in Gomti Nagar");
      fireEvent.click(screen.getByRole("button", { name: /mark not available/i }));

      // ConfirmDialog is open with an optional reason box. Scope the confirm
      // click to the dialog — its confirm button shares the same accessible
      // name ("Mark not available") as the header toggle that opened it.
      const dialog = screen.getByRole("dialog");
      const reasonBox = await within(dialog).findByPlaceholderText("Internal note…");
      fireEvent.change(reasonBox, { target: { value: "went off-market" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Mark not available" }));

      await waitFor(() =>
        expect(mockedSetAdminHomeAvailability).toHaveBeenCalledWith(
          "tok",
          "11111111-1111-4111-8111-111111111111",
          false,
          "went off-market"
        )
      );

      expect(await screen.findByText("Not available")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /mark available/i })).toBeInTheDocument();
      expect(screen.getByTestId("waitlist-panel-stub")).toBeInTheDocument();
    });

    it("hides the toggle entirely when ff_unavailable_listings is off", async () => {
      flagState.ff_unavailable_listings = false;
      renderWorkspace();

      await screen.findByText("2BHK in Gomti Nagar");
      expect(screen.queryByRole("button", { name: /mark not available/i })).not.toBeInTheDocument();
      expect(screen.queryByText("Not available")).not.toBeInTheDocument();
      expect(screen.queryByTestId("waitlist-panel-stub")).not.toBeInTheDocument();
    });
  });
});
