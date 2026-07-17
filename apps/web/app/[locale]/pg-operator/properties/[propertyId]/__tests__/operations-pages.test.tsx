import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addMaintenanceComment: vi.fn(),
  addMaintenanceInternalNote: vi.fn(),
  addResidenceMaintenanceComment: vi.fn(),
  completeMaintenancePhotos: vi.fn(),
  completeResidenceMaintenancePhotos: vi.fn(),
  createResidenceMaintenance: vi.fn(),
  auth: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  fetchMaintenanceAnalytics: vi.fn(),
  fetchMaintenanceCategories: vi.fn(),
  getManagedProperty: vi.fn(),
  getMaintenanceTicket: vi.fn(),
  getResidenceMaintenanceTicket: vi.fn(),
  getOccupancySummary: vi.fn(),
  fetchMaintenanceTimeline: vi.fn(),
  getPropertyInventory: vi.fn(),
  getPropertyLayout: vi.fn(),
  listAssignments: vi.fn(),
  listBedMaintenance: vi.fn(),
  listPropertyMaintenance: vi.fn(),
  overrideMaintenancePriority: vi.fn(),
  presignMaintenancePhotos: vi.fn(),
  presignResidenceMaintenancePhotos: vi.fn(),
  resolveMaintenanceTicket: vi.fn(),
  updateMaintenanceStatus: vi.fn()
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() })
}));
vi.mock("@/lib/pg-operations-api", () => ({
  addMaintenanceComment: mocks.addMaintenanceComment,
  addMaintenanceInternalNote: mocks.addMaintenanceInternalNote,
  addResidenceMaintenanceComment: mocks.addResidenceMaintenanceComment,
  completeMaintenancePhotos: mocks.completeMaintenancePhotos,
  completeResidenceMaintenancePhotos: mocks.completeResidenceMaintenancePhotos,
  createResidenceMaintenance: mocks.createResidenceMaintenance,
  fetchMaintenanceAnalytics: mocks.fetchMaintenanceAnalytics,
  fetchMaintenanceCategories: mocks.fetchMaintenanceCategories,
  fetchMaintenanceTimeline: mocks.fetchMaintenanceTimeline,
  getManagedProperty: mocks.getManagedProperty,
  getMaintenanceTicket: mocks.getMaintenanceTicket,
  getResidenceMaintenanceTicket: mocks.getResidenceMaintenanceTicket,
  getOccupancySummary: mocks.getOccupancySummary,
  getPropertyInventory: mocks.getPropertyInventory,
  getPropertyLayout: mocks.getPropertyLayout,
  listAssignments: mocks.listAssignments,
  listBedMaintenance: mocks.listBedMaintenance,
  listPropertyMaintenance: mocks.listPropertyMaintenance,
  overrideMaintenancePriority: mocks.overrideMaintenancePriority,
  presignMaintenancePhotos: mocks.presignMaintenancePhotos,
  presignResidenceMaintenancePhotos: mocks.presignResidenceMaintenancePhotos,
  resolveMaintenanceTicket: mocks.resolveMaintenanceTicket,
  updateMaintenanceStatus: mocks.updateMaintenanceStatus
}));

import DashboardPage from "../page";
import MaintenancePage from "../maintenance/page";
import MaintenanceTicketPage from "../maintenance/[ticketId]/page";
import LayoutPage from "../layout/page";
import TenantsPage from "../tenants/page";
import { ToastProvider } from "@/components/ui/toast/toast-provider";

const property = {
  id: "property-1",
  operator_id: "operator-1",
  display_name: "North House",
  internal_code: null,
  city_id: 1,
  locality_id: null,
  total_floors: 2,
  status: "active",
  manage_enabled: true,
  layout_status: "ready",
  room_count: 1,
  bed_count: 2,
  available_bed_count: 1,
  room_types: []
};

const summary = {
  property_id: "property-1",
  total_beds: 2,
  vacant_beds: 1,
  reserved_beds: 0,
  occupied_beds: 0,
  blocked_beds: 0,
  inactive_beds: 1,
  occupancy_percent: 0,
  by_status: { vacant: 1, reserved: 0, occupied: 0, blocked: 0, inactive: 1 },
  by_floor: [],
  upcoming_move_ins: [],
  upcoming_move_outs: [],
  available_from: []
};

