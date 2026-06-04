"use client";
import { BedDouble, X } from "lucide-react";
import type { PgSharingKind } from "@cribliv/shared-types";
import SegmentedControl from "./SegmentedControl";
import Stepper from "./Stepper";
import RupeeInput from "./RupeeInput";
import styles from "./pg-wizard.module.css";

export interface DraftRoom {
  sharing: PgSharingKind;
  ac: boolean;
  monthly_rent_paise: number;
  vacancy_count: number;
}

const SHARING: { value: PgSharingKind; label: string }[] = [
  { value: "single", label: "Single" },
  { value: "double", label: "Double" },
  { value: "triple", label: "Triple" },
  { value: "quad", label: "Quad" },
  { value: "dorm", label: "Dorm" }
];

const SHARING_LABEL: Record<string, string> = {
  single: "Single Sharing",
  double: "Double Sharing",
  triple: "Triple Sharing",
  quad: "Quad Sharing",
  dorm: "Dormitory"
};

export default function RoomTypeCard({
  room,
  onChange,
  onRemove
}: {
  room: DraftRoom;
  onChange: (r: DraftRoom) => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.roomCard}>
      <div className={styles.roomCardHead}>
        <span className={styles.roomCardTitle}>
          <BedDouble size={18} /> {SHARING_LABEL[room.sharing] ?? "Room"}
        </span>
        <span className={styles.roomCardRent}>
          ₹{Math.round((room.monthly_rent_paise ?? 0) / 100).toLocaleString("en-IN")}/mo
        </span>
        <button
          type="button"
          className={styles.roomRemove}
          aria-label="remove room type"
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      </div>

      <SegmentedControl
        label="Sharing"
        value={room.sharing}
        options={SHARING}
        onChange={(v) => onChange({ ...room, sharing: v })}
      />

      <div className={styles.roomCardRow}>
        <RupeeInput
          label="Monthly rent"
          valuePaise={room.monthly_rent_paise}
          onChangePaise={(p) => onChange({ ...room, monthly_rent_paise: p ?? 0 })}
        />
        <Stepper
          label="Vacancies"
          value={room.vacancy_count}
          min={0}
          onChange={(v) => onChange({ ...room, vacancy_count: v })}
        />
      </div>

      <SegmentedControl
        label="Air conditioning"
        value={room.ac ? "yes" : "no"}
        options={[
          { value: "no", label: "Non-AC" },
          { value: "yes", label: "AC" }
        ]}
        onChange={(v) => onChange({ ...room, ac: v === "yes" })}
      />
    </div>
  );
}
