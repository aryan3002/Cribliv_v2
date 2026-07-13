"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@cribliv/ui";
import type {
  PgBed,
  PgBedAssignment,
  PgBedAssignmentOccupantInput,
  PgRoom
} from "@cribliv/shared-types";
import {
  cancelAssignmentMoveOut,
  confirmAssignmentMoveOut,
  moveInBed,
  moveOutAssignmentNow,
  operatorMoveOutRequest,
  reserveBed
} from "@/lib/pg-operations-api";
import styles from "./PgAssignmentDrawer.module.css";

type Mode = "reserve" | "move-in";
type AssignmentForm = {
  occupant_name: string;
  occupant_phone_e164: string;
  expected_move_in_date: string;
  move_in_date: string;
  monthly_rent_paise: string;
  security_deposit_paise: string;
  operator_notes: string;
};

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

function statusLabel(status: PgBedAssignment["status"]): string {
  if (status === "active") return "moved in";
  return status.replaceAll("_", " ");
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

function findBed(rooms: PgRoom[], bedId: string): (PgBed & { room_number: string }) | null {
  for (const room of rooms) {
    const bed = room.beds.find((item) => item.id === bedId);
    if (bed) return { ...bed, room_number: room.room_number };
  }
  return null;
}

function selectableBeds(rooms: PgRoom[], mode: Mode): Array<PgBed & { room_number: string }> {
  const statuses = mode === "reserve" ? ["vacant"] : ["vacant", "reserved"];
  return rooms.flatMap((room) =>
    room.beds
      .filter((bed) => statuses.includes(bed.status))
      .map((bed) => ({ ...bed, room_number: room.room_number }))
  );
}

function emptyForm(): AssignmentForm {
  return {
    occupant_name: "",
    occupant_phone_e164: "",
    expected_move_in_date: "",
    move_in_date: "",
    monthly_rent_paise: "",
    security_deposit_paise: "",
    operator_notes: ""
  };
}

function formFromAssignment(assignment: PgBedAssignment): AssignmentForm {
  return {
    occupant_name: assignment.occupant_name,
    occupant_phone_e164: assignment.occupant_phone_e164,
    expected_move_in_date: assignment.expected_move_in_date ?? "",
    move_in_date: assignment.move_in_date ?? assignment.expected_move_in_date ?? "",
    monthly_rent_paise: assignment.monthly_rent_paise?.toString() ?? "",
    security_deposit_paise: assignment.security_deposit_paise?.toString() ?? "",
    operator_notes: assignment.operator_notes ?? ""
  };
}

export default function PgAssignmentDrawer({
  propertyId,
  token,
  assignments,
  rooms,
  initialBedId,
  initialMode,
  bedDetailBase
}: {
  propertyId: string;
  token?: string;
  assignments: PgBedAssignment[];
  rooms: PgRoom[];
  initialBedId?: string;
  initialMode?: Mode;
  bedDetailBase?: string;
}) {
  const router = useRouter();
  const initialAssignment = assignments.find((item) => item.bed_id === initialBedId);
  const initialSelection = initialAssignment ?? assignments[0] ?? null;
  const [mode, setMode] = useState<Mode>(
    initialMode ?? (initialSelection?.status === "reserved" ? "move-in" : "reserve")
  );
  const selectable = useMemo(() => selectableBeds(rooms, mode), [rooms, mode]);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(initialSelection?.id ?? "");
  const [bedId, setBedId] = useState(initialBedId ?? initialSelection?.bed_id ?? "");
  const [form, setForm] = useState<AssignmentForm>(
    initialSelection ? formFromAssignment(initialSelection) : emptyForm()
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = assignments.find((item) => item.id === selectedAssignmentId) ?? assignments[0];
  const selectedBed = useMemo(
    () => (selected ? findBed(rooms, selected.bed_id) : null),
    [rooms, selected]
  );
  const beds = useMemo(() => {
    if (!selectedBed || selectable.some((bed) => bed.id === selectedBed.id)) return selectable;
    return [selectedBed, ...selectable];
  }, [selectable, selectedBed]);
  const canSubmitForm = selectable.some((bed) => bed.id === bedId);

  useEffect(() => {
    if (!beds.some((bed) => bed.id === bedId)) {
      setBedId(beds[0]?.id ?? "");
    }
  }, [bedId, beds]);

  function selectAssignment(assignment: PgBedAssignment) {
    setSelectedAssignmentId(assignment.id);
    setBedId(assignment.bed_id);
    setForm(formFromAssignment(assignment));
    setError(null);
    if (assignment.status === "reserved") {
      setMode("move-in");
    }
  }

  function payload(): PgBedAssignmentOccupantInput | null {
    const next = {
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
    if (!next.occupant_name || !next.occupant_phone_e164) {
      setError("Name and phone are required before saving this assignment.");
      return null;
    }
    return next;
  }

  async function submit() {
    const body = payload();
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      if (mode === "reserve") {
        await reserveBed(propertyId, bedId, body, token, key("reserve"));
      } else {
        await moveInBed(propertyId, bedId, body, token, key("move-in"));
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this assignment.");
    } finally {
      setPending(false);
    }
  }

  async function confirmReservedMoveIn() {
    if (!selected || selected.status !== "reserved") return;
    const body = payload();
    if (!body) return;
    setPending(true);
    setError(null);
    try {
      await moveInBed(propertyId, selected.bed_id, body, token, key("move-in"));
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm move-in.");
    } finally {
      setPending(false);
    }
  }

  async function runAssignmentAction(action: "request" | "confirm" | "cancel" | "direct") {
    if (!selected) return;
    setPending(true);
    setError(null);
    try {
      if (action === "request") {
        await operatorMoveOutRequest(propertyId, selected.id, token);
      } else if (action === "confirm") {
        await confirmAssignmentMoveOut(propertyId, selected.id, token);
      } else if (action === "direct") {
        await moveOutAssignmentNow(propertyId, selected.id, token);
      } else {
        await cancelAssignmentMoveOut(propertyId, selected.id, token);
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
              onClick={() => selectAssignment(assignment)}
            >
              <span>
                <strong>{assignment.occupant_name}</strong>
                <span>{assignment.occupant_phone_e164}</span>
              </span>
              <span>{bedLabel(rooms, assignment.bed_id)}</span>
              <Badge tone={STATUS_TONE[assignment.status]}>{statusLabel(assignment.status)}</Badge>
              <span>{selected?.id === assignment.id ? "Selected" : "Review"}</span>
            </button>
          ))
        )}
      </section>

      <aside className={styles.drawer} aria-label="Assignment drawer">
        <h2>Assignment</h2>
        <p>Reserve a vacant bed, move an occupant in, or complete operator move-out actions.</p>
        {selected && (
          <div className={styles.notice}>
            <p>
              {selected.occupant_name} is currently {statusLabel(selected.status)} on{" "}
              {bedLabel(rooms, selected.bed_id)}.
            </p>
            <div className={styles.actions}>
              {bedDetailBase && (
                <Link
                  className={styles.detailLink}
                  href={`${bedDetailBase}/${encodeURIComponent(selected.bed_id)}` as any}
                >
                  Open bed record
                </Link>
              )}
              {selected.status === "reserved" && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void confirmReservedMoveIn()}
                >
                  Confirm move-in
                </Button>
              )}
              {["active", "notice_served", "move_out_requested"].includes(selected.status) && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void runAssignmentAction("request")}
                >
                  Request move-out
                </Button>
              )}
              {[
                "active",
                "notice_served",
                "move_out_requested",
                "move_out_pending_confirmation"
              ].includes(selected.status) && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => void runAssignmentAction("direct")}
                >
                  Move out
                </Button>
              )}
              {selected.status === "move_out_pending_confirmation" && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void runAssignmentAction("confirm")}
                  >
                    Confirm move-out
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => void runAssignmentAction("cancel")}
                  >
                    Cancel move-out
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
        <div className={styles.tabs}>
          <button
            type="button"
            className={styles.tab}
            aria-pressed={mode === "reserve"}
            onClick={() => {
              setMode("reserve");
              setError(null);
            }}
          >
            Reserve
          </button>
          <button
            type="button"
            className={styles.tab}
            aria-pressed={mode === "move-in"}
            onClick={() => {
              setMode("move-in");
              setError(null);
            }}
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
            <Button
              type="button"
              disabled={pending || !bedId || !canSubmitForm}
              onClick={() => void submit()}
            >
              {mode === "reserve" ? "Reserve bed" : "Move in"}
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}
