"use client";

import { Button, Badge } from "@cribliv/ui";
import type { PgBed, PgBedStatus } from "@cribliv/shared-types";
import styles from "./PgBedChip.module.css";

const TONE_BY_STATUS: Record<PgBedStatus, "verified" | "pending" | "brand" | "neutral" | "danger"> =
  {
    vacant: "verified",
    reserved: "pending",
    occupied: "brand",
    blocked: "danger",
    inactive: "neutral"
  };

function title(status: PgBedStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function PgBedChip({
  bed,
  roomNumber,
  onSetStatus,
  onRelist,
  assignmentHref,
  pending
}: {
  bed: PgBed;
  roomNumber: string;
  onSetStatus: (status: "blocked" | "vacant") => void;
  onRelist: () => void;
  assignmentHref?: string;
  pending?: boolean;
}) {
  const isBlocked = bed.status === "blocked";
  const canAct = bed.status === "vacant" || bed.status === "blocked";

  return (
    <article className={styles.chip} data-status={bed.status}>
      <div className={styles.head}>
        <div>
          <span className={styles.room}>{roomNumber}</span>
          <strong>Bed {bed.bed_label}</strong>
        </div>
        <Badge tone={TONE_BY_STATUS[bed.status]}>{title(bed.status)}</Badge>
      </div>
      <p className={styles.date}>
        {bed.available_from ? `Available ${bed.available_from}` : "No available date"}
      </p>
      {(canAct || assignmentHref) && (
        <div className={styles.actions}>
          {canAct && (
            <>
              <Button
                type="button"
                variant="tertiary"
                className={styles.actionButton}
                disabled={pending}
                aria-label={
                  isBlocked ? `Mark Bed ${bed.bed_label} vacant` : `Block Bed ${bed.bed_label}`
                }
                onClick={() => onSetStatus(isBlocked ? "vacant" : "blocked")}
              >
                {isBlocked ? "Vacant" : "Block"}
              </Button>
              <Button
                type="button"
                variant="tertiary"
                className={styles.actionButton}
                disabled={pending}
                aria-label={`Relist Bed ${bed.bed_label}`}
                onClick={onRelist}
              >
                Relist
              </Button>
            </>
          )}
          {assignmentHref && (
            <a className={styles.actionButton} href={assignmentHref}>
              Tenants
            </a>
          )}
        </div>
      )}
    </article>
  );
}
