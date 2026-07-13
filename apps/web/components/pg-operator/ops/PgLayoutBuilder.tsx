"use client";

import { useMemo, useState } from "react";
import { Button, Badge } from "@cribliv/ui";
import { Minus, Plus, Save } from "lucide-react";
import type { PgLayoutRoomInput, PgRoom } from "@cribliv/shared-types";
import SectionCard from "@/components/pg-operator/wizard/shared/SectionCard";
import { generateLayoutDraft, savePropertyLayout } from "@/lib/pg-operations-api";
import styles from "./PgLayoutBuilder.module.css";

export type RoomTypeOption = { id: string; label: string };

function nextBedLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `B${index + 1}`;
}

function inputRoom(room: PgRoom): PgLayoutRoomInput {
  return {
    id: room.id,
    room_type_id: room.room_type_id,
    floor: room.floor,
    room_number: room.room_number,
    display_label: room.display_label,
    bed_count: room.beds.length,
    beds: room.beds.map((bed, index) => ({
      id: bed.id,
      bed_label: bed.bed_label,
      status: bed.status,
      available_from: bed.available_from,
      sort_order: bed.sort_order ?? index + 1,
      metadata: bed.metadata
    }))
  };
}

function blankRoom(index: number, floor: number, roomTypeId?: string): PgLayoutRoomInput {
  return {
    room_type_id: roomTypeId ?? null,
    floor,
    room_number: `${floor}${String(index + 1).padStart(2, "0")}`,
    display_label: null,
    bed_count: 1,
    beds: [{ bed_label: "A", status: "vacant", sort_order: 1, metadata: {} }]
  };
}

function generatedRoomNumber(floor: number | null | undefined, sequence: number): string {
  return floor == null
    ? `R${String(sequence).padStart(3, "0")}`
    : `${floor}${String(sequence).padStart(2, "0")}`;
}

function appendGeneratedRooms(
  current: PgLayoutRoomInput[],
  generated: PgLayoutRoomInput[]
): PgLayoutRoomInput[] {
  const usedNumbers = new Set(current.map((room) => room.room_number.trim()));
  const additions = generated.map((room) => {
    const originalNumber = room.room_number.trim();
    let roomNumber = originalNumber;
    if (usedNumbers.has(roomNumber)) {
      let sequence = 1;
      do {
        roomNumber = generatedRoomNumber(room.floor, sequence);
        sequence += 1;
      } while (usedNumbers.has(roomNumber));
    }
    usedNumbers.add(roomNumber);
    return {
      ...room,
      room_number: roomNumber,
      display_label:
        room.display_label === `Room ${originalNumber}` ? `Room ${roomNumber}` : room.display_label
    };
  });
  return [...current, ...additions];
}