const maintenanceTicket = {
  id: "ticket-1",
  pg_property_id: "property-1",
  assignment_id: "assignment-1",
  created_by_user_id: "tenant-1",
  category: "Furniture",
  category_slug: "furniture",
  category_label_snapshot: "Furniture",
  description: "Tenant uploaded a broken chair photo.",
  photo_paths: ["pg-maintenance/property-1/ticket-1/chair.jpg"],
  photo_urls: ["https://cdn.test/chair.jpg"],
  status: "in_progress",
  priority: "normal",
  priority_source: "category_default",
  priority_overridden_by: null,
  priority_overridden_at: null,
  priority_override_reason: null,
  sla_hours: 72,
  sla_due_at: "2026-07-17T07:38:00.000Z",
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
  updated_at: "2026-07-14T09:00:00.000Z",
  comments: [
    {
      id: "comment-1",
      request_id: "ticket-1",
      author_user_id: "tenant-1",
      author_role: "tenant",
      body: "Please replace the chair.",
      attachments: ["pg-maintenance/property-1/ticket-1/comment.jpg"],
      attachment_urls: ["https://cdn.test/comment.jpg"],
      created_at: "2026-07-14T09:00:00.000Z"
    }
  ],
  location: {
    property_id: "property-1",
    property_name: "North House",
    room_id: "room-1",
    room_number: "103",
    room_label: "Room 103",
    floor: 1,
    bed_id: "bed-1",
    bed_label: "C",
    tenant_name: "Satvik Sarthak",
    tenant_phone_e164: "+911111111111"
  },
  location_snapshot: {
    kind: "bed",
    property_name: "North House",
    room_number: "103",
    room_label: "Room 103",
    floor: 1,
    bed_label: "C",
    common_area: null,
    detail: null
  },
  timeline: []
};

const maintenanceTimeline = [
  {
    id: "event-1",
    request_id: "ticket-1",
    event_type: "internal_note_added",
    visibility: "operator_internal",
    actor_user_id: "operator-1",
    actor_role: "pg_operator",
    from_status: null,
    to_status: null,
    payload: { body: "Vendor assigned." },
    created_at: "2026-07-14T10:00:00.000Z"
  }
];

