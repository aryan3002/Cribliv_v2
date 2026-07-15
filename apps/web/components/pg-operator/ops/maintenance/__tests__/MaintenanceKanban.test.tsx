import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgMaintenanceQueuePage, PgMaintenanceRequest } from "@cribliv/shared-types";

const { listPropertyMaintenance, resolveMaintenanceTicket, updateMaintenanceStatus } = vi.hoisted(
  () => ({
    listPropertyMaintenance: vi.fn(),
    resolveMaintenanceTicket: vi.fn(),
    updateMaintenanceStatus: vi.fn()
  })
);

vi.mock("@/lib/pg-operations-api", () => ({
  listPropertyMaintenance,
  resolveMaintenanceTicket,
  updateMaintenanceStatus
}));

import MaintenanceKanban from "../MaintenanceKanban";

function ticket(overrides: Partial<PgMaintenanceRequest> = {}): PgMaintenanceRequest {
  return {
    id: "ticket-1",
    pg_property_id: "property-1",
    assignment_id: "assignment-1",
    created_by_user_id: "tenant-1",
    category: "Plumbing",
    category_slug: "plumbing",
    category_label_snapshot: "Plumbing",
    description: "The bathroom tap is leaking.",
    photo_paths: [],
    photo_urls: [],
    status: "open",
    priority: "high",
    priority_source: "category_default",
    priority_overridden_by: null,
    priority_overridden_at: null,
    priority_override_reason: null,
    sla_hours: 24,
    sla_due_at: "2026-07-15T03:30:00.000Z",
    is_overdue: false,
    closed_at: null,
    resolved_at: null,
    resolution_note: null,
    resolution_source: null,
    fix_photo_paths: [],
    fix_photo_urls: [],
    resolution_cost_paise: null,
    chargeable_damage: false,
    auto_close_after: null,
    created_at: "2026-07-14T08:00:00.000Z",
    updated_at: "2026-07-14T05:00:00.000Z",
    comments: [],
    location: {
      property_id: "property-1",
      property_name: "Aashiyana PG",
      room_id: "room-1",
      room_number: "P5-101",
      room_label: "Maintenance room",
      floor: 1,
      bed_id: "bed-1",
      bed_label: "A",
      tenant_name: "P5 Tenant 1",
      tenant_phone_e164: "+919999999902"
    },
    location_snapshot: {
      kind: "bed",
      property_name: "Aashiyana PG",
      room_number: "P5-101",
      room_label: "Maintenance room",
      floor: 1,
      bed_label: "A",
      common_area: null,
      detail: null
    },
    ...overrides
  };
}

function page(rows: PgMaintenanceRequest[]): PgMaintenanceQueuePage {
  return { rows, next_cursor: null };
}

function setup() {
  render(
    <MaintenanceKanban
      propertyId="property-1"
      token="token-1"
      ticketHrefBase="/en/pg-operator/properties/property-1/maintenance"
      initialPage={page([
        ticket({ id: "open-ticket", status: "open", category: "Plumbing", priority: "high" }),
        ticket({
          id: "work-ticket",
          status: "in_progress",
          category: "Electrical",
          priority: "emergency",
          sla_due_at: "2026-07-15T00:00:00.000Z"
        }),
        ticket({
          id: "wait-ticket",
          status: "waiting_on_tenant",
          category: "Carpentry",
          priority: "normal"
        }),
        ticket({ id: "resolved-ticket", status: "resolved", category: "Cleaning", priority: "low" })
      ])}
    />
  );
}

describe("MaintenanceKanban", () => {
  beforeEach(() => {
    listPropertyMaintenance.mockReset();
    resolveMaintenanceTicket.mockReset();
    updateMaintenanceStatus.mockReset();
    resolveMaintenanceTicket.mockResolvedValue(
      ticket({ id: "work-ticket", status: "resolved", category: "Electrical" })
    );
  });

  it("renders workflow columns and cards with SLA and priority", () => {
    setup();

    for (const column of ["Open", "In progress", "Waiting on tenant", "Resolved"]) {
      expect(screen.getByRole("region", { name: column })).toBeInTheDocument();
    }

    const openColumn = screen.getByRole("region", { name: "Open" });
    expect(within(openColumn).getByText("Plumbing")).toBeInTheDocument();
    expect(within(openColumn).getByText("Due 15 Jul, 09:00 am")).toBeInTheDocument();
    expect(within(openColumn).getByText("High")).toBeInTheDocument();
    expect(
      within(openColumn).getByRole("link", {
        name: "Open Plumbing ticket at Room P5-101 · Bed A (open-ticket)"
      })
    ).toHaveAttribute("href", "/en/pg-operator/properties/property-1/maintenance/open-ticket");

    const progressColumn = screen.getByRole("region", { name: "In progress" });
    expect(within(progressColumn).getByText("Emergency")).toBeInTheDocument();
    expect(within(progressColumn).getByText("Due 15 Jul, 05:30 am")).toBeInTheDocument();
  });

  it("submits resolution details from the kanban dialog", async () => {
    setup();

    const progressColumn = screen.getByRole("region", { name: "In progress" });
    fireEvent.click(within(progressColumn).getByRole("button", { name: "Resolve Electrical" }));

    expect(screen.getByRole("dialog", { name: "Resolve ticket" })).toBeInTheDocument();
    expect(updateMaintenanceStatus).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Fixed the room furniture issue." }
    });
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    await waitFor(() =>
      expect(resolveMaintenanceTicket).toHaveBeenCalledWith(
        "property-1",
        "work-ticket",
        {
          note: "Fixed the room furniture issue.",
          chargeable_damage: false
        },
        "token-1",
        expect.any(String)
      )
    );
    expect(screen.queryByRole("dialog", { name: "Resolve ticket" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Resolved" })).getByText("Electrical")
    ).toBeInTheDocument();
  });

  it("disables invalid transition controls", () => {
    setup();

    const openColumn = screen.getByRole("region", { name: "Open" });
    expect(within(openColumn).getByRole("button", { name: "Resolve Plumbing" })).toBeDisabled();
    expect(
      within(openColumn).getByRole("button", { name: "Wait for tenant Plumbing" })
    ).toBeDisabled();

    const resolvedColumn = screen.getByRole("region", { name: "Resolved" });
    expect(
      within(resolvedColumn).getByRole("button", { name: "Start work Cleaning" })
    ).toBeDisabled();
  });
});
