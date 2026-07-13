"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PgBed, PgBedStatus, PgRoom } from "@cribliv/shared-types";
import SegmentedControl from "@/components/pg-operator/wizard/shared/SegmentedControl";
import { relistBed, updateBedStatus } from "@/lib/pg-operations-api";
import PgBedChip from "./PgBedChip";
import styles from "./PgBedGrid.module.css";

type StatusFilter = "all" | PgBedStatus;

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "vacant", label: "Vacant" },
  { value: "occupied", label: "Occupied" },
  { value: "reserved", label: "Reserved" },
  { value: "blocked", label: "Blocked" },
  { value: "inactive", label: "Inactive" }
];

function sortRooms(rooms: PgRoom[]): PgRoom[] {
  return rooms
    .slice()
    .sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
}

function floorValue(floor: number | null): string {
  return floor === null ? "unassigned" : String(floor);
}

function floorLabel(floor: number | null): string {
  return floor === null ? "Unassigned floor" : `Floor ${floor}`;
}

export default function PgBedGrid({
  propertyId,
  token,
  rooms
}: {
  propertyId: string;
  token?: string;
  rooms: PgRoom[];
}) {
  const router = useRouter();
  const [currentRooms, setCurrentRooms] = useState(rooms);
  const [floor, setFloor] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pendingBedId, setPendingBedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setCurrentRooms(rooms), [rooms]);

  const floors = useMemo(() => {
    return [...new Set(currentRooms.map((room) => room.floor))].sort((a, b) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a - b;
    });
  }, [currentRooms]);

  const visibleRooms = useMemo(
    () =>
      sortRooms(currentRooms)
        .filter((room) => floor === "all" || floorValue(room.floor) === floor)
        .map((room) => ({
          ...room,
          beds: room.beds.filter((bed) => status === "all" || bed.status === status)
        }))
        .filter((room) => room.beds.length > 0),
    [currentRooms, floor, status]
  );

  function replaceBed(updated: PgBed) {
    setCurrentRooms((previous) =>
      previous.map((room) =>
        room.id === updated.room_id
          ? { ...room, beds: room.beds.map((bed) => (bed.id === updated.id ? updated : bed)) }
          : room
      )
    );
  }

  async function changeStatus(bed: PgBed, nextStatus: "blocked" | "vacant") {
    setPendingBedId(bed.id);
    setError(null);
    try {
      replaceBed(await updateBedStatus(propertyId, bed.id, nextStatus, token));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the bed status.");
    } finally {
      setPendingBedId(null);
    }
  }

  async function relist(bed: PgBed) {
    setPendingBedId(bed.id);
    setError(null);
    try {
      replaceBed(await relistBed(propertyId, bed.id, token));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not relist the bed.");
    } finally {
      setPendingBedId(null);
    }
  }

  return (
    <section className={styles.gridSection} aria-label="Bed inventory">
      <div className={styles.toolbar}>
        <label className={styles.floorField}>
          <span>Floor</span>
          <select value={floor} onChange={(event) => setFloor(event.target.value)}>
            <option value="all">All floors</option>
            {floors.map((value) => (
              <option key={floorValue(value)} value={floorValue(value)}>
                {floorLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.statusFilter}>
          <span>Status</span>
          <SegmentedControl value={status} options={STATUS_OPTIONS} onChange={setStatus} />
        </div>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {visibleRooms.length === 0 ? (
        <div className={styles.empty}>No beds match these filters.</div>
      ) : (
        <div className={styles.floorGroups}>
          {floors
            .filter((value) => floor === "all" || floorValue(value) === floor)
            .map((value) => {
              const floorRooms = visibleRooms.filter((room) => room.floor === value);
              if (floorRooms.length === 0) return null;
              return (
                <section
                  key={floorValue(value)}
                  className={styles.floorGroup}
                  aria-label={floorLabel(value)}
                >
                  <header className={styles.floorHeading}>{floorLabel(value)}</header>
                  <div className={styles.rooms}>
                    {floorRooms.map((room) => (
                      <div key={room.id} className={styles.room}>
                        <div className={styles.roomHeading}>
                          <strong>{room.display_label || room.room_number}</strong>
                          <span>{room.beds.length} beds</span>
                        </div>
                        <div className={styles.beds}>
                          {room.beds.map((bed) => (
                            <PgBedChip
                              key={bed.id}
                              bed={bed}
                              roomNumber={room.room_number}
                              pending={pendingBedId === bed.id}
                              onSetStatus={(nextStatus) => void changeStatus(bed, nextStatus)}
                              onRelist={() => void relist(bed)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
        </div>
      )}
    </section>
  );
}
