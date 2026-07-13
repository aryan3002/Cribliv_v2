import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((destination: string) => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
  getManagedProperty: vi.fn(),
  getOccupancySummary: vi.fn(),
  getPropertyInventory: vi.fn(),
  getPropertyLayout: vi.fn()
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ refresh: vi.fn() })
}));
vi.mock("@/lib/pg-operations-api", () => ({
  getManagedProperty: mocks.getManagedProperty,
  getOccupancySummary: mocks.getOccupancySummary,
  getPropertyInventory: mocks.getPropertyInventory,
  getPropertyLayout: mocks.getPropertyLayout
}));

import DashboardPage from "../page";
import LayoutPage from "../layout/page";

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

describe("PG operations route error states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { role: "pg_operator" }, accessToken: "token-1" });
    mocks.getManagedProperty.mockResolvedValue(property);
    mocks.getOccupancySummary.mockResolvedValue(summary);
    mocks.getPropertyInventory.mockResolvedValue([]);
    mocks.getPropertyLayout.mockResolvedValue([]);
  });

  it("loads dashboard beds from the inventory read path", async () => {
    await DashboardPage({ params: { locale: "en", propertyId: "property-1" } });

    expect(mocks.getPropertyInventory).toHaveBeenCalledWith("property-1", "token-1");
    expect(mocks.getPropertyLayout).not.toHaveBeenCalled();
  });

  it("renders a dashboard error instead of fabricated occupancy data", async () => {
    mocks.getOccupancySummary.mockRejectedValue(new Error("API unavailable"));

    render(await DashboardPage({ params: { locale: "en", propertyId: "property-1" } }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.queryByLabelText("Occupancy summary")).not.toBeInTheDocument();
  });

  it("renders a disabled layout builder when the layout fetch fails", async () => {
    mocks.getPropertyLayout.mockRejectedValue(new Error("API unavailable"));

    render(await LayoutPage({ params: { locale: "en", propertyId: "property-1" } }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.getByRole("button", { name: /save layout/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /add room/i })).toBeDisabled();
  });

  it("renders a layout error without showing the builder when the property fetch fails", async () => {
    mocks.getManagedProperty.mockRejectedValue(new Error("API unavailable"));

    render(await LayoutPage({ params: { locale: "en", propertyId: "property-1" } }));

    expect(screen.getByRole("alert")).toHaveTextContent(/could not load/i);
    expect(screen.queryByRole("button", { name: /save layout/i })).not.toBeInTheDocument();
  });
});
