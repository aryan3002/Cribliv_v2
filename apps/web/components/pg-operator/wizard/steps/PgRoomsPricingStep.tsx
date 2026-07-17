"use client";
import { Dispatch } from "react";
import { BedDouble, Plus } from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import RoomTypeCard, { type DraftRoom } from "../shared/RoomTypeCard";
import SectionCard from "../shared/SectionCard";
import styles from "../shared/pg-wizard.module.css";

export default function PgRoomsPricingStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
}) {
  const rooms = (state.draft.room_types ?? []) as DraftRoom[];
  // Edit by array INDEX (stable per position) via SET_FIELD — never by cellKey,
  // which collides when two rooms share sharing+ac+bathroom+furnishing and would
  // overwrite a sibling room. Add/remove replace the whole array.
  const setRooms = (next: DraftRoom[]) =>
    dispatch({ type: "SET_FIELD", path: "room_types", value: next });

  const addRoom = () =>
    setRooms([
      ...rooms,
      { sharing: "single", ac: false, monthly_rent_paise: 0, vacancy_count: 1, has_balcony: false }
    ]);

  const editRoom = (index: number, next: DraftRoom) =>
    setRooms(rooms.map((r, i) => (i === index ? next : r)));

  const removeRoom = (index: number) => setRooms(rooms.filter((_, i) => i !== index));

  return (
    <SectionCard
      title="Configured rooms"
      subtitle="Add each room type with its rent and vacancies."
      icon={<BedDouble size={20} />}
    >
      {rooms.length > 0 && (
        <div className={styles.roomList}>
          {rooms.map((room, i) => (
            <RoomTypeCard
              key={i}
              room={room}
              onChange={(next) => editRoom(i, next)}
              onRemove={() => removeRoom(i)}
            />
          ))}
        </div>
      )}
      <button type="button" className={styles.addRoomBtn} onClick={addRoom}>
        <Plus size={16} /> Add room type
      </button>
    </SectionCard>
  );
}
