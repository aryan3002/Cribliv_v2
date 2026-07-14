import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { LeadVm } from "../../../lib/owner-api";
import { LeadKanban } from "../lead-kanban";

vi.mock("../../../lib/track", () => ({
  track: vi.fn()
}));

vi.mock("../lead-monetization-controls", () => ({
  LeadMonetizationControls: () => <div data-testid="lead-monetization" />
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

describe("LeadKanban provider ownership", () => {
  it("renders every Droppable inside DragDropContext even when drag is disabled", () => {
    expect(() =>
      render(
        <LeadKanban
          accessToken="tok_owner"
          leads={[makeLead()]}
          onLeadsChange={vi.fn()}
          searchQuery=""
          enableDrag={false}
          locale="en"
        />
      )
    ).not.toThrow(/Could not find.*store/i);

    expect(screen.getByLabelText(/new column/i)).toBeInTheDocument();
  });
});
