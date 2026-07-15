import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgMaintenanceRequest } from "@cribliv/shared-types";

const {
  refresh,
  updateMaintenanceStatus,
  addMaintenanceComment,
  addMaintenanceInternalNote,
  createResidenceMaintenance,
  getMaintenanceTicket,
  fetchMaintenanceTimeline,
  getResidenceMaintenanceTicket,
  overrideMaintenancePriority,
  resolveMaintenanceTicket,
  presignMaintenancePhotos,
  completeMaintenancePhotos,
  presignResidenceMaintenancePhotos,
  completeResidenceMaintenancePhotos
} = vi.hoisted(() => ({
  refresh: vi.fn(),
  updateMaintenanceStatus: vi.fn(),
  addMaintenanceComment: vi.fn(),
  addMaintenanceInternalNote: vi.fn(),
  createResidenceMaintenance: vi.fn(),
  getMaintenanceTicket: vi.fn(),
  fetchMaintenanceTimeline: vi.fn(),
  getResidenceMaintenanceTicket: vi.fn(),
  overrideMaintenancePriority: vi.fn(),
  resolveMaintenanceTicket: vi.fn(),
  presignMaintenancePhotos: vi.fn(),
  completeMaintenancePhotos: vi.fn(),
  presignResidenceMaintenancePhotos: vi.fn(),
  completeResidenceMaintenancePhotos: vi.fn()
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  promise: vi.fn(),
  dismiss: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/lib/pg-operations-api", () => ({
  updateMaintenanceStatus,
  addMaintenanceComment,
  addMaintenanceInternalNote,
  createResidenceMaintenance,
  getMaintenanceTicket,
  fetchMaintenanceTimeline,
  getResidenceMaintenanceTicket,
  overrideMaintenancePriority,
  resolveMaintenanceTicket,
  addResidenceMaintenanceComment: vi.fn(),
  presignMaintenancePhotos,
  completeMaintenancePhotos,
  presignResidenceMaintenancePhotos,
  completeResidenceMaintenancePhotos
}));
vi.mock("@/components/ui/toast/use-toast", () => ({ useToast: () => toast }));

import MaintenanceWorkspace from "../MaintenanceWorkspace";

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

