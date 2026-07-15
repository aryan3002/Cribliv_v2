import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type {
  PgMaintenanceInternalNoteResponse,
  PgMaintenanceRequest
} from "@cribliv/shared-types";

const { addMaintenanceInternalNote, overrideMaintenancePriority, resolveMaintenanceTicket } =
  vi.hoisted(() => ({
    addMaintenanceInternalNote: vi.fn(),
    overrideMaintenancePriority: vi.fn(),
    resolveMaintenanceTicket: vi.fn()
  }));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  promise: vi.fn(),
  dismiss: vi.fn()
}));

vi.mock("@/lib/pg-operations-api", () => ({
  addMaintenanceInternalNote,
  overrideMaintenancePriority,
  resolveMaintenanceTicket
}));
vi.mock("@/components/ui/toast/use-toast", () => ({ useToast: () => toast }));

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

type DetailProps = ComponentProps<typeof MaintenanceTicketDetail>;

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

function internalNote(overrides: Partial<PgMaintenanceInternalNoteResponse> = {}) {
  return {
    id: "note-1",
    request_id: "ticket-1",
    author_user_id: "operator-1",
    author_role: "pg_operator",
    visibility: "operator_internal",
    body: "Private follow-up.",
    attachments: [],
    attachment_urls: [],
    created_at: "2026-07-14T10:00:00.000Z",
    ...overrides
  } satisfies PgMaintenanceInternalNoteResponse;
}

function detailProps(
  request: PgMaintenanceRequest,
  overrides: Partial<DetailProps> = {}
): DetailProps {
  return {
    request,
    mode: "operator",
    propertyId: "property-1",
    token: "token-1",
    transitions: ["resolved"],
    pending: null,
    detailLoading: false,
    comment: "",
    commentPhotos: [],
    onCommentChange: vi.fn(),
    onAddCommentPhotos: vi.fn(),
    onRemoveCommentPhoto: vi.fn(),
    onSubmitComment: vi.fn(),
    onStatusChange: vi.fn(),
    onRequestUpdated: vi.fn(),
    onInternalNoteCreated: vi.fn(),
    onInternalNoteRollback: vi.fn(),
    ...overrides
  };
}

function renderDetail(request: PgMaintenanceRequest, overrides: Partial<DetailProps> = {}) {
  return render(<MaintenanceTicketDetail {...detailProps(request, overrides)} />);
}

