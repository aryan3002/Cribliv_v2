import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgRoom } from "@cribliv/shared-types";
import PgBedGrid from "../PgBedGrid";

const { updateBedStatus, relistBed, refresh } = vi.hoisted(() => ({
  updateBedStatus: vi.fn(),
  relistBed: vi.fn(),
  refresh: vi.fn()
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/pg-operations-api", () => ({ updateBedStatus, relistBed }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/ui/toast/use-toast", () => ({ useToast: () => toast }));

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

  it("renders a vacant bed with one Assign action and secondary actions in the overflow menu", () => {
    render(
      <PgBedGrid
        propertyId="property-1"
        token="token-1"
        rooms={rooms}
        assignmentHrefBase="/assign"
        bedDetailHrefBase="/beds"
      />
    );

    const bed = screen.getByText("Bed B").closest("article")!;
    expect(within(bed).getByRole("link", { name: "Assign" })).toBeInTheDocument();
    expect(within(bed).queryByRole("button", { name: /Block Bed B/ })).not.toBeInTheDocument();
    fireEvent.click(within(bed).getByRole("button", { name: "More actions for Bed B" }));

    expect(screen.getByRole("menu")).toHaveTextContent("Block");
    expect(screen.getByRole("menu")).toHaveTextContent("Bed record");
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

  it("renders a blocked bed with Relist primary action and Bed record in its overflow menu", async () => {
    relistBed.mockResolvedValue({ ...rooms[0].beds[0], status: "vacant" });
    render(
      <PgBedGrid propertyId="property-1" token="token-1" rooms={rooms} bedDetailHrefBase="/beds" />
    );

    const bed = screen.getByText("Bed A").closest("article")!;
    fireEvent.click(within(bed).getByRole("button", { name: "Relist Bed A" }));

    await waitFor(() => expect(relistBed).toHaveBeenCalledWith("property-1", "bed-a", "token-1"));
    expect(refresh).toHaveBeenCalledTimes(1);
    fireEvent.click(within(bed).getByRole("button", { name: "More actions for Bed A" }));
    expect(screen.getByRole("menu")).toHaveTextContent("Bed record");
  });

  it("does not render an empty overflow menu for a blocked bed without a record URL", () => {
    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={rooms} />);

    const bed = screen.getByText("Bed A").closest("article")!;
    expect(
      within(bed).queryByRole("button", { name: "More actions for Bed A" })
    ).not.toBeInTheDocument();
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

  it("renders Manage for occupied beds and keeps reserved beds non-mutating", () => {
    const assignedRooms: PgRoom[] = [
      {
        ...rooms[0],
        beds: [
          { ...rooms[0].beds[0], id: "bed-reserved", bed_label: "R", status: "reserved" },
          {
            ...rooms[0].beds[1],
            id: "bed-occupied",
            bed_label: "O",
            status: "occupied",
            metadata: { occupant_name: "Asha" }
          }
        ]
      }
    ];

    render(
      <PgBedGrid
        propertyId="property-1"
        token="token-1"
        rooms={assignedRooms}
        assignmentHrefBase="/assign"
      />
    );

    expect(screen.queryByRole("button", { name: "Block Bed R" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Relist Bed R" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Block Bed O" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Relist Bed O" })).not.toBeInTheDocument();
    expect(
      within(screen.getByText("Bed O").closest("article")!).getByRole("link", { name: "Manage" })
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Bed O").closest("article")!).getByText("Asha")
    ).toBeInTheDocument();
  });

  it("normalizes room labels and omits vacant context without an available date", () => {
    const vacantWithoutDate: PgRoom[] = [
      {
        ...rooms[0],
        beds: [{ ...rooms[0].beds[1], available_from: null }]
      }
    ];
    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={vacantWithoutDate} />);

    expect(screen.getByText("Room 101")).toBeInTheDocument();
    expect(screen.queryByText("101", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("No available date")).not.toBeInTheDocument();
  });

  it("optimistically blocks a bed, then rolls back and exposes Retry when the API fails", async () => {
    let rejectStatusUpdate!: (error: Error) => void;
    updateBedStatus.mockImplementation(
      () => new Promise((_, reject) => (rejectStatusUpdate = reject))
    );
    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={rooms} />);

    const bed = screen.getByText("Bed B").closest("article")!;
    fireEvent.click(within(bed).getByRole("button", { name: "Block Bed B" }));

    expect(bed).toHaveAttribute("data-status", "blocked");
    rejectStatusUpdate(new Error("Network unavailable"));

    await waitFor(() => expect(bed).toHaveAttribute("data-status", "vacant"));
    expect(toast.error).toHaveBeenCalledWith(
      "Could not block Bed B.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
    );

    updateBedStatus.mockResolvedValue({ ...rooms[0].beds[1], status: "blocked" });
    const retry = toast.error.mock.calls[0][1].action.onClick;
    await act(async () => {
      retry();
    });

    await waitFor(() => expect(updateBedStatus).toHaveBeenCalledTimes(2));
  });

  it("optimistically relists a blocked bed and confirms the specific toast", async () => {
    let resolveRelist!: (bed: (typeof rooms)[number]["beds"][number]) => void;
    relistBed.mockImplementation(() => new Promise((resolve) => (resolveRelist = resolve)));
    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={rooms} />);

    const bed = screen.getByText("Bed A").closest("article")!;
    fireEvent.click(within(bed).getByRole("button", { name: "Relist Bed A" }));
    expect(bed).toHaveAttribute("data-status", "vacant");

    resolveRelist({ ...rooms[0].beds[0], status: "vacant" });

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Bed A relisted"));
  });

  it("rolls back a failed relist and retries the mutation", async () => {
    let rejectRelist!: (error: Error) => void;
    relistBed.mockImplementation(() => new Promise((_, reject) => (rejectRelist = reject)));
    render(<PgBedGrid propertyId="property-1" token="token-1" rooms={rooms} />);

    const bed = screen.getByText("Bed A").closest("article")!;
    fireEvent.click(within(bed).getByRole("button", { name: "Relist Bed A" }));
    expect(bed).toHaveAttribute("data-status", "vacant");

    rejectRelist(new Error("Network unavailable"));

    await waitFor(() => expect(bed).toHaveAttribute("data-status", "blocked"));
    expect(toast.error).toHaveBeenCalledWith(
      "Could not relist Bed A.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Retry" }) })
    );

    relistBed.mockResolvedValue({ ...rooms[0].beds[0], status: "vacant" });
    const retry = toast.error.mock.calls[0][1].action.onClick;
    await act(async () => {
      retry();
    });

    await waitFor(() => expect(relistBed).toHaveBeenCalledTimes(2));
  });
});
