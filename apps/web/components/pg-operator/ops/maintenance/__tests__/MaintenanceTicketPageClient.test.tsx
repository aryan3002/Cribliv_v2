import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgMaintenanceRequest } from "@cribliv/shared-types";

const {
  addMaintenanceComment,
  completeMaintenancePhotos,
  completeResidenceMaintenancePhotos,
  fetchMaintenanceTimeline,
  getMaintenanceTicket,
  presignMaintenancePhotos,
  presignResidenceMaintenancePhotos,
  refresh,
  updateMaintenanceStatus
} = vi.hoisted(() => ({
  addMaintenanceComment: vi.fn(),
  completeMaintenancePhotos: vi.fn(),
  completeResidenceMaintenancePhotos: vi.fn(),
  fetchMaintenanceTimeline: vi.fn(),
  getMaintenanceTicket: vi.fn(),
  presignMaintenancePhotos: vi.fn(),
  presignResidenceMaintenancePhotos: vi.fn(),
  refresh: vi.fn(),
  updateMaintenanceStatus: vi.fn()
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  promise: vi.fn(),
  dismiss: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/toast/use-toast", () => ({ useToast: () => toast }));
vi.mock("@/lib/pg-operations-api", () => ({
  addMaintenanceComment,
  completeMaintenancePhotos,
  completeResidenceMaintenancePhotos,
  fetchMaintenanceTimeline,
  getMaintenanceTicket,
  presignMaintenancePhotos,
  presignResidenceMaintenancePhotos,
  updateMaintenanceStatus
}));

import MaintenanceTicketPageClient from "../MaintenanceTicketPageClient";

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
    priority: "normal",
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
    timeline: [],
    ...overrides
  };
}

function renderClient(initialRequest = ticket()) {
  render(
    <MaintenanceTicketPageClient
      initialRequest={initialRequest}
      propertyId="property-1"
      token="token-1"
    />
  );
}

describe("MaintenanceTicketPageClient", () => {
  beforeEach(() => {
    addMaintenanceComment.mockReset();
    completeMaintenancePhotos.mockReset();
    completeResidenceMaintenancePhotos.mockReset();
    fetchMaintenanceTimeline.mockReset();
    getMaintenanceTicket.mockReset();
    presignMaintenancePhotos.mockReset();
    presignResidenceMaintenancePhotos.mockReset();
    refresh.mockReset();
    updateMaintenanceStatus.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    getMaintenanceTicket.mockImplementation((_propertyId, requestId) =>
      Promise.resolve(ticket({ id: requestId, status: "in_progress" }))
    );
    fetchMaintenanceTimeline.mockResolvedValue([]);
    updateMaintenanceStatus.mockResolvedValue(ticket({ status: "in_progress" }));
    addMaintenanceComment.mockResolvedValue({
      id: "comment-1",
      request_id: "ticket-1",
      author_user_id: "operator-1",
      author_role: "pg_operator",
      body: "On the way",
      attachments: [],
      attachment_urls: [],
      created_at: "2026-07-14T10:00:00.000Z"
    });
  });

  it("optimistically moves status on the route, rolls it back, and retries with toast action", async () => {
    let rejectStatus: (cause: Error) => void = () => undefined;
    updateMaintenanceStatus.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStatus = reject;
        })
    );
    renderClient();

    fireEvent.click(screen.getByRole("button", { name: "Start work" }));

    await waitFor(() => expect(screen.getByText("In progress")).toBeInTheDocument());
    await act(async () => {
      rejectStatus(new Error("Network unavailable"));
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not move ticket ticket-1 to In progress.",
        expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
      )
    );
    expect(screen.getByText("Open")).toBeInTheDocument();

    await act(async () => {
      toast.error.mock.calls[0][1].action.onClick();
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Ticket ticket-1 -> In progress")
    );
    expect(updateMaintenanceStatus).toHaveBeenCalledTimes(2);
  });

  it("optimistically appends a route comment, rolls it back, and retries the same submission", async () => {
    let rejectComment: (cause: Error) => void = () => undefined;
    addMaintenanceComment.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectComment = reject;
        })
    );
    renderClient(ticket({ status: "in_progress" }));

    fireEvent.change(screen.getByLabelText("Add comment"), {
      target: { value: "  On the way  " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));

    const publicThread = screen.getByRole("region", { name: "Ticket comments" });
    expect(within(publicThread).getByRole("listitem")).toHaveTextContent("On the way");
    await waitFor(() => expect(addMaintenanceComment).toHaveBeenCalledTimes(1));

    await act(async () => {
      rejectComment(new Error("Network unavailable"));
    });
    await waitFor(() =>
      expect(within(publicThread).queryByRole("listitem")).not.toBeInTheDocument()
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Could not add comment to ticket ticket-1.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
    );

    await act(async () => {
      toast.error.mock.calls[0][1].action.onClick();
    });
    await waitFor(() => expect(addMaintenanceComment).toHaveBeenCalledTimes(2));
    expect(within(publicThread).getByRole("listitem")).toHaveTextContent("On the way");
    expect(toast.success).toHaveBeenCalledWith("Added comment to ticket ticket-1");
  });
});
