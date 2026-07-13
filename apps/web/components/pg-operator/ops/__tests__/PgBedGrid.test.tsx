import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgRoom } from "@cribliv/shared-types";
import PgBedGrid from "../PgBedGrid";

const { updateBedStatus, relistBed, refresh } = vi.hoisted(() => ({
  updateBedStatus: vi.fn(),
  relistBed: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("@/lib/pg-operations-api", () => ({ updateBedStatus, relistBed }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const rooms: PgRoom[] = [
  {
    id: "room-101",
    pg_property_id: "property-1",
    room_type_id: "type-1",
    floor: 1,
    room_number: "101",
    display_label: null,
    bed_count: 2,
    status: "active",
    created_at: "2026-07-13T00:00:00.000Z",
    updated_at: "2026-07-13T00:00:00.000Z",
    beds: [
      {
        id: "bed-a",
        room_id: "room-101",
        bed_label: "A",
        status: "blocked",
        available_from: null,
        sort_order: 1,
        metadata: {},
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z"
      },
      {
        id: "bed-b",
        room_id: "room-101",
        bed_label: "B",
        status: "vacant",
        available_from: "2026-07-20",
        sort_order: 2,
        metadata: {},
        created_at: "2026-07-13T00:00:00.000Z",
        updated_at: "2026-07-13T00:00:00.000Z"
      }
    ]
  }
];

describe("PgBedGrid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders floor inventory and updates a blocked bed to vacant", async () => {
    updateBedStatus.mockResolvedValue({ ...rooms[0].beds[0], status: "vacant" });
    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={rooms} />);

    expect(screen.getByLabelText("Floor 1")).toBeInTheDocument();
    expect(screen.getByText("Bed A")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark Bed A vacant" }));

    await waitFor(() =>
      expect(updateBedStatus).toHaveBeenCalledWith("property-1", "bed-a", "vacant", "token-1")
    );
    expect(await screen.findByRole("button", { name: "Block Bed A" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("renders beds whose room has no assigned floor", () => {
    const unassignedRoom: PgRoom = {
      ...rooms[0],
      id: "room-unassigned",
      floor: null,
      room_number: "G01",
      beds: rooms[0].beds.map((bed) => ({
        ...bed,
        id: `${bed.id}-unassigned`,
        room_id: "room-unassigned"
      }))
    };

    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={[unassignedRoom]} />);

    expect(screen.getByLabelText("Unassigned floor")).toBeInTheDocument();
    expect(screen.getByText("Bed A")).toBeInTheDocument();
  });

  it("refreshes occupancy data after relisting a bed", async () => {
    relistBed.mockResolvedValue({ ...rooms[0].beds[0], status: "vacant" });
    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={rooms} />);

    fireEvent.click(screen.getByRole("button", { name: "Relist Bed A" }));

    await waitFor(() => expect(relistBed).toHaveBeenCalledWith("property-1", "bed-a", "token-1"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("offers inactive as a status filter", () => {
    const inactiveRooms: PgRoom[] = [
      {
        ...rooms[0],
        beds: [
          {
            ...rooms[0].beds[0],
            status: "inactive"
          }
        ]
      }
    ];
    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={inactiveRooms} />);

    fireEvent.click(screen.getByRole("button", { name: "Inactive" }));

    expect(screen.getByText("Bed A")).toBeInTheDocument();
    expect(screen.getByText("Bed A").closest('[data-status="inactive"]')).toBeInTheDocument();
  });

  it("hides manual actions for reserved and occupied beds", () => {
    const assignedRooms: PgRoom[] = [
      {
        ...rooms[0],
        beds: [
          { ...rooms[0].beds[0], id: "bed-reserved", bed_label: "R", status: "reserved" },
          { ...rooms[0].beds[1], id: "bed-occupied", bed_label: "O", status: "occupied" }
        ]
      }
    ];

    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={assignedRooms} />);

    expect(screen.queryByRole("button", { name: "Block Bed R" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Relist Bed R" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Block Bed O" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Relist Bed O" })).not.toBeInTheDocument();
  });
});
