import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgTenantResidence } from "@cribliv/shared-types";
import { ToastProvider } from "@/components/ui/toast/toast-provider";

const mocks = vi.hoisted(() => ({
  addMaintenanceComment: vi.fn(),
  addMaintenanceInternalNote: vi.fn(),
  addResidenceMaintenanceComment: vi.fn(),
  completeMaintenancePhotos: vi.fn(),
  completeResidenceMaintenancePhotos: vi.fn(),
  createResidenceMaintenance: vi.fn(),
  fetchMaintenanceTimeline: vi.fn(),
  getMaintenanceTicket: vi.fn(),
  getResidenceMaintenanceTicket: vi.fn(),
  overrideMaintenancePriority: vi.fn(),
  presignMaintenancePhotos: vi.fn(),
  presignResidenceMaintenancePhotos: vi.fn(),
  refresh: vi.fn(),
  resolveMaintenanceTicket: vi.fn(),
  updateMaintenanceStatus: vi.fn(),
  acceptTenantOperatorMoveOut: vi.fn(),
  rejectTenantOperatorMoveOut: vi.fn(),
  requestTenantMoveOut: vi.fn(),
  serveTenantNotice: vi.fn()
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh })
}));

vi.mock("@/lib/pg-operations-api", () => ({
  addMaintenanceComment: mocks.addMaintenanceComment,
  addMaintenanceInternalNote: mocks.addMaintenanceInternalNote,
  addResidenceMaintenanceComment: mocks.addResidenceMaintenanceComment,
  completeMaintenancePhotos: mocks.completeMaintenancePhotos,
  completeResidenceMaintenancePhotos: mocks.completeResidenceMaintenancePhotos,
  createResidenceMaintenance: mocks.createResidenceMaintenance,
  fetchMaintenanceTimeline: mocks.fetchMaintenanceTimeline,
  getMaintenanceTicket: mocks.getMaintenanceTicket,
  getResidenceMaintenanceTicket: mocks.getResidenceMaintenanceTicket,
  overrideMaintenancePriority: mocks.overrideMaintenancePriority,
  presignMaintenancePhotos: mocks.presignMaintenancePhotos,
  presignResidenceMaintenancePhotos: mocks.presignResidenceMaintenancePhotos,
  resolveMaintenanceTicket: mocks.resolveMaintenanceTicket,
  updateMaintenanceStatus: mocks.updateMaintenanceStatus,
  acceptTenantOperatorMoveOut: mocks.acceptTenantOperatorMoveOut,
  rejectTenantOperatorMoveOut: mocks.rejectTenantOperatorMoveOut,
  requestTenantMoveOut: mocks.requestTenantMoveOut,
  serveTenantNotice: mocks.serveTenantNotice
}));

import PgResidenceClient from "../PgResidenceClient";

function activeResidence(): PgTenantResidence {
  return {
    assignment_id: "assignment-1",
    property_id: "property-1",
    property_name: "Aashiyana PG",
    room_id: "room-1",
    room_number: "P5-101",
    floor: 2,
    bed_id: "bed-1",
    bed_label: "A",
    sharing: "double",
    monthly_rent_paise: 1200000,
    security_deposit_paise: 1200000,
    notice_period_days: 30,
    lock_in_months: 3,
    expected_move_in_date: "2026-07-01",
    move_in_date: "2026-07-01",
    food_plan: null,
    operator_contact: {
      user_id: "operator-1",
      name: "Aashiyana Ops",
      phone_e164: "+911111111111"
    },
    house_rules: {},
    assignment_status: "active",
    notice_served_date: null,
    notice_end_date: null,
    notice_days_remaining: null,
    operator_move_out_request_id: null
  };
}

describe("PgResidenceClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("offers the tenant's own bed, room, and floor when raising maintenance", () => {
    render(
      <ToastProvider>
        <PgResidenceClient
          initialResidence={activeResidence()}
          initialMaintenance={[]}
          maintenanceLoadError={null}
          maintenanceHistoryEnabled
          token="token-1"
        />
      </ToastProvider>
    );

    const location = screen.getByRole("combobox", { name: "Location" });

    expect(within(location).getByRole("option", { name: "My bed" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "My room" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "Floor 2" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "Common area" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "Property wide" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "Other" })).toBeInTheDocument();
  });
});
