import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PgMaintenanceCategory,
  PgMaintenanceLocation,
  PgMaintenanceRequest
} from "@cribliv/shared-types";

const {
  createResidenceMaintenance,
  presignResidenceMaintenancePhotos,
  completeResidenceMaintenancePhotos
} = vi.hoisted(() => ({
  createResidenceMaintenance: vi.fn(),
  presignResidenceMaintenancePhotos: vi.fn(),
  completeResidenceMaintenancePhotos: vi.fn()
}));

vi.mock("@/lib/pg-operations-api", () => ({
  createResidenceMaintenance,
  presignResidenceMaintenancePhotos,
  completeResidenceMaintenancePhotos
}));

import MaintenanceCreateForm from "../MaintenanceCreateForm";

const categories: PgMaintenanceCategory[] = [
  {
    slug: "plumbing",
    display_name: "Plumbing",
    default_priority: "high",
    active: true,
    sort_order: 10
  },
  {
    slug: "electrical",
    display_name: "Electrical",
    default_priority: "emergency",
    active: true,
    sort_order: 20
  },
  {
    slug: "other",
    display_name: "Other",
    default_priority: "normal",
    active: true,
    sort_order: 150
  }
];

const currentResidenceLocation: PgMaintenanceLocation = {
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
};

function request(overrides: Partial<PgMaintenanceRequest> = {}): PgMaintenanceRequest {
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
    sla_due_at: "2026-07-15T09:00:00.000Z",
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
    location: currentResidenceLocation,
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

function setup({
  onCreated = vi.fn(),
  location = currentResidenceLocation
}: {
  onCreated?: ReturnType<typeof vi.fn>;
  location?: PgMaintenanceLocation | null;
} = {}) {
  render(
    <MaintenanceCreateForm
      token="token-1"
      categories={categories}
      currentResidenceLocation={location}
      onCreated={onCreated}
    />
  );
  return { onCreated };
}

function fillRequiredExceptLocation() {
  fireEvent.change(screen.getByLabelText("Category"), { target: { value: "plumbing" } });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "The bathroom tap has been leaking since this morning." }
  });
}

describe("MaintenanceCreateForm", () => {
  beforeEach(() => {
    createResidenceMaintenance.mockReset();
    presignResidenceMaintenancePhotos.mockReset();
    completeResidenceMaintenancePhotos.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    createResidenceMaintenance.mockResolvedValue(request({ id: "ticket-2" }));
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
      request({
        id: "ticket-2",
        photo_paths: ["pg-maintenance/property-1/ticket-2/photo-1.jpg"],
        photo_urls: ["https://cdn.test/photo-1.jpg"]
      })
    );
  });

  it("requires a location kind before submitting", async () => {
    setup();
    fillRequiredExceptLocation();

    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Choose where the issue is happening.");
    expect(createResidenceMaintenance).not.toHaveBeenCalled();
  });

  it("requires a common area when that location kind is selected", async () => {
    setup();
    fillRequiredExceptLocation();
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "common_area" } });

    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Choose the common area.");
    expect(createResidenceMaintenance).not.toHaveBeenCalled();
  });

  it("requires other location detail when that location kind is selected", async () => {
    setup();
    fillRequiredExceptLocation();
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "other" } });

    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter the location detail.");
    expect(createResidenceMaintenance).not.toHaveBeenCalled();
  });

  it("requires a category before submitting", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "bed" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The bathroom tap has been leaking since this morning." }
    });

    fireEvent.click(screen.getByRole("button", { name: "Raise ticket" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a maintenance category.");
    expect(createResidenceMaintenance).not.toHaveBeenCalled();
  });

  it("shows the SLA hint for plumbing", () => {
    setup();

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "plumbing" } });

    expect(screen.getByText("High · due in 24h")).toBeInTheDocument();
  });

  it("submits the new create contract with property-wide location when residence location is missing", async () => {
    setup({ location: null });
    fireEvent.change(screen.getByLabelText("Category"), {
      target: {
        value: screen.getByRole("option", { name: "Plumbing" }).getAttribute("value") ?? "plumbing"
      }
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "The bathroom tap has been leaking since this morning." }
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
  });

  it("uploads selected photos after creating the ticket", async () => {
    const { onCreated } = setup();
    fillRequiredExceptLocation();
    fireEvent.change(screen.getByLabelText("Location"), { target: { value: "bed" } });
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
            kind: "bed",
            room_id: "room-1",
            bed_id: "bed-1",
            floor: 1
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
    await waitFor(() =>
      expect(completeResidenceMaintenancePhotos).toHaveBeenCalledWith(
        "ticket-2",
        [{ clientUploadId: "photo-1", blobPath: "pg-maintenance/property-1/ticket-2/photo-1.jpg" }],
        "token-1",
        expect.any(String)
      )
    );
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ticket-2",
        photo_paths: ["pg-maintenance/property-1/ticket-2/photo-1.jpg"]
      })
    );
  });
});
