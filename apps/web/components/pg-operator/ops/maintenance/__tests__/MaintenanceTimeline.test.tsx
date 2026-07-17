import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PgMaintenanceTimelineEvent } from "@cribliv/shared-types";

import MaintenanceTimeline from "../MaintenanceTimeline";

function event(overrides: Partial<PgMaintenanceTimelineEvent>): PgMaintenanceTimelineEvent {
  return {
    id: "event-1",
    request_id: "ticket-1",
    event_type: "created",
    visibility: "public",
    actor_user_id: "tenant-1",
    actor_role: "tenant",
    from_status: null,
    to_status: null,
    payload: {},
    created_at: "2026-07-14T09:00:00.000Z",
    ...overrides
  };
}

describe("MaintenanceTimeline", () => {
  it("hides operator internal events in tenant mode", () => {
    render(
      <MaintenanceTimeline
        mode="tenant"
        events={[
          event({ id: "public-note", event_type: "comment_added", payload: { body: "Visible" } }),
          event({
            id: "internal-note",
            event_type: "internal_note_added",
            visibility: "operator_internal",
            actor_role: "pg_operator",
            payload: { body: "Call plumber privately" }
          })
        ]}
      />
    );

    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.queryByText("Call plumber privately")).not.toBeInTheDocument();
  });

  it("shows internal notes in operator mode", () => {
    render(
      <MaintenanceTimeline
        mode="operator"
        events={[
          event({
            event_type: "internal_note_added",
            visibility: "operator_internal",
            actor_role: "pg_operator",
            payload: { body: "Call plumber privately" }
          })
        ]}
      />
    );

    expect(screen.getByText("Internal note")).toBeInTheDocument();
    expect(screen.getByText("Call plumber privately")).toBeInTheDocument();
  });

  it("renders resolution note, cost, and chargeable flag", () => {
    render(
      <MaintenanceTimeline
        mode="operator"
        events={[
          event({
            event_type: "resolution_recorded",
            actor_role: "pg_operator",
            payload: {
              note: "Pipe repaired and tested.",
              cost_paise: 25000,
              chargeable_damage: true
            }
          })
        ]}
      />
    );

    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Resolved")).toBeInTheDocument();
    expect(within(item).getByText("Pipe repaired and tested.")).toBeInTheDocument();
    expect(within(item).getByText("Cost: ₹250")).toBeInTheDocument();
    expect(within(item).getByText("Chargeable damage: Yes")).toBeInTheDocument();
  });

  it("renders auto-close events as system events", () => {
    render(
      <MaintenanceTimeline
        mode="operator"
        events={[
          event({
            event_type: "auto_closed",
            actor_user_id: null,
            actor_role: "system",
            from_status: "resolved",
            to_status: "closed",
            payload: {}
          })
        ]}
      />
    );

    const item = screen.getByRole("listitem");
    expect(within(item).getByText("Auto-closed")).toBeInTheDocument();
    expect(within(item).getByText("System")).toBeInTheDocument();
  });
});
