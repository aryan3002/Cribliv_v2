import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgMaintenanceRequest } from "@cribliv/shared-types";

const { resolveMaintenanceTicket, uploadForComment } = vi.hoisted(() => ({
  resolveMaintenanceTicket: vi.fn(),
  uploadForComment: vi.fn()
}));
const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  promise: vi.fn(),
  dismiss: vi.fn()
}));

vi.mock("@/lib/pg-operations-api", () => ({
  resolveMaintenanceTicket
}));
vi.mock("@/components/ui/toast/use-toast", () => ({ useToast: () => toast }));

vi.mock("../useMaintenancePhotoUpload", () => ({
  createMaintenanceUploadId: () => "idem-resolution",
  releaseMaintenancePhotoPreview: vi.fn(),
  useMaintenancePhotoUpload: () => ({
    addFiles: (files: FileList | File[]) =>
      Array.from(files).map((file, index) => ({
        clientUploadId: `fix-photo-${index + 1}`,
        file,
        previewUrl: null
      })),
    removePhoto: vi.fn(),
    uploadForComment
  })
}));

import MaintenanceResolutionSheet from "../MaintenanceResolutionSheet";

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
    ...overrides
  };
}

function renderSheet(onResolved = vi.fn()) {
  render(
    <MaintenanceResolutionSheet
      request={ticket()}
      propertyId="property-1"
      token="token-1"
      onResolved={onResolved}
    />
  );
  return { onResolved };
}

describe("MaintenanceResolutionSheet", () => {
  beforeEach(() => {
    resolveMaintenanceTicket.mockReset();
    uploadForComment.mockReset();
    resolveMaintenanceTicket.mockResolvedValue(ticket({ status: "resolved" }));
    uploadForComment.mockResolvedValue(["pg-maintenance/property-1/ticket-1/fix-photo.jpg"]);
  });

  it("blocks submit when the resolution note is empty", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a resolution note.");
    expect(resolveMaintenanceTicket).not.toHaveBeenCalled();
  });

  it("blocks submit when cost is negative", () => {
    renderSheet();

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Replaced the tap washer." }
    });
    fireEvent.change(screen.getByLabelText("Cost in rupees"), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a cost of 0 or more.");
    expect(resolveMaintenanceTicket).not.toHaveBeenCalled();
  });

  it("blocks submit until chargeable damage is selected", () => {
    renderSheet();

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Replaced the tap washer." }
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Select whether this was chargeable damage."
    );
    expect(resolveMaintenanceTicket).not.toHaveBeenCalled();
  });

  it("submits note, optional cost, chargeable flag, and uploaded fix photo paths", async () => {
    const { onResolved } = renderSheet();

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "  Replaced the tap washer.  " }
    });
    fireEvent.change(screen.getByLabelText("Cost in rupees"), { target: { value: "125" } });
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.change(screen.getByLabelText("Add fix photos"), {
      target: {
        files: [new File(["fixed"], "fixed.jpg", { type: "image/jpeg" })]
      }
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    await waitFor(() =>
      expect(resolveMaintenanceTicket).toHaveBeenCalledWith(
        "property-1",
        "ticket-1",
        {
          note: "Replaced the tap washer.",
          cost_paise: 12500,
          chargeable_damage: true,
          fix_photo_paths: ["pg-maintenance/property-1/ticket-1/fix-photo.jpg"]
        },
        "token-1",
        "idem-resolution"
      )
    );
    expect(onResolved).toHaveBeenCalledWith(ticket({ status: "resolved" }));
  });

  it("omits optional cost when the cost field is blank", async () => {
    renderSheet();

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Resolved without paid materials." }
    });
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    await waitFor(() =>
      expect(resolveMaintenanceTicket).toHaveBeenCalledWith(
        "property-1",
        "ticket-1",
        {
          note: "Resolved without paid materials.",
          chargeable_damage: false,
          fix_photo_paths: ["pg-maintenance/property-1/ticket-1/fix-photo.jpg"]
        },
        "token-1",
        "idem-resolution"
      )
    );
  });

  it("reports pending state to the parent while submitting", async () => {
    let finishRequest: (value: PgMaintenanceRequest) => void = () => {};
    resolveMaintenanceTicket.mockImplementation(
      () => new Promise<PgMaintenanceRequest>((resolve) => (finishRequest = resolve))
    );
    const onPendingChange = vi.fn();
    render(
      <MaintenanceResolutionSheet
        request={ticket()}
        propertyId="property-1"
        token="token-1"
        onResolved={vi.fn()}
        onPendingChange={onPendingChange}
      />
    );

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Replaced the tap washer." }
    });
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    fireEvent.click(screen.getByRole("button", { name: "Resolve ticket" }));

    await waitFor(() => expect(onPendingChange).toHaveBeenCalledWith(true));
    await act(async () => {
      finishRequest(ticket({ status: "resolved" }));
    });
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
  });
});
