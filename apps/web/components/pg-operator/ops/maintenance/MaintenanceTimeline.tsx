"use client";

import type { PgMaintenanceTimelineEvent } from "@cribliv/shared-types";
import styles from "../MaintenanceWorkspace.module.css";

type MaintenanceMode = "operator" | "tenant";

const EVENT_LABEL: Record<PgMaintenanceTimelineEvent["event_type"], string> = {
  created: "Created",
  status_changed: "Status changed",
  priority_set: "Priority set",
  priority_overridden: "Priority overridden",
  comment_added: "Comment",
  internal_note_added: "Internal note",
  photo_added: "Photo added",
  resolution_recorded: "Resolved",
  reopened: "Reopened",
  auto_closed: "Auto-closed",
  cancelled: "Cancelled"
};

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
}

function actorLabel(event: PgMaintenanceTimelineEvent): string {
  if (event.actor_role === "system") return "System";
  return event.actor_role.replaceAll("_", " ");
}

function rupees(value: unknown): string | null {
  if (typeof value !== "number") return null;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value / 100);
}

function payloadText(event: PgMaintenanceTimelineEvent): string | null {
  const body = event.payload.body;
  if (typeof body === "string" && body.trim()) return body;
  const note = event.payload.note;
  if (typeof note === "string" && note.trim()) return note;
  const reason = event.payload.reason;
  if (typeof reason === "string" && reason.trim()) return reason;
  if (event.from_status && event.to_status) {
    return `${event.from_status.replaceAll("_", " ")} to ${event.to_status.replaceAll("_", " ")}`;
  }
  return null;
}

export default function MaintenanceTimeline({
  events,
  mode
}: {
  events: PgMaintenanceTimelineEvent[];
  mode: MaintenanceMode;
}) {
  const visibleEvents =
    mode === "tenant" ? events.filter((event) => event.visibility !== "operator_internal") : events;

  if (visibleEvents.length === 0) {
    return <p className={styles.noComments}>No timeline events yet.</p>;
  }

  return (
    <ol className={styles.timeline} aria-label="Maintenance timeline">
      {visibleEvents.map((event) => {
        const text = payloadText(event);
        const cost = rupees(event.payload.cost_paise);
        const chargeable =
          typeof event.payload.chargeable_damage === "boolean"
            ? event.payload.chargeable_damage
              ? "Yes"
              : "No"
            : null;
        return (
          <li key={event.id}>
            <div className={styles.timelineHeader}>
              <strong>{EVENT_LABEL[event.event_type]}</strong>
              <span>{actorLabel(event)}</span>
              <time dateTime={event.created_at}>{displayDate(event.created_at)}</time>
            </div>
            {text ? <p>{text}</p> : null}
            {event.event_type === "resolution_recorded" ? (
              <dl className={styles.timelineMeta}>
                {cost ? (
                  <div>
                    <dt>Cost</dt>
                    <dd>{`Cost: ${cost}`}</dd>
                  </div>
                ) : null}
                {chargeable ? (
                  <div>
                    <dt>Chargeable damage</dt>
                    <dd>{`Chargeable damage: ${chargeable}`}</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
