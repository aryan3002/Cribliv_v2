import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AdminLeadAnalytics,
  AdminLeadBoardResponse,
  AdminLeadBoardRow
} from "@cribliv/shared-types";

vi.mock("../../../../lib/admin-api", () => ({
  fetchAdminLeadBoard: vi.fn(),
  fetchAdminLeadAnalytics: vi.fn()
}));

import { LeadCenterTab } from "../LeadCenterTab";
import { fetchAdminLeadAnalytics, fetchAdminLeadBoard } from "../../../../lib/admin-api";

const mockedBoard = vi.mocked(fetchAdminLeadBoard);
const mockedAnalytics = vi.mocked(fetchAdminLeadAnalytics);

function boardRow(overrides: Partial<AdminLeadBoardRow> = {}): AdminLeadBoardRow {
  return {
    lead_id: "lead-1",
    listing_id: "listing-1",
    listing_title: "2BHK near Sector 62",
    city: "Noida",
    owner: {
      user_id: "owner-1",
      name: "Ravi Owner",
      phone_masked: "98XXXXXX01",
      role: "owner",
      health_score: null,
      health_grade: null
    },
    seeker: {
      user_id: "seeker-1",
      name: "Priya Seeker",
      phone_e164: "+919999912345"
    },
    access_state: "locked",
    status: "new",
    called_at: null,
    called_by: null,
    response_deadline_at: "2026-07-13T18:00:00.000Z",
    seconds_remaining: 18_000,
    refund_state: "pending",
    lead_kind: "callback",
    source: "contact_unlock",
    created_at: "2026-07-12T18:00:00.000Z",
    ...overrides
  };
}

const BOARD_RESPONSE: AdminLeadBoardResponse = {
  rows: [boardRow()],
  total: 1,
  generated_at: "2026-07-13T00:00:00.000Z",
  counters: {
    in_flight: 1,
    uncalled: 1,
    expiring_6h: 0,
    expired_today: 0,
    refunded_today: 0
  }
};

// engagement/trend are intentionally left at all-zero/empty so LeadAnalytics
// takes its EmptyState branch instead of mounting recharts' ResponsiveContainer
// — jsdom has no layout engine, and the PG-dashboard suites that DO exercise
// recharts in jsdom are quarantined in CI for exactly that flakiness (see
// vitest.config.ts). The section title we assert on renders regardless of
// which branch (chart vs empty state) is taken.
const ANALYTICS_RESPONSE: AdminLeadAnalytics = {
  range: "30 days",
  generated_at: "2026-07-13T00:00:00.000Z",
  funnel: {
    callbacks_requested: 4,
    leads_created: 4,
    leads_unlocked: 3,
    leads_called: 2,
    deals_done: 1,
    leads_refunded: 0,
    leads_disputed: 0
  },
  engagement: {
    searches: 0,
    listing_views: 0,
    signups: 0,
    callbacks_requested: 0,
    calls_made: 0
  },
  rates: {
    median_response_minutes: 45,
    called_within_24h_rate: 0.5,
    team_rescue_rate: 0.1,
    refund_rate: 0,
    dispute_rate: 0
  },
  trend: [],
  by_owner: []
};

describe("LeadCenterTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedBoard.mockResolvedValue(BOARD_RESPONSE);
    mockedAnalytics.mockResolvedValue(ANALYTICS_RESPONSE);
  });

  it("renders the live board and switches to the analytics sub-view", async () => {
    const { container } = render(<LeadCenterTab accessToken="t" onToast={() => {}} />);

    // Board: LeadBoard debounces its fetch 300ms, so this also exercises that
    // the seeker name from the mocked row makes it all the way to the table.
    expect(await screen.findByText("Priya Seeker")).toBeInTheDocument();

    // KPI strip: the "Uncalled" StatCard specifically (the same text also
    // appears as a filter chip label, so scope to the stat grid).
    const statGrid = container.querySelector(".admin-stat-grid");
    expect(statGrid).not.toBeNull();
    expect(within(statGrid as HTMLElement).getByText("Uncalled")).toBeInTheDocument();

    // Switch to Analytics.
    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));

    expect(await screen.findByText("Engagement funnel")).toBeInTheDocument();
  });

  it("initializes exact listing mode and allows clearing it", async () => {
    render(
      <LeadCenterTab
        accessToken="tok"
        initialListingId="11111111-1111-4111-8111-111111111111"
        onCountChange={vi.fn()}
        onToast={vi.fn()}
      />
    );

    await waitFor(() =>
      expect(mockedBoard).toHaveBeenCalledWith(
        "tok",
        expect.objectContaining({
          filter: "all",
          sort: "newest",
          listing_id: "11111111-1111-4111-8111-111111111111",
          page: 1
        })
      )
    );

    fireEvent.click(await screen.findByRole("button", { name: /clear listing filter/i }));

    await waitFor(() =>
      expect(mockedBoard).toHaveBeenLastCalledWith(
        "tok",
        expect.not.objectContaining({
          listing_id: "11111111-1111-4111-8111-111111111111"
        })
      )
    );
  });

  it("delegates listing navigation back to Verified Homes", async () => {
    const onOpenHome = vi.fn();
    render(<LeadCenterTab accessToken="tok" onOpenHome={onOpenHome} onToast={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open 2BHK near Sector 62 in Verified Homes"
      })
    );

    expect(onOpenHome).toHaveBeenCalledWith("listing-1");
  });
});
