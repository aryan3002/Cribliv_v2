import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PgMaintenanceAnalytics,
  PgMaintenanceCategory,
  PgMaintenanceQueuePage,
  PgMaintenanceRequest
} from "@cribliv/shared-types";

const { listPropertyMaintenance } = vi.hoisted(() => ({
  listPropertyMaintenance: vi.fn()
}));

vi.mock("@/lib/pg-operations-api", () => ({
  listPropertyMaintenance
}));

import MaintenanceQueueList from "../MaintenanceQueueList";

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
  }
];

const analytics: PgMaintenanceAnalytics = {
  open: 3,
  overdue: 1,
  due_today: 2,
  waiting_on_tenant: 1,
  resolved_pending_close: 4,
  closed_this_month: 7,
  by_category: [{ category_slug: "plumbing", display_name: "Plumbing", count: 2 }]
};

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

function page(
  rows: PgMaintenanceRequest[],
  nextCursor: string | null = null
): PgMaintenanceQueuePage {
  return { rows, next_cursor: nextCursor };
}

function setup(initialPage: PgMaintenanceQueuePage = page([ticket()], "cursor-page-2")) {
  render(
    <MaintenanceQueueList
      propertyId="property-1"
      token="token-1"
      categories={categories}
      analytics={analytics}
      initialPage={initialPage}
    />
  );
}

describe("MaintenanceQueueList", () => {
  beforeEach(() => {
    listPropertyMaintenance.mockReset();
  });

  it("renders analytics, default sort, and dense queue row details", () => {
    setup();

    expect(screen.getByText("3 open")).toBeInTheDocument();
    expect(screen.getByText("1 overdue")).toBeInTheDocument();
    expect(screen.getByText("2 due today")).toBeInTheDocument();
    expect(screen.getByText("1 waiting")).toBeInTheDocument();
    expect(screen.getByText("4 resolved")).toBeInTheDocument();
    expect(screen.getByText("7 closed this month")).toBeInTheDocument();
    expect(screen.getByLabelText("Sort")).toHaveDisplayValue("SLA due first");

    const row = screen.getByRole("row", { name: /Plumbing/i });
    expect(within(row).getByText("Due 15 Jul, 09:00 am")).toBeInTheDocument();
    expect(within(row).getByText("High")).toBeInTheDocument();
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(within(row).getByText("Plumbing")).toBeInTheDocument();
    expect(within(row).getByText("Room P5-101 · Bed A")).toBeInTheDocument();
    expect(within(row).getByText("P5 Tenant 1")).toBeInTheDocument();
    expect(within(row).getByText("Updated 14 Jul, 10:30 am")).toBeInTheDocument();
  });

  it("calls listPropertyMaintenance with chosen filters and resets pagination", async () => {
    listPropertyMaintenance.mockResolvedValue(
      page([ticket({ id: "ticket-2", priority: "emergency" })])
    );
    setup();

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "in_progress" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "emergency" } });
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "electrical" } });
    fireEvent.change(screen.getByLabelText("SLA"), { target: { value: "overdue" } });
    fireEvent.change(screen.getByLabelText("Tenant"), { target: { value: "riya" } });

    await waitFor(() =>
      expect(listPropertyMaintenance).toHaveBeenLastCalledWith("property-1", "token-1", {
        status: "in_progress",
        priority: "emergency",
        category_slug: "electrical",
        sla_state: "overdue",
        tenant_query: "riya",
        sort: "sla_due",
        view: "list",
        limit: 25
      })
    );
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("loads the next PgMaintenanceQueuePage with the prior next_cursor and appends rows", async () => {
    listPropertyMaintenance.mockResolvedValueOnce(
      page(
        [
          ticket({
            id: "ticket-2",
            category: "Electrical",
            category_slug: "electrical",
            category_label_snapshot: "Electrical",
            priority: "emergency",
            description: "The meter board is sparking."
          })
        ],
        null
      )
    );
    setup();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() =>
      expect(listPropertyMaintenance).toHaveBeenCalledWith("property-1", "token-1", {
        sort: "sla_due",
        view: "list",
        limit: 25,
        cursor: "cursor-page-2"
      })
    );
    expect(screen.getByRole("row", { name: /Plumbing/i })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Electrical/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });
});