export default function PgLayoutBuilder({
  propertyId,
  token,
  layoutStatus,
  initialRooms,
  roomTypeOptions,
  loadError
}: {
  propertyId: string;
  token?: string;
  layoutStatus: "needs_setup" | "ready";
  initialRooms?: PgRoom[];
  roomTypeOptions: RoomTypeOption[];
  loadError?: string;
}) {
  const [rooms, setRooms] = useState<PgLayoutRoomInput[]>(() =>
    (initialRooms ?? []).map(inputRoom)
  );
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState(roomTypeOptions[0]?.id ?? "");
  const [count, setCount] = useState(1);
  const [floor, setFloor] = useState(1);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const canGenerate = Boolean(selectedRoomTypeId);
  const roomTypeLabel = useMemo(
    () => roomTypeOptions.find((option) => option.id === selectedRoomTypeId)?.label,
    [roomTypeOptions, selectedRoomTypeId]
  );

  if (loadError) {
    return (
      <div className={styles.builder}>
        <section role="alert" className={styles.loadError}>
          <h2>{loadError}</h2>
          <p>Editing is disabled so existing rooms and beds cannot be overwritten.</p>
        </section>
        <div className={styles.disabledActions}>
          <Button type="button" variant="tertiary" disabled>
            <Plus size={15} aria-hidden="true" /> Add room
          </Button>
          <Button type="button" disabled>
            <Save size={16} aria-hidden="true" /> Save layout
          </Button>
        </div>
      </div>
    );
  }

  function patchRoom(index: number, patch: Partial<PgLayoutRoomInput>) {
    setRooms((previous) =>
      previous.map((room, roomIndex) => (roomIndex === index ? { ...room, ...patch } : room))
    );
  }

  function updateBedCount(index: number, requested: number) {
    const bedCount = Math.max(1, Math.min(24, requested || 1));
    setRooms((previous) =>
      previous.map((room, roomIndex) => {
        if (roomIndex !== index) return room;
        const beds = Array.from(
          { length: bedCount },
          (_, bedIndex) =>
            room.beds[bedIndex] ?? {
              bed_label: nextBedLabel(bedIndex),
              status: "vacant" as const,
              sort_order: bedIndex + 1,
              metadata: {}
            }
        );
        return { ...room, bed_count: bedCount, beds };
      })
    );
  }

  function patchBed(roomIndex: number, bedIndex: number, bedLabel: string) {
    setRooms((previous) =>
      previous.map((room, index) =>
        index !== roomIndex
          ? room
          : {
              ...room,
              beds: room.beds.map((bed, currentIndex) =>
                currentIndex === bedIndex ? { ...bed, bed_label: bedLabel } : bed
              )
            }
      )
    );
  }

  async function generate() {
    if (!selectedRoomTypeId) return;
    setGenerating(true);
    setMessage(null);
    try {
      const draft = await generateLayoutDraft(
        propertyId,
        [{ room_type_id: selectedRoomTypeId, count, floor }],
        token
      );
      setRooms((previous) => appendGeneratedRooms(previous, draft.rooms));
      setMessage(
        `Draft created from ${roomTypeLabel ?? "the selected room type"}. Review it before saving.`
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not generate the layout draft.");
    } finally {
      setGenerating(false);
    }
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const saved = await savePropertyLayout(propertyId, { rooms }, token);
      setRooms(saved.map(inputRoom));
      setMessage("Layout saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not save the layout.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.builder}>
      {layoutStatus === "needs_setup" && rooms.length === 0 && (
        <section className={styles.setupState}>
          <div>
            <h2>Set up bed layout</h2>
            <p>
              Start with a room type when available, or add the rooms you need and review every bed
              before saving.
            </p>
          </div>
          <Badge tone="pending">Layout required</Badge>
        </section>
      )}

      <SectionCard
        title="Generate draft"
        subtitle="Create a starting group of rooms, then review every label and bed."
      >
        <div className={styles.generator}>
          <label>
            <span>Room type</span>
            <select
              value={selectedRoomTypeId}
              onChange={(event) => setSelectedRoomTypeId(event.target.value)}
            >
              <option value="">Choose a room type</option>
              {roomTypeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Rooms</span>
            <input
              type="number"
              min="1"
              max="50"
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>
          <label>
            <span>Floor</span>
            <input
              type="number"
              min="0"
              value={floor}
              onChange={(event) => setFloor(Number(event.target.value))}
            />
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={!canGenerate || generating}
            onClick={() => void generate()}
          >
            {generating ? "Generating..." : "Generate draft"}
          </Button>
        </div>
        {!canGenerate && (
          <p className={styles.helper}>
            No room types are configured for this property. Add them to the listing before
            generating a draft, or add rooms manually below.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Review layout"
        subtitle="Room numbers and bed labels must be unique within a property and room."
        action={
          <Button
            type="button"
            variant="tertiary"
            className={styles.addButton}
            onClick={() =>
              setRooms((previous) => [
                ...previous,
                blankRoom(previous.length, floor, selectedRoomTypeId || undefined)
              ])
            }
          >
            <Plus size={15} aria-hidden="true" /> Add room
          </Button>
        }
      >
        {rooms.length === 0 ? (
          <div className={styles.reviewEmpty}>
            No rooms yet. Generate a draft or add a room manually.
          </div>
        ) : (
          <div className={styles.roomList}>
            {rooms.map((room, roomIndex) => (
              <section className={styles.roomEditor} key={`${room.id ?? "new"}-${roomIndex}`}>
                <div className={styles.roomEditorHead}>
                  <strong>Room {roomIndex + 1}</strong>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={`Remove room ${room.room_number}`}
                    onClick={() =>
                      setRooms((previous) => previous.filter((_, index) => index !== roomIndex))
                    }
                  >
                    <Minus size={15} aria-hidden="true" />
                  </button>
                </div>
                <div className={styles.roomFields}>
                  <label>
                    <span>Floor</span>
                    <input
                      type="number"
                      value={room.floor ?? ""}
                      onChange={(event) =>
                        patchRoom(roomIndex, {
                          floor: event.target.value === "" ? null : Number(event.target.value)
                        })
                      }
                    />
                  </label>
                  <label>
                    <span>Room number</span>
                    <input
                      value={room.room_number}
                      onChange={(event) =>
                        patchRoom(roomIndex, { room_number: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>Display label</span>
                    <input
                      value={room.display_label ?? ""}
                      onChange={(event) =>
                        patchRoom(roomIndex, { display_label: event.target.value || null })
                      }
                    />
                  </label>
                  <label>
                    <span>Beds</span>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={room.bed_count}
                      onChange={(event) => updateBedCount(roomIndex, Number(event.target.value))}
                    />
                  </label>
                </div>
                <div className={styles.bedLabels}>
                  {room.beds.map((bed, bedIndex) => (
                    <label key={`${bed.id ?? "new"}-${bedIndex}`}>
                      <span>Bed {bedIndex + 1}</span>
                      <input
                        value={bed.bed_label}
                        onChange={(event) => patchBed(roomIndex, bedIndex, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </SectionCard>
      {message && (
        <p role="status" className={styles.message}>
          {message}
        </p>
      )}
      <div className={styles.saveRow}>
        <Button type="button" disabled={saving} onClick={() => void save()}>
          <Save size={16} aria-hidden="true" /> {saving ? "Saving..." : "Save layout"}
        </Button>
      </div>
    </div>
  );
}
