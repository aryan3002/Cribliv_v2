import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgBedAssignment, PgRoom } from "@cribliv/shared-types";

const mocks = vi.hoisted(() => ({
  cancelAssignmentMoveOut: vi.fn(),
  confirmAssignmentMoveOut: vi.fn(),
  moveInBed: vi.fn(),
  moveOutAssignmentNow: vi.fn(),
  operatorMoveOutRequest: vi.fn(),
  reserveBed: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/pg-operations-api", () => ({
  cancelAssignmentMoveOut: mocks.cancelAssignmentMoveOut,
  confirmAssignmentMoveOut: mocks.confirmAssignmentMoveOut,
  moveInBed: mocks.moveInBed,
  moveOutAssignmentNow: mocks.moveOutAssignmentNow,
  operatorMoveOutRequest: mocks.operatorMoveOutRequest,
  reserveBed: mocks.reserveBed
}));

import PgAssignmentDrawer from "../PgAssignmentDrawer";

const rooms: PgRoom[] = [
  {
    id: "room-1",
    pg_property_id: "property-1",
    room_type_id: null,
    floor: 1,
    room_number: "101",
    display_label: "Room 101",
    bed_count: 2,
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    beds: [
      {
        id: "bed-a",
        room_id: "room-1",
        bed_label: "A",
        status: "occupied",
        available_from: null,
        sort_order: 1,
        metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "bed-b",
        room_id: "room-1",
        bed_label: "B",
        status: "reserved",
        available_from: null,
        sort_order: 2,
        metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      }
    ]
  }
];

const assignment = (
  id: string,
  bedId: string,
  status: PgBedAssignment["status"],
  overrides: Partial<PgBedAssignment> = {}
): PgBedAssignment => ({
  id,
  pg_property_id: "property-1",
  bed_id: bedId,
  tenant_user_id: null,
  occupant_name: id === "assignment-a" ? "Asha" : "Bina",
  occupant_phone_e164: "+919999999902",
  occupant_gender: null,
  emergency_contact: null,
  status,
  expected_move_in_date: status === "reserved" ? "2026-02-15" : null,
  move_in_date: status === "reserved" ? null : "2026-01-01",
  notice_served_date: null,
  notice_end_date: null,
  move_out_date: null,
  monthly_rent_paise: status === "reserved" ? 1250000 : null,
  security_deposit_paise: status === "reserved" ? 2500000 : null,
  operator_notes: status === "reserved" ? "Arrives after 8 PM" : null,
  created_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides
});

describe("PgAssignmentDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelAssignmentMoveOut.mockResolvedValue(assignment("assignment-b", "bed-b", "active"));
    mocks.moveOutAssignmentNow.mockResolvedValue(assignment("assignment-a", "bed-a", "moved_out"));
  });

  it("selects the assignment matching the quick-action bed and can cancel pending move-out", async () => {
    render(
      <PgAssignmentDrawer
        propertyId="property-1"
        token="token-1"
        rooms={rooms}
        assignments={[
          assignment("assignment-a", "bed-a", "active"),
          assignment("assignment-b", "bed-b", "move_out_pending_confirmation")
        ]}
        initialBedId="bed-b"
      />
    );

    expect(
      screen.getByText(/Bina is currently move out pending confirmation/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /cancel move-out/i }));

    await waitFor(() =>
      expect(mocks.cancelAssignmentMoveOut).toHaveBeenCalledWith(
        "property-1",
        "assignment-b",
        "token-1"
      )
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("selecting a reserved assignment opens move-in mode with that tenant's saved details", () => {
    render(
      <PgAssignmentDrawer
        propertyId="property-1"
        token="token-1"
        rooms={rooms}
        assignments={[
          assignment("assignment-a", "bed-a", "active"),
          assignment("assignment-b", "bed-b", "reserved")
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Bina/i }));

    const moveInTab = screen
      .getAllByRole("button", { name: "Move in" })
      .find((button) => button.hasAttribute("aria-pressed"));
    expect(moveInTab).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Bed")).toHaveValue("bed-b");
    expect(screen.getByLabelText("Name")).toHaveValue("Bina");
    expect(screen.getByLabelText("Phone")).toHaveValue("+919999999902");
    expect(screen.getByLabelText("Move-in date")).toHaveValue("2026-02-15");
    expect(screen.getByLabelText("Monthly rent (paise)")).toHaveValue("1250000");
    expect(screen.getByLabelText("Deposit (paise)")).toHaveValue("2500000");
    expect(screen.getByLabelText("Notes")).toHaveValue("Arrives after 8 PM");
    expect(screen.getByRole("button", { name: /confirm move-in/i })).toBeEnabled();
  });

  it("confirms a reserved tenant move-in with the selected assignment details", async () => {
    mocks.moveInBed.mockResolvedValue(assignment("assignment-b", "bed-b", "active"));

    render(
      <PgAssignmentDrawer
        propertyId="property-1"
        token="token-1"
        rooms={rooms}
        assignments={[
          assignment("assignment-a", "bed-a", "active"),
          assignment("assignment-b", "bed-b", "reserved")
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Bina/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm move-in/i }));

    await waitFor(() =>
      expect(mocks.moveInBed).toHaveBeenCalledWith(
        "property-1",
        "bed-b",
        {
          occupant_name: "Bina",
          occupant_phone_e164: "+919999999902",
          expected_move_in_date: "2026-02-15",
          move_in_date: "2026-02-15",
          monthly_rent_paise: 1250000,
          security_deposit_paise: 2500000,
          operator_notes: "Arrives after 8 PM"
        },
        "token-1",
        expect.stringMatching(/^move-in-/)
      )
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("shows an active assignment as moved in and lets the operator move it out directly", async () => {
    render(
      <PgAssignmentDrawer
        propertyId="property-1"
        token="token-1"
        rooms={rooms}
        assignments={[assignment("assignment-a", "bed-a", "active")]}
        bedDetailBase="/en/pg-operator/properties/property-1/beds"
      />
    );

    expect(screen.getByText(/Asha is currently moved in on 101 \/ Bed A/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open bed record/i })).toHaveAttribute(
      "href",
      "/en/pg-operator/properties/property-1/beds/bed-a"
    );

    fireEvent.click(screen.getByRole("button", { name: /^move out$/i }));

    await waitFor(() =>
      expect(mocks.moveOutAssignmentNow).toHaveBeenCalledWith(
        "property-1",
        "assignment-a",
        "token-1"
      )
    );
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
