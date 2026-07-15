"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { PgBed, PgBedStatus, PgRoom } from "@cribliv/shared-types";
import { useToast } from "@/components/ui/toast/use-toast";
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
  rooms,
  assignmentHrefBase,
  bedDetailHrefBase
}: {
  propertyId: string;
  token?: string;
  rooms: PgRoom[];
  assignmentHrefBase?: string;
  bedDetailHrefBase?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [currentRooms, setCurrentRooms] = useState(rooms);
  const [floor, setFloor] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pendingBedId, setPendingBedId] = useState<string | null>(null);

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
    const optimisticBed = { ...bed, status: nextStatus };
    setPendingBedId(bed.id);
    replaceBed(optimisticBed);
    try {
      replaceBed(await updateBedStatus(propertyId, bed.id, nextStatus, token));
      toast.success(`Bed ${bed.bed_label} ${nextStatus === "blocked" ? "blocked" : "unblocked"}`);
      router.refresh();
    } catch {
      replaceBed(bed);
      const action = nextStatus === "blocked" ? "block" : "unblock";
      toast.error(`Could not ${action} Bed ${bed.bed_label}.`, {
        action: { label: "Retry", onClick: () => void changeStatus(bed, nextStatus) }
      });
    } finally {
      setPendingBedId(null);
    }
  }

  async function relist(bed: PgBed) {
    const optimisticBed = { ...bed, status: "vacant" as const };
    setPendingBedId(bed.id);
    replaceBed(optimisticBed);
    try {
      replaceBed(await relistBed(propertyId, bed.id, token));
      toast.success(`Bed ${bed.bed_label} relisted`);
      router.refresh();
    } catch {
      replaceBed(bed);
      toast.error(`Could not relist Bed ${bed.bed_label}.`, {
        action: { label: "Retry", onClick: () => void relist(bed) }
      });
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
                          <strong>{room.display_label || `Room ${room.room_number}`}</strong>
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
                              assignmentHref={
                                assignmentHrefBase
                                  ? `${assignmentHrefBase}?bedId=${encodeURIComponent(
                                      bed.id
                                    )}&mode=${bed.status === "reserved" ? "move-in" : "reserve"}`
                                  : undefined
                              }
                              detailHref={
                                bedDetailHrefBase
                                  ? `${bedDetailHrefBase}/${encodeURIComponent(bed.id)}`
                                  : undefined
                              }
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