describe("MaintenanceWorkspace", () => {
  beforeEach(() => {
    refresh.mockReset();
    updateMaintenanceStatus.mockReset();
    addMaintenanceComment.mockReset();
    addMaintenanceInternalNote.mockReset();
    createResidenceMaintenance.mockReset();
    getMaintenanceTicket.mockReset();
    fetchMaintenanceTimeline.mockReset();
    getResidenceMaintenanceTicket.mockReset();
    overrideMaintenancePriority.mockReset();
    resolveMaintenanceTicket.mockReset();
    presignMaintenancePhotos.mockReset();
    completeMaintenancePhotos.mockReset();
    presignResidenceMaintenancePhotos.mockReset();
    completeResidenceMaintenancePhotos.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    updateMaintenanceStatus.mockResolvedValue(ticket({ status: "in_progress" }));
    getMaintenanceTicket.mockImplementation((_propertyId, requestId) =>
      Promise.resolve(ticket({ id: requestId }))
    );
    fetchMaintenanceTimeline.mockResolvedValue([]);
    getResidenceMaintenanceTicket.mockImplementation((requestId) =>
      Promise.resolve(ticket({ id: requestId }))
    );
    overrideMaintenancePriority.mockResolvedValue(ticket({ priority: "high" }));
    resolveMaintenanceTicket.mockResolvedValue(ticket({ status: "resolved" }));
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
    createResidenceMaintenance.mockResolvedValue(ticket({ id: "ticket-2" }));
    presignMaintenancePhotos.mockResolvedValue({
      uploads: [
        {
          clientUploadId: "comment-photo-1",
          uploadUrl: "https://upload.test/comment-photo-1.png",
          blobPath: "pg-maintenance/property-1/ticket-1/comment-photo-1.png",
          expiresAt: "2099-01-01T00:00:00.000Z"
        }
      ]
    });
    presignResidenceMaintenancePhotos.mockResolvedValue({
      uploads: [
        {
          clientUploadId: "photo-1",
          uploadUrl: "https://upload.test/photo-1.jpg",
          blobPath: "pg-maintenance/property-1/ticket-2/photo-1.jpg",
          expiresAt: "2099-01-01T00:00:00.000Z"
        }
      ]
    });
    completeResidenceMaintenancePhotos.mockResolvedValue(
      ticket({
        id: "ticket-2",
        photo_paths: ["pg-maintenance/property-1/ticket-2/photo-1.jpg"],
        photo_urls: ["https://cdn.test/photo-1.jpg"]
      })
    );
  });

  it("only offers and submits valid operator status transitions", async () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[ticket()]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    expect(screen.getByRole("button", { name: "Start work" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel ticket" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Resolve" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start work" }));

    await waitFor(() =>
      expect(updateMaintenanceStatus).toHaveBeenCalledWith(
        "property-1",
        "ticket-1",
        "in_progress",
        "token-1"
      )
    );
    expect(toast.success).toHaveBeenCalledWith("Ticket ticket-1 -> In progress");
  });

  it("rolls back an optimistic status move and exposes a retry toast action", async () => {
    let rejectStatusUpdate: (cause: Error) => void = () => undefined;
    updateMaintenanceStatus.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectStatusUpdate = reject;
        })
    );
    render(
      <MaintenanceWorkspace
        initialRequests={[ticket()]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start work" }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("button", { pressed: true })).getByText("In progress")
      ).toBeInTheDocument()
    );
    await act(async () => {
      rejectStatusUpdate(new Error("Network unavailable"));
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not move ticket ticket-1 to In progress.",
        expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
      )
    );
    expect(
      within(screen.getByRole("button", { pressed: true })).getByText("Open")
    ).toBeInTheDocument();
  });

  it("shows detail skeletons while ticket timeline hydrates", async () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[ticket({ timeline: undefined })]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    expect(
      screen.getByRole("status", { name: "Loading maintenance timeline" })
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading maintenance photos" })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Loading maintenance timeline" })
      ).not.toBeInTheDocument()
    );
  });

  it("does not keep a hidden ticket selected after filtering", () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[
          ticket(),
          ticket({ id: "ticket-2", category: "Electrical", status: "resolved" })
        ]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    expect(screen.getByRole("heading", { name: "Plumbing" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter tickets"), {
      target: { value: "resolved" }
    });

    expect(screen.queryByRole("heading", { name: "Plumbing" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Electrical" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start work" })).not.toBeInTheDocument();
  });

  it("defaults to active work while keeping closed tickets reachable from all statuses", () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[
          ticket({ id: "open-ticket", category: "Plumbing", status: "open" }),
          ticket({ id: "closed-ticket", category: "Cleaning", status: "closed" })
        ]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    expect(screen.getByLabelText("Filter tickets")).toHaveDisplayValue("Active work");
    expect(screen.getByText("1 total")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plumbing" })).toBeInTheDocument();
    expect(screen.queryByText("Cleaning")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter tickets"), { target: { value: "all" } });

    expect(screen.getByText("2 total")).toBeInTheDocument();
    expect(screen.getByText("Cleaning")).toBeInTheDocument();
  });

  it("requires a trimmed comment or photo before submitting it", async () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[ticket()]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    fireEvent.change(screen.getByLabelText("Add comment"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a comment or add a photo before sending."
    );

    fireEvent.change(screen.getByLabelText("Add comment"), { target: { value: "  On the way  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));

    await waitFor(() =>
      expect(addMaintenanceComment).toHaveBeenCalledWith(
        "property-1",
        "ticket-1",
        { body: "On the way" },
        "token-1",
        expect.any(String)
      )
    );
  });

  it("uploads selected comment photos as request-scoped attachments", async () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[ticket()]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    fireEvent.change(screen.getByLabelText("Add comment photos"), {
      target: {
        files: [new File(["proof"], "proof.png", { type: "image/png" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Send comment" }));

    await waitFor(() =>
      expect(presignMaintenancePhotos).toHaveBeenCalledWith(
        "property-1",
        "ticket-1",
        [{ clientUploadId: expect.any(String), contentType: "image/png", sizeBytes: 5 }],
        "token-1",
        expect.any(String)
      )
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://upload.test/comment-photo-1.png",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/png", "x-ms-blob-type": "BlockBlob" }
      })
    );
    await waitFor(() =>
      expect(addMaintenanceComment).toHaveBeenCalledWith(
        "property-1",
        "ticket-1",
        {
          body: "",
          attachments: ["pg-maintenance/property-1/ticket-1/comment-photo-1.png"]
        },
        "token-1",
        expect.any(String)
      )
    );
  });

  it("shows room context and ticket photos in the detail pane", () => {
    render(
      <MaintenanceWorkspace
        initialRequests={[
          ticket({
            photo_paths: ["pg-maintenance/property-1/ticket-1/tap.jpg"],
            photo_urls: ["https://cdn.test/tap.jpg"]
          })
        ]}
        mode="operator"
        propertyId="property-1"
        token="token-1"
      />
    );

    expect(screen.getAllByText("Room P5-101 · Bed A")).toHaveLength(2);
    expect(screen.getByText("Floor 1")).toBeInTheDocument();
    expect(screen.getByText("P5 Tenant 1")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Maintenance photo 1" })).toHaveAttribute(
      "src",
      "https://cdn.test/tap.jpg"
    );
  });

  it("uses guided categories and requires an Other label when selected", async () => {
    render(<MaintenanceWorkspace initialRequests={[]} mode="tenant" token="token-1" />);

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The lift has stopped on the third floor." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the issue category.");

    fireEvent.change(screen.getByLabelText("Issue category"), { target: { value: "  Lift " } });
    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));

    await waitFor(() =>
      expect(createResidenceMaintenance).toHaveBeenCalledWith(
        {
          category_slug: "other",
          category: "Lift",
          description: "The lift has stopped on the third floor.",
          location: {
            kind: "property_wide"
          }
        },
        "token-1",
        expect.any(String)
      )
    );
  });

  it("uploads selected tenant photos after creating the ticket", async () => {
    render(<MaintenanceWorkspace initialRequests={[]} mode="tenant" token="token-1" />);

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "plumbing" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "  The bathroom tap has been leaking since this morning. " }
    });
    fireEvent.change(screen.getByLabelText("Add photos"), {
      target: {
        files: [new File(["photo"], "tap.jpg", { type: "image/jpeg" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));

    await waitFor(() =>
      expect(createResidenceMaintenance).toHaveBeenCalledWith(
        {
          category_slug: "plumbing",
          description: "The bathroom tap has been leaking since this morning.",
          location: {
            kind: "property_wide"
          }
        },
        "token-1",
        expect.any(String)
      )
    );
    await waitFor(() =>
      expect(presignResidenceMaintenancePhotos).toHaveBeenCalledWith(
        "ticket-2",
        [{ clientUploadId: expect.any(String), contentType: "image/jpeg", sizeBytes: 5 }],
        "token-1",
        expect.any(String)
      )
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://upload.test/photo-1.jpg",
      expect.objectContaining({
        method: "PUT",
        headers: { "Content-Type": "image/jpeg", "x-ms-blob-type": "BlockBlob" }
      })
    );
    expect(completeResidenceMaintenancePhotos).toHaveBeenCalledWith(
      "ticket-2",
      [{ clientUploadId: "photo-1", blobPath: "pg-maintenance/property-1/ticket-2/photo-1.jpg" }],
      "token-1",
      expect.any(String)
    );
  });

  it("keeps a raised ticket visible when the follow-up photo upload fails", async () => {
    presignResidenceMaintenancePhotos.mockRejectedValueOnce(new Error("Upload URL expired."));
    render(<MaintenanceWorkspace initialRequests={[]} mode="tenant" token="token-1" />);

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "plumbing" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The bathroom tap has been leaking since this morning." }
    });
    fireEvent.change(screen.getByLabelText("Add photos"), {
      target: {
        files: [new File(["photo"], "tap.jpg", { type: "image/jpeg" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Plumbing" })).toBeInTheDocument()
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ticket raised, but photos could not be uploaded. Upload URL expired."
    );
  });
});
