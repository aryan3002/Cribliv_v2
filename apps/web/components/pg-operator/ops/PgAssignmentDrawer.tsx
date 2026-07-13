"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@cribliv/ui";
import type { PgBed, PgBedAssignment, PgRoom } from "@cribliv/shared-types";
import {
  confirmAssignmentMoveOut,
  moveInBed,
  operatorMoveOutRequest,
  reserveBed
} from "@/lib/pg-operations-api";
import styles from "./PgAssignmentDrawer.module.css";

type Mode = "reserve" | "move-in";

const STATUS_TONE: Record<
  PgBedAssignment["status"],
  "verified" | "pending" | "brand" | "neutral" | "danger"
> = {
  reserved: "pending",
  active: "verified",
  notice_served: "brand",
  move_out_requested: "pending",
  move_out_pending_confirmation: "pending",
  moved_out: "neutral",
  cancelled: "neutral"
};

function dateValue(value: string | null): string {
  return value ?? "";
}

function key(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function bedLabel(rooms: PgRoom[], bedId: string): string {
  for (const room of rooms) {
    const bed = room.beds.find((item) => item.id === bedId);
    if (bed) return `${room.room_number} / Bed ${bed.bed_label}`;
  }
  return "Unknown bed";
}

function selectableBeds(rooms: PgRoom[], mode: Mode): Array<PgBed & { room_number: string }> {
  const statuses = mode === "reserve" ? ["vacant"] : ["vacant", "reserved"];
  return rooms.flatMap((room) =>
    room.beds
      .filter((bed) => statuses.includes(bed.status))
      .map((bed) => ({ ...bed, room_number: room.room_number }))
  );
}

export default function PgAssignmentDrawer({
  propertyId,
  token,
  assignments,
  rooms,
  initialBedId,
  initialMode
}: {
  propertyId: string;
  token?: string;
  assignments: PgBedAssignment[];
  rooms: PgRoom[];
  initialBedId?: string;
  initialMode?: Mode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode ?? "reserve");
  const beds = useMemo(() => selectableBeds(rooms, mode), [rooms, mode]);
  const [bedId, setBedId] = useState(initialBedId ?? beds[0]?.id ?? "");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(assignments[0]?.id ?? "");
  const [form, setForm] = useState({
    occupant_name: "",
    occupant_phone_e164: "",
    expected_move_in_date: "",
    move_in_date: "",
    monthly_rent_paise: "",
    security_deposit_paise: "",
    operator_notes: ""
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = assignments.find((item) => item.id === selectedAssignmentId) ?? assignments[0];

  function payload() {
    return {
      occupant_name: form.occupant_name.trim(),
      occupant_phone_e164: form.occupant_phone_e164.trim(),
      expected_move_in_date: form.expected_move_in_date || null,
      move_in_date: form.move_in_date || null,
      monthly_rent_paise: form.monthly_rent_paise ? Number(form.monthly_rent_paise) : null,
      security_deposit_paise: form.security_deposit_paise
        ? Number(form.security_deposit_paise)
        : null,
      operator_notes: form.operator_notes.trim() || null
    };
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      if (mode === "reserve") {
        await reserveBed(propertyId, bedId, payload(), token, key("reserve"));
      } else {
        await moveInBed(propertyId, bedId, payload(), token, key("move-in"));
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this assignment.");
    } finally {
      setPending(false);
    }
  }

  async function runAssignmentAction(action: "request" | "confirm") {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      if (action === "request") {
        await operatorMoveOutRequest(propertyId, selected.id, token);
      } else {
        await confirmAssignmentMoveOut(propertyId, selected.id, token);
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the move-out state.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.shell}>
      <section className={styles.list} aria-label="Assignments">
        <div className={styles.listHeader}>
          <span>Occupant</span>
          <span>Bed</span>
          <span>Status</span>
          <span>Action</span>
        </div>
        {assignments.length === 0 ? (
          <div className={styles.empty}>No occupants assigned yet.</div>
        ) : (
          assignments.map((assignment) => (
            <button
              key={assignment.id}
              type="button"
              className={styles.assignment}
              onClick={() => setSelectedAssignmentId(assignment.id)}
            >
              <span>
                <strong>{assignment.occupant_name}</strong>
                <span>{assignment.occupant_phone_e164}</span>
              </span>
              <span>{bedLabel(rooms, assignment.bed_id)}</span>
              <Badge tone={STATUS_TONE[assignment.status]}>
                {assignment.status.replaceAll("_", " ")}
              </Badge>
              <span>{selected?.id === assignment.id ? "Selected" : "Review"}</span>
            </button>
          ))
        )}
      </section>

      <aside className={styles.drawer} aria-label="Assignment drawer">
        <h2>Assignment</h2>
        <p>Reserve a vacant bed, move an occupant in, or complete operator move-out actions.</p>
        <div className={styles.tabs}>
          <button
            type="button"
            className={styles.tab}
            aria-pressed={mode === "reserve"}
            onClick={() => setMode("reserve")}
          >
            Reserve
          </button>
          <button
            type="button"
            className={styles.tab}
            aria-pressed={mode === "move-in"}
            onClick={() => setMode("move-in")}
          >
            Move in
          </button>
        </div>
        <div className={styles.form}>
          <label className={styles.field}>
            <span>Bed</span>
            <select value={bedId} onChange={(event) => setBedId(event.target.value)}>
              {beds.map((bed) => (
                <option key={bed.id} value={bed.id}>
                  {bed.room_number} / Bed {bed.bed_label} ({bed.status})
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span>Name</span>
            <input
              value={form.occupant_name}
              onChange={(event) =>
                setForm((value) => ({ ...value, occupant_name: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Phone</span>
            <input
              value={form.occupant_phone_e164}
              onChange={(event) =>
                setForm((value) => ({ ...value, occupant_phone_e164: event.target.value }))
              }
              placeholder="+919999999902"
            />
          </label>
          <label className={styles.field}>
            <span>{mode === "reserve" ? "Expected move-in" : "Move-in date"}</span>
            <input
              type="date"
              value={
                mode === "reserve"
                  ? dateValue(form.expected_move_in_date)
                  : dateValue(form.move_in_date)
              }
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  [mode === "reserve" ? "expected_move_in_date" : "move_in_date"]:
                    event.target.value
                }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Monthly rent (paise)</span>
            <input
              inputMode="numeric"
              value={form.monthly_rent_paise}
              onChange={(event) =>
                setForm((value) => ({ ...value, monthly_rent_paise: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Deposit (paise)</span>
            <input
              inputMode="numeric"
              value={form.security_deposit_paise}
              onChange={(event) =>
                setForm((value) => ({ ...value, security_deposit_paise: event.target.value }))
              }
            />
          </label>
          <label className={styles.field}>
            <span>Notes</span>
            <textarea
              value={form.operator_notes}
              onChange={(event) =>
                setForm((value) => ({ ...value, operator_notes: event.target.value }))
              }
            />
          </label>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.actions}>
            <Button type="button" disabled={pending || !bedId} onClick={() => void submit()}>
              {mode === "reserve" ? "Reserve bed" : "Move in"}
            </Button>
          </div>
        </div>

        {selected && (
          <div className={styles.notice}>
            <p>
              {selected.occupant_name} is currently {selected.status.replaceAll("_", " ")} on{" "}
              {bedLabel(rooms, selected.bed_id)}.
            </p>
            <div className={styles.actions}>
              <Button
                type="button"
                variant="secondary"
                disabled={
                  pending ||
                  !["active", "notice_served", "move_out_requested"].includes(selected.status)
                }
                onClick={() => void runAssignmentAction("request")}
              >
                Request move-out
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending || selected.status !== "move_out_pending_confirmation"}
                onClick={() => void runAssignmentAction("confirm")}
              >
                Confirm move-out
              </Button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
