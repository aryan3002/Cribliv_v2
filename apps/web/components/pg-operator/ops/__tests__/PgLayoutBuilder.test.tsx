import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PgLayoutDraft, PgRoom } from "@cribliv/shared-types";
import PgLayoutBuilder from "../PgLayoutBuilder";

const { generateLayoutDraft, savePropertyLayout } = vi.hoisted(() => ({
  generateLayoutDraft: vi.fn(),
  savePropertyLayout: vi.fn()
}));

vi.mock("@/lib/pg-operations-api", () => ({ generateLayoutDraft, savePropertyLayout }));

const initialRoom: PgRoom = {
  id: "room-existing",
  pg_property_id: "property-1",
  room_type_id: "type-single",
  floor: 1,
  room_number: "101",
  display_label: "Room 101",
  bed_count: 1,
  status: "active",
  created_at: "2026-07-13T00:00:00.000Z",
  updated_at: "2026-07-13T00:00:00.000Z",
  beds: [
    {
      id: "bed-existing",
      room_id: "room-existing",
      bed_label: "A",
      status: "vacant",
      available_from: null,
      sort_order: 1,
      metadata: {},
      created_at: "2026-07-13T00:00:00.000Z",
      updated_at: "2026-07-13T00:00:00.000Z"
    }
  ]
};

function draft(roomTypeId: string, roomNumber: string, floor: number): PgLayoutDraft {
  return {
    property_id: "property-1",
    room_counts: [{ room_type_id: roomTypeId, count: 1, floor }],
    rooms: [
      {
        room_type_id: roomTypeId,
        floor,
        room_number: roomNumber,
        display_label: `Room ${roomNumber}`,
        bed_count: 1,
        beds: [{ bed_label: "A", status: "vacant", sort_order: 1, metadata: {} }]
      }
    ]
  };
}

const roomTypeOptions = [
  { id: "type-single", label: "Single" },
  { id: "type-double", label: "Double" }
];

describe("PgLayoutBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves existing rooms when a generated group is added", async () => {
    generateLayoutDraft.mockResolvedValue(draft("type-single", "201", 2));
    render(
      <PgLayoutBuilder
        propertyId="property-1"
        token="token-1"
        layoutStatus="ready"
        initialRooms={[initialRoom]}
        roomTypeOptions={roomTypeOptions}
      />
    );

    fireEvent.change(screen.getAllByLabelText("Floor")[0], { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    await waitFor(() => expect(screen.getAllByLabelText("Room number")).toHaveLength(2));
    expect(screen.getByDisplayValue("101")).toBeInTheDocument();
    expect(screen.getByDisplayValue("201")).toBeInTheDocument();
  });

  it("composes multiple generated groups without duplicate room numbers", async () => {
    generateLayoutDraft
      .mockResolvedValueOnce(draft("type-single", "101", 1))
      .mockResolvedValueOnce(draft("type-double", "101", 1));
    render(
      <PgLayoutBuilder
        propertyId="property-1"
        token="token-1"
        layoutStatus="needs_setup"
        initialRooms={[]}
        roomTypeOptions={roomTypeOptions}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
    await waitFor(() => expect(screen.getByDisplayValue("101")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Room type"), { target: { value: "type-double" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));

    await waitFor(() => expect(screen.getAllByLabelText("Room number")).toHaveLength(2));
    expect(screen.getByDisplayValue("101")).toBeInTheDocument();
    expect(screen.getByDisplayValue("102")).toBeInTheDocument();
  });
});