describe("MaintenanceTicketDetail", () => {
  beforeEach(() => {
    addMaintenanceInternalNote.mockReset();
    overrideMaintenancePriority.mockReset();
    resolveMaintenanceTicket.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
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
      <MaintenanceTicketDetail {...detailProps(ticket({ id: "ticket-2", priority: "normal" }))} />
    );

    await waitFor(() => expect(screen.queryByLabelText("Resolution note")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("Priority")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Override priority" }));

    expect(screen.getByLabelText("Priority")).toHaveDisplayValue("Normal");
    expect(screen.getByLabelText("Reason")).toHaveValue("");
  });

  it("does not carry an internal note draft or error across selected tickets", () => {
    const { rerender } = renderDetail(ticket({ id: "ticket-1" }));

    fireEvent.click(screen.getByRole("button", { name: "Add internal note" }));
    fireEvent.change(screen.getByLabelText("Internal note"), {
      target: { value: "Ticket one private follow-up." }
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Enter an internal note.");
    expect(screen.getByLabelText("Internal note")).toHaveValue("Ticket one private follow-up.");

    rerender(<MaintenanceTicketDetail {...detailProps(ticket({ id: "ticket-2" }))} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Internal note")).toHaveValue("");
  });

  it("resets the comment photo input when pending comment photos are cleared", () => {
    const pendingPhoto = {
      clientUploadId: "comment-photo-1",
      file: new File(["proof"], "proof.png", { type: "image/png" }),
      previewUrl: null
    };
    const { rerender } = renderDetail(ticket(), { commentPhotos: [pendingPhoto] });
    const input = screen.getByLabelText("Add comment photos") as HTMLInputElement;
    Object.defineProperty(input, "value", {
      configurable: true,
      value: "stale-selection.png",
      writable: true
    });

    rerender(<MaintenanceTicketDetail {...detailProps(ticket(), { commentPhotos: [] })} />);

    expect(input).toHaveValue("");
  });

  it("optimistically overrides priority, rolls it back, and retries with the same reason", async () => {
    let rejectPriority: (cause: Error) => void = () => undefined;
    const onRequestUpdated = vi.fn();
    overrideMaintenancePriority.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectPriority = reject;
        })
    );
    renderDetail(ticket({ priority: "low" }), { onRequestUpdated });

    fireEvent.click(screen.getByRole("button", { name: "Override priority" }));
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Water is spreading into another room." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Save priority" }));

    await waitFor(() =>
      expect(onRequestUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ticket-1",
          priority: "high",
          priority_source: "operator_override",
          priority_override_reason: "Water is spreading into another room."
        }),
        { reload: false }
      )
    );

    await act(async () => {
      rejectPriority(new Error("Network unavailable"));
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not override priority for ticket ticket-1.",
        expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
      )
    );
    expect(onRequestUpdated).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "ticket-1", priority: "low" }),
      { reload: false }
    );

    overrideMaintenancePriority.mockResolvedValueOnce(ticket({ priority: "high" }));
    await act(async () => {
      toast.error.mock.calls[0][1].action.onClick();
    });
    await waitFor(() =>
      expect(overrideMaintenancePriority).toHaveBeenLastCalledWith(
        "property-1",
        "ticket-1",
        { priority: "high", reason: "Water is spreading into another room." },
        "token-1",
        "idem-detail"
      )
    );
    expect(onRequestUpdated).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "ticket-1", priority: "high" }),
      { reload: true }
    );
  });

  it("optimistically appends an internal note, rolls it back, and replaces it on retry", async () => {
    let rejectNote: (cause: Error) => void = () => undefined;
    const onInternalNoteCreated = vi.fn();
    const onInternalNoteRollback = vi.fn();
    addMaintenanceInternalNote.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectNote = reject;
        })
    );
    renderDetail(ticket(), { onInternalNoteCreated, onInternalNoteRollback });

    fireEvent.change(screen.getByLabelText("Internal note"), {
      target: { value: "  Check the ceiling patch tomorrow. " }
    });
    fireEvent.click(screen.getByRole("button", { name: "Add internal note" }));

    await waitFor(() =>
      expect(onInternalNoteCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "optimistic-note-idem-detail",
          request_id: "ticket-1",
          body: "Check the ceiling patch tomorrow."
        })
      )
    );

    await act(async () => {
      rejectNote(new Error("Network unavailable"));
    });
    await waitFor(() =>
      expect(onInternalNoteRollback).toHaveBeenCalledWith("optimistic-note-idem-detail")
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Could not add internal note to ticket ticket-1.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
    );

    addMaintenanceInternalNote.mockResolvedValueOnce(
      internalNote({ body: "Check the ceiling patch tomorrow." })
    );
    await act(async () => {
      toast.error.mock.calls[0][1].action.onClick();
    });
    await waitFor(() =>
      expect(onInternalNoteCreated).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "note-1", body: "Check the ceiling patch tomorrow." }),
        "optimistic-note-idem-detail"
      )
    );
  });

  it("optimistically resolves a ticket, rolls it back, and retries the same payload", async () => {
    let rejectResolution: (cause: Error) => void = () => undefined;
    const onRequestUpdated = vi.fn();
    resolveMaintenanceTicket.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectResolution = reject;
        })
    );
    renderDetail(ticket({ status: "in_progress" }), { onRequestUpdated });

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Fixed the leak and checked pressure." }
    });
    fireEvent.change(screen.getByLabelText("Cost in rupees"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    await waitFor(() =>
      expect(onRequestUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "ticket-1",
          status: "resolved",
          resolution_note: "Fixed the leak and checked pressure.",
          resolution_cost_paise: 25000,
          chargeable_damage: false
        }),
        { reload: false }
      )
    );

    await act(async () => {
      rejectResolution(new Error("Network unavailable"));
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not resolve ticket ticket-1.",
        expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
      )
    );
    expect(onRequestUpdated).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "ticket-1", status: "in_progress" }),
      { reload: false }
    );

    resolveMaintenanceTicket.mockResolvedValueOnce(
      ticket({
        status: "resolved",
        resolution_note: "Fixed the leak and checked pressure.",
        resolution_cost_paise: 25000
      })
    );
    await act(async () => {
      toast.error.mock.calls[0][1].action.onClick();
    });
    await waitFor(() =>
      expect(resolveMaintenanceTicket).toHaveBeenLastCalledWith(
        "property-1",
        "ticket-1",
        {
          note: "Fixed the leak and checked pressure.",
          chargeable_damage: false,
          cost_paise: 25000
        },
        "token-1",
        "idem-detail"
      )
    );
    expect(onRequestUpdated).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: "ticket-1",
        status: "resolved",
        resolution_note: "Fixed the leak and checked pressure."
      }),
      { reload: true }
    );
  });

  it("does not double-submit a failed resolution when the retry action is clicked twice", async () => {
    let rejectResolution: (cause: Error) => void = () => undefined;
    resolveMaintenanceTicket.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectResolution = reject;
        })
    );
    renderDetail(ticket({ status: "in_progress" }));

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Fixed the leak and checked pressure." }
    });
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    await waitFor(() => expect(resolveMaintenanceTicket).toHaveBeenCalledTimes(1));
    await act(async () => {
      rejectResolution(new Error("Network unavailable"));
    });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Could not resolve ticket ticket-1.",
        expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
      )
    );

    resolveMaintenanceTicket.mockImplementation(
      () => new Promise<PgMaintenanceRequest>(() => undefined)
    );
    const retry = toast.error.mock.calls[0][1].action.onClick;
    await act(async () => {
      retry();
      retry();
    });

    expect(resolveMaintenanceTicket).toHaveBeenCalledTimes(2);
  });
});
