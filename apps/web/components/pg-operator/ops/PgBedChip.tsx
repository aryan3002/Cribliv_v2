"use client";

import { Button, Badge } from "@cribliv/ui";
import type { PgBed, PgBedStatus } from "@cribliv/shared-types";
import { OverflowMenu } from "@/components/ui/menu/OverflowMenu";
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

function occupantName(bed: PgBed): string | null {
  for (const key of ["tenant_name", "occupant_name", "tenantName", "occupantName"]) {
    const value = bed.metadata[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export default function PgBedChip({
  bed,
  onSetStatus,
  onRelist,
  assignmentHref,
  detailHref,
  pending
}: {
  bed: PgBed;
  roomNumber: string;
  onSetStatus: (status: "blocked" | "vacant") => void;
  onRelist: () => void;
  assignmentHref?: string;
  detailHref?: string;
  pending?: boolean;
}) {
  const isBlocked = bed.status === "blocked";
  const canAct = bed.status === "vacant" || bed.status === "blocked";
  const tenantName = bed.status === "occupied" ? occupantName(bed) : null;

  return (
    <article className={styles.chip} data-status={bed.status}>
      <div className={styles.head}>
        <strong>Bed {bed.bed_label}</strong>
        <Badge tone={TONE_BY_STATUS[bed.status]}>{title(bed.status)}</Badge>
      </div>
      {tenantName ? <p className={styles.context}>{tenantName}</p> : null}
      {!tenantName && bed.status === "vacant" && bed.available_from ? (
        <p className={styles.context}>Available {bed.available_from}</p>
      ) : null}
      {canAct || assignmentHref || detailHref ? (
        <div className={styles.actions}>
          {bed.status === "vacant" &&
            (assignmentHref ? (
              <a className={styles.primaryAction} href={assignmentHref}>
                Assign
              </a>
            ) : (
              <Button
                type="button"
                variant="tertiary"
                className={styles.primaryAction}
                disabled={pending}
                aria-label={`Block Bed ${bed.bed_label}`}
                onClick={() => onSetStatus("blocked")}
              >
                Block
              </Button>
            ))}
          {isBlocked && (
            <Button
              type="button"
              variant="tertiary"
              className={styles.primaryAction}
              disabled={pending}
              aria-label={`Relist Bed ${bed.bed_label}`}
              onClick={onRelist}
            >
              Relist
            </Button>
          )}
          {bed.status === "occupied" && assignmentHref ? (
            <a className={styles.primaryAction} href={assignmentHref}>
              Manage
            </a>
          ) : null}
          {(bed.status === "reserved" || bed.status === "inactive") && assignmentHref ? (
            <a className={styles.primaryAction} href={assignmentHref}>
              Manage
            </a>
          ) : null}
          {((bed.status === "vacant" && assignmentHref) || isBlocked || detailHref) && (
            <OverflowMenu
              ariaLabel={`More actions for Bed ${bed.bed_label}`}
              items={[
                ...(bed.status === "vacant"
                  ? [{ label: "Block", onSelect: () => onSetStatus("blocked"), disabled: pending }]
                  : []),
                ...(detailHref
                  ? [{ label: "Bed record", onSelect: () => window.location.assign(detailHref) }]
                  : [])
              ]}
            />
          )}
        </div>
      ) : null}
    </article>
  );
}
