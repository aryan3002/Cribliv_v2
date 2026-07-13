import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgBedAssignment, PgRoom } from "@cribliv/shared-types";

const mocks = vi.hoisted(() => ({
  cancelAssignmentMoveOut: vi.fn(),
  confirmAssignmentMoveOut: vi.fn(),
  moveInBed: vi.fn(),
  operatorMoveOutRequest: vi.fn(),
  reserveBed: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/pg-operations-api", () => ({
  cancelAssignmentMoveOut: mocks.cancelAssignmentMoveOut,
  confirmAssignmentMoveOut: mocks.confirmAssignmentMoveOut,
  moveInBed: mocks.moveInBed,
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
        status: "vacant",
        available_from: null,
        sort_order: 2,
        metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z"
      }
    ]
  }
];

const assignment = (id: string, bedId: string, status: PgBedAssignment["status"]) => ({
  id,
  pg_property_id: "property-1",
  bed_id: bedId,
  tenant_user_id: null,
  occupant_name: id === "assignment-a" ? "Asha" : "Bina",
  occupant_phone_e164: "+919999999902",
  occupant_gender: null,
  emergency_contact: null,
  status,
  expected_move_in_date: null,
  move_in_date: "2026-01-01",
  notice_served_date: null,
  notice_end_date: null,
  move_out_date: null,
  monthly_rent_paise: null,
  security_deposit_paise: null,
  operator_notes: null,
  created_by: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z"
});

describe("PgAssignmentDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelAssignmentMoveOut.mockResolvedValue(assignment("assignment-b", "bed-b", "active"));
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
});
