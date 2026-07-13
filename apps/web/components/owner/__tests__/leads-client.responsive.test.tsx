import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { LeadStatus, LeadVm } from "../../../lib/owner-api";
import { LeadsClient } from "../leads-client";

const { sessionState, ownerApiMocks, leadKanbanMock } = vi.hoisted(() => ({
  sessionState: {
    data: { accessToken: "tok_owner" },
    status: "authenticated"
  },
  ownerApiMocks: {
    fetchOwnerLeads: vi.fn(),
    updateLeadStatus: vi.fn()
  },
  leadKanbanMock: vi.fn()
}));

vi.mock("next-auth/react", () => ({
  useSession: () => sessionState,
  signOut: vi.fn()
}));

vi.mock("../../../lib/owner-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/owner-api")>();
  return {
    ...actual,
    fetchOwnerLeads: ownerApiMocks.fetchOwnerLeads,
    updateLeadStatus: ownerApiMocks.updateLeadStatus
  };
});

vi.mock("../../../lib/track", () => ({
  track: vi.fn()
}));

vi.mock("../lead-credit-balance-bar", () => ({
  LeadCreditBalanceBar: ({ lockedLeadCount }: { lockedLeadCount: number }) => (
    <div data-testid="lead-credit-balance-bar">{lockedLeadCount} locked</div>
  )
}));

vi.mock("../lead-stats-widget", () => ({
  LeadStatsWidget: () => <div data-testid="lead-stats-widget" />
}));

vi.mock("../leads-pipeline", () => ({
  LeadsPipeline: () => <div data-testid="leads-pipeline" />
}));

vi.mock("../lead-kanban", () => ({
  LeadKanban: (props: unknown) => {
    leadKanbanMock(props);
    return <div data-testid="lead-kanban" />;
  },
  LeadKanbanSkeleton: () => <div data-testid="lead-kanban-skeleton" />
}));

function makeLead(overrides: Partial<LeadVm> = {}): LeadVm {
  return {
    id: "lead-1",
    listingId: "listing-1",
    listingTitle: "Indiranagar Studio",
    tenantName: "Asha Mehta",
    tenantPhoneMasked: "+9198XXXXX34",
    status: "new",
    statusChangedAt: "2026-07-01T00:00:00.000Z",
    ownerNotes: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    accessState: "locked",
    callDeadlineAt: "2026-07-02T00:00:00.000Z",
    calledAt: null,
    tenantPhone: null,
    ...overrides
  };
}

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  );
}

function arrangeLeads(leads: LeadVm[]) {
  ownerApiMocks.fetchOwnerLeads.mockResolvedValue({
    items: leads,
    total: leads.length,
    page: 1,
    pageSize: 200
  });
}

beforeEach(() => {
  sessionState.data = { accessToken: "tok_owner" };
  sessionState.status = "authenticated";
  leadKanbanMock.mockClear();
  ownerApiMocks.fetchOwnerLeads.mockReset();
  ownerApiMocks.updateLeadStatus.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LeadsClient responsive route", () => {
  it("renders LeadMobileList and never LeadKanban on a coarse pointer", async () => {
    mockMatchMedia(false);
    arrangeLeads([makeLead()]);

    render(<LeadsClient locale="en" />);

    expect(await screen.findByTestId("lead-mobile-list")).toBeInTheDocument();
    expect(screen.queryByTestId("lead-kanban")).not.toBeInTheDocument();
    expect(leadKanbanMock).not.toHaveBeenCalled();
  });

  it("renders board/list mode controls on a fine desktop pointer", async () => {
    mockMatchMedia(true);
    arrangeLeads([makeLead()]);

    render(<LeadsClient locale="en" />);

    expect(await screen.findByRole("group", { name: /view mode/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /board/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /list/i })).toBeInTheDocument();
    await waitFor(() => expect(leadKanbanMock).toHaveBeenCalled());
  });

  it("filters the mobile list by search and lead status", async () => {
    mockMatchMedia(false);
    arrangeLeads([
      makeLead({ id: "lead-1", listingTitle: "Indiranagar Studio", tenantName: "Asha Mehta" }),
      makeLead({
        id: "lead-2",
        listingTitle: "Koramangala PG",
        tenantName: "Rohan Shah",
        status: "contacted"
      })
    ]);

    render(<LeadsClient locale="en" />);

    const list = await screen.findByTestId("lead-mobile-list");
    expect(within(list).getByText("Indiranagar Studio")).toBeInTheDocument();
    expect(within(list).getByText("Koramangala PG")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: /search leads/i }), {
      target: { value: "asha" }
    });
    expect(within(list).getByText("Indiranagar Studio")).toBeInTheDocument();
    expect(within(list).queryByText("Koramangala PG")).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: /search leads/i }), {
      target: { value: "" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^contacted/i }));
    expect(within(list).queryByText("Indiranagar Studio")).not.toBeInTheDocument();
    expect(within(list).getByText("Koramangala PG")).toBeInTheDocument();
  });

  it("updates a mobile lead status and reverts on API failure", async () => {
    mockMatchMedia(false);
    ownerApiMocks.updateLeadStatus.mockRejectedValue(new Error("Network down"));
    arrangeLeads([makeLead({ id: "lead-1", listingTitle: "Indiranagar Studio", status: "new" })]);

    render(<LeadsClient locale="en" />);

    const list = await screen.findByTestId("lead-mobile-list");
    fireEvent.click(within(list).getByRole("button", { name: /mark contacted/i }));

    expect(await within(list).findByText(/contacted/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(ownerApiMocks.updateLeadStatus).toHaveBeenCalledWith(
        "tok_owner",
        "lead-1",
        "contacted",
        undefined
      )
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Network down");
    await waitFor(() => expect(within(list).getByText(/^new$/i)).toBeInTheDocument());
  });
});