function renderPage(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("PG operations route error states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2 = "true";
    mocks.auth.mockResolvedValue({ user: { role: "pg_operator" }, accessToken: "token-1" });
    mocks.getManagedProperty.mockResolvedValue(property);
    mocks.getMaintenanceTicket.mockResolvedValue(maintenanceTicket);
    mocks.fetchMaintenanceTimeline.mockResolvedValue(maintenanceTimeline);
    mocks.getOccupancySummary.mockResolvedValue(summary);
    mocks.getPropertyInventory.mockResolvedValue([]);
    mocks.getPropertyLayout.mockResolvedValue([]);
    mocks.listAssignments.mockResolvedValue([]);
    mocks.listBedMaintenance.mockResolvedValue([maintenanceTicket]);
    mocks.listPropertyMaintenance.mockResolvedValue({
      rows: [maintenanceTicket],
      next_cursor: null
    });
    mocks.fetchMaintenanceCategories.mockResolvedValue([]);
    mocks.fetchMaintenanceAnalytics.mockResolvedValue({
      open: 0,
      overdue: 0,
      due_today: 0,
      waiting_on_tenant: 0,
      resolved_pending_close: 0,
      closed_this_month: 0,
      by_category: []
    });
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2;
  });

  it("loads dashboard beds from the inventory read path", async () => {
    await DashboardPage({ params: { locale: "en", propertyId: "property-1" } });

    expect(mocks.getPropertyInventory).toHaveBeenCalledWith("property-1", "token-1");
    expect(mocks.getPropertyLayout).not.toHaveBeenCalled();
  });

  it("renders a dashboard error instead of fabricated occupancy data", async () => {
    mocks.getOccupancySummary.mockRejectedValue(new Error("API unavailable"));

    renderPage(await DashboardPage({ params: { locale: "en", propertyId: "property-1" } }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.queryByLabelText("Occupancy summary")).not.toBeInTheDocument();
  });

  it("renders a disabled layout builder when the layout fetch fails", async () => {
    mocks.getPropertyLayout.mockRejectedValue(new Error("API unavailable"));

    renderPage(await LayoutPage({ params: { locale: "en", propertyId: "property-1" } }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.getByRole("button", { name: /save layout/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add room/i })).toBeDisabled();
  });

  it("renders a layout error without showing the builder when the property fetch fails", async () => {
    mocks.getManagedProperty.mockRejectedValue(new Error("API unavailable"));

    renderPage(await LayoutPage({ params: { locale: "en", propertyId: "property-1" } }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.queryByRole("button", { name: /save layout/i })).not.toBeInTheDocument();
  });

  it("loads assignments and inventory for the tenants page", async () => {
    renderPage(await TenantsPage({ params: { locale: "en", propertyId: "property-1" } }));

    expect(mocks.listAssignments).toHaveBeenCalledWith("property-1", "token-1");
    expect(mocks.getPropertyInventory).toHaveBeenCalledWith("property-1", "token-1");
    expect(screen.getByRole("heading", { name: "Tenants" })).toBeInTheDocument();
  });

  it("loads closed rows for the flag-off legacy maintenance workspace", async () => {
    delete process.env.NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2;

    renderPage(
      await MaintenancePage({
        params: { locale: "en", propertyId: "property-1" },
        searchParams: {}
      })
    );

    expect(mocks.listPropertyMaintenance).toHaveBeenCalledWith("property-1", "token-1", {
      sort: "newest",
      limit: 100,
      include_closed: true
    });
    expect(screen.getByLabelText("Filter tickets")).toHaveDisplayValue("Active work");
  });

  it("renders the canonical maintenance ticket page with latest detail and timeline", async () => {
    renderPage(
      await MaintenanceTicketPage({
        params: { locale: "en", propertyId: "property-1", ticketId: "ticket-1" }
      })
    );

    expect(mocks.getManagedProperty).toHaveBeenCalledWith("property-1", "token-1");
    expect(mocks.getMaintenanceTicket).toHaveBeenCalledWith("property-1", "ticket-1", "token-1");
    expect(mocks.fetchMaintenanceTimeline).toHaveBeenCalledWith(
      "property-1",
      "ticket-1",
      "token-1"
    );
    expect(screen.getByRole("heading", { name: "Furniture" })).toBeInTheDocument();
    expect(screen.getByText("Tenant uploaded a broken chair photo.")).toBeInTheDocument();
    expect(screen.getByText("Please replace the chair.")).toBeInTheDocument();
    expect(screen.getByText("Vendor assigned.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add ticket photos" })).toBeInTheDocument();
  });

  it("does not call V2 ticket endpoints when the maintenance V2 flag is off", async () => {
    delete process.env.NEXT_PUBLIC_FF_PG_MAINTENANCE_OPS_V2;

    await expect(
      MaintenanceTicketPage({
        params: { locale: "en", propertyId: "property-1", ticketId: "ticket-1" }
      })
    ).rejects.toThrow("NEXT_REDIRECT:/en/pg-operator/properties/property-1/maintenance");

    expect(mocks.getManagedProperty).not.toHaveBeenCalled();
    expect(mocks.getMaintenanceTicket).not.toHaveBeenCalled();
    expect(mocks.fetchMaintenanceTimeline).not.toHaveBeenCalled();
  });

  it("renders ticket detail when the timeline endpoint fails", async () => {
    mocks.fetchMaintenanceTimeline.mockRejectedValueOnce(new Error("Timeline unavailable"));

    renderPage(
      await MaintenanceTicketPage({
        params: { locale: "en", propertyId: "property-1", ticketId: "ticket-1" }
      })
    );

    expect(mocks.fetchMaintenanceTimeline).toHaveBeenCalledWith(
      "property-1",
      "ticket-1",
      "token-1"
    );
    expect(screen.getByRole("heading", { name: "Furniture" })).toBeInTheDocument();
    expect(screen.getByText("Tenant uploaded a broken chair photo.")).toBeInTheDocument();
    expect(screen.getByText("No timeline events yet.")).toBeInTheDocument();
  });
});
