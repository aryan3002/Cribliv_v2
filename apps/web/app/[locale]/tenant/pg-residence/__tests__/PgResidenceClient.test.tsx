import { fireEvent, render, screen, within } from "@testing-library/react";
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

function residence(overrides: Partial<PgTenantResidence> = {}): PgTenantResidence {
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
    operator_move_out_request_id: null,
    ...overrides
  };
}

function renderResidence(initialResidence = residence()) {
  return render(
    <ToastProvider>
      <PgResidenceClient
        initialResidence={initialResidence}
        initialMaintenance={[]}
        maintenanceLoadError={null}
        maintenanceHistoryEnabled
        token="token-1"
      />
    </ToastProvider>
  );
}

describe("PgResidenceClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the stay overview as the default active tab", () => {
    renderResidence();

    const overviewTab = screen.getByRole("tab", { name: "Overview" });
    const maintenancePanel = document.getElementById("residence-panel-maintenance");

    expect(overviewTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeVisible();
    expect(maintenancePanel).not.toBeVisible();
  });

  it("resyncs residence details when refreshed server props arrive", () => {
    const { rerender } = renderResidence();

    rerender(
      <ToastProvider>
        <PgResidenceClient
          initialResidence={residence({ property_name: "Refreshed PG" })}
          initialMaintenance={[]}
          maintenanceLoadError={null}
          maintenanceHistoryEnabled
          token="token-1"
        />
      </ToastProvider>
    );

    // property_name renders in two places (header + overview list), so use getAllByText.
    expect(screen.getAllByText(/Refreshed PG/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Aashiyana PG/)).not.toBeInTheDocument();
  });

  it("renders the residence tabs in their required order", () => {
    renderResidence();

    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Overview",
      "Money",
      "Food & Rules",
      "Notice",
      "Maintenance"
    ]);
    for (const tab of tabs) {
      expect(tab).toHaveAttribute("aria-controls");
    }
  });

  it("keeps every tab panel mounted with a valid tab relationship", () => {
    renderResidence();

    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    const panels = screen.getAllByRole("tabpanel", { hidden: true });

    expect(panels).toHaveLength(5);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");

      expect(panel).toHaveAttribute("role", "tabpanel");
      expect(panel).toHaveAttribute("aria-labelledby", tab.id);
    }
    expect(screen.getByRole("tabpanel", { name: "Overview" })).toBeVisible();
    expect(document.getElementById("residence-panel-maintenance")).not.toBeVisible();
  });

  it("reveals the maintenance form and ticket list only after selecting Maintenance", () => {
    renderResidence();

    fireEvent.click(screen.getByRole("tab", { name: "Maintenance" }));

    expect(screen.getByRole("tabpanel", { name: "Maintenance" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Raise a maintenance ticket" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tickets" })).toBeVisible();

    const location = screen.getByRole("combobox", { name: "Location" });

    expect(within(location).getByRole("option", { name: "My bed" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "My room" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "Floor 2" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "Common area" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "Property wide" })).toBeInTheDocument();
    expect(within(location).getByRole("option", { name: "Other" })).toBeInTheDocument();
  });

  it("preserves maintenance form state while switching tabs", () => {
    renderResidence();

    fireEvent.click(screen.getByRole("tab", { name: "Maintenance" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Description" }), {
      target: { value: "The bathroom tap is leaking." }
    });

    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    fireEvent.click(screen.getByRole("tab", { name: "Maintenance" }));

    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "The bathroom tap is leaking."
    );
  });

  it("keeps notice actions available only for active assignments", () => {
    const { unmount } = renderResidence();

    fireEvent.click(screen.getByRole("tab", { name: "Notice" }));
    expect(screen.getByRole("button", { name: "Serve notice" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Request move-out" })).toBeEnabled();

    unmount();
    renderResidence(residence({ assignment_status: "reserved" }));
    fireEvent.click(screen.getByRole("tab", { name: "Notice" }));

    expect(screen.getByRole("button", { name: "Serve notice" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Request move-out" })).toBeDisabled();
  });

  it("shows property, room, bed, rent, status, and operator contact in the overview", () => {
    renderResidence();

    const overview = screen.getByRole("tabpanel", { name: "Overview" });

    expect(within(overview).getByText("Aashiyana PG")).toBeVisible();
    expect(within(overview).getByText("P5-101")).toBeVisible();
    expect(within(overview).getByText("A")).toBeVisible();
    expect(within(overview).getByText("₹12,000")).toBeVisible();
    expect(within(overview).getByText("active", { exact: false })).toBeVisible();
    expect(within(overview).getByText("Aashiyana Ops")).toBeVisible();
    expect(within(overview).getByText("+911111111111")).toBeVisible();
  });

  it("renders past-stay maintenance in the redesigned history panel", () => {
    render(
      <ToastProvider>
        <PgResidenceClient
          initialResidence={null}
          initialMaintenance={[]}
          maintenanceLoadError={null}
          maintenanceHistoryEnabled
          token="token-1"
        />
      </ToastProvider>
    );

    const history = screen.getByRole("region", { name: "Past-stay maintenance" });

    expect(history).toBeVisible();
    expect(
      within(history).getByText(
        "Past stay maintenance is available for recent stays only. No historical tickets are available."
      )
    ).toBeVisible();
  });
});
