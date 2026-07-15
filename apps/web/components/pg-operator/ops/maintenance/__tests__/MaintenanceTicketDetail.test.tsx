import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgMaintenanceRequest } from "@cribliv/shared-types";

const { addMaintenanceInternalNote, overrideMaintenancePriority, resolveMaintenanceTicket } =
  vi.hoisted(() => ({
    addMaintenanceInternalNote: vi.fn(),
    overrideMaintenancePriority: vi.fn(),
    resolveMaintenanceTicket: vi.fn()
  }));

vi.mock("@/lib/pg-operations-api", () => ({
  addMaintenanceInternalNote,
  overrideMaintenancePriority,
  resolveMaintenanceTicket
}));

vi.mock("../useMaintenancePhotoUpload", async () => {
  const actual = await vi.importActual<typeof import("../useMaintenancePhotoUpload")>(
    "../useMaintenancePhotoUpload"
  );
  return {
    ...actual,
    createMaintenanceUploadId: () => "idem-detail"
  };
});

import MaintenanceTicketDetail from "../MaintenanceTicketDetail";

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
    status: "in_progress",
    priority: "low",
    priority_source: "category_default",
    priority_overridden_by: null,
    priority_overridden_at: null,
    priority_override_reason: null,
    sla_hours: 72,
    sla_due_at: "2026-07-17T09:00:00.000Z",
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
    created_at: "2026-07-14T09:00:00.000Z",
    updated_at: "2026-07-14T09:00:00.000Z",
    comments: [],
    location: null,
    location_snapshot: {
      kind: "property_wide",
      property_name: "Aashiyana PG",
      room_number: null,
      room_label: null,
      floor: null,
      bed_label: null,
      common_area: null,
      detail: null
    },
    timeline: [],
    ...overrides
  };
}

function renderDetail(request: PgMaintenanceRequest) {
  return render(
    <MaintenanceTicketDetail
      request={request}
      mode="operator"
      propertyId="property-1"
      token="token-1"
      transitions={["resolved"]}
      pending={null}
      comment=""
      commentPhotos={[]}
      onCommentChange={vi.fn()}
      onAddCommentPhotos={vi.fn()}
      onRemoveCommentPhoto={vi.fn()}
      onSubmitComment={vi.fn()}
      onStatusChange={vi.fn()}
      onRequestUpdated={vi.fn()}
      onInternalNoteCreated={vi.fn()}
    />
  );
}

describe("MaintenanceTicketDetail", () => {
  beforeEach(() => {
    addMaintenanceInternalNote.mockReset();
    overrideMaintenancePriority.mockReset();
    resolveMaintenanceTicket.mockReset();
  });

  it("resets local action state when the selected ticket changes", async () => {
    const { rerender } = renderDetail(ticket({ id: "ticket-1", priority: "low" }));

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    fireEvent.click(screen.getByRole("button", { name: "Override priority" }));
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "emergency" } });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Active water leak." }
    });

    expect(screen.getByLabelText("Resolution note")).toBeInTheDocument();
    expect(screen.getByLabelText("Priority")).toHaveDisplayValue("Emergency");
    expect(screen.getByLabelText("Reason")).toHaveValue("Active water leak.");

    rerender(
      <MaintenanceTicketDetail
        request={ticket({ id: "ticket-2", priority: "normal" })}
        mode="operator"
        propertyId="property-1"
        token="token-1"
        transitions={["resolved"]}
        pending={null}
        comment=""
        commentPhotos={[]}
        onCommentChange={vi.fn()}
        onAddCommentPhotos={vi.fn()}
        onRemoveCommentPhoto={vi.fn()}
        onSubmitComment={vi.fn()}
        onStatusChange={vi.fn()}
        onRequestUpdated={vi.fn()}
        onInternalNoteCreated={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.queryByLabelText("Resolution note")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Override priority" }));

    expect(screen.getByLabelText("Priority")).toHaveDisplayValue("Normal");
    expect(screen.getByLabelText("Reason")).toHaveValue("");
  });
});
