"use client";
import type { DraftPartial } from "@/lib/pg-wizard-sanitizer";
import styles from "./shared/pg-wizard.module.css";

export default function PgLivePreview({ draft }: { draft: DraftPartial }) {
  const name = draft.property?.display_name?.trim() || "Your PG name";
  const city = draft.property?.city_slug ?? "";
  const rooms = draft.room_types ?? [];
  const minPaise = rooms.length ? Math.min(...rooms.map((r: any) => r.monthly_rent_paise ?? 0)) : 0;
  const gender = draft.pg_details?.gender_policy;
  return (
    <div className={styles.preview}>
      <div className={styles.previewBody}>
        <span className={styles.previewTitle}>{name}</span>
        {city && (
          <span className={styles.previewMeta}>{city.charAt(0).toUpperCase() + city.slice(1)}</span>
        )}
        {minPaise > 0 && (
          <span className={styles.previewPrice}>
            from ₹{Math.round(minPaise / 100).toLocaleString("en-IN")}/mo
          </span>
        )}
        <div className={styles.previewBadges}>
          {gender && <span>{gender}</span>}
          {draft.pg_details?.meals?.provided && <span>Food</span>}
        </div>
      </div>
    </div>
  );
}
