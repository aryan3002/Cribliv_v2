"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, type BadgeTone } from "@cribliv/ui";
import type {
  PgMaintenanceComment,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { ClipboardList, Loader2, MessageSquarePlus, Wrench } from "lucide-react";
import {
  addMaintenanceComment,
  addResidenceMaintenanceComment,
  createResidenceMaintenance,
  updateMaintenanceStatus
} from "@/lib/pg-operations-api";
import styles from "./MaintenanceWorkspace.module.css";

type MaintenanceMode = "operator" | "tenant";
type TicketFilter = "all" | PgMaintenanceStatus;

const MINIMUM_DESCRIPTION_LENGTH = 10;

const STATUS_LABEL: Record<PgMaintenanceStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_tenant: "Waiting on tenant",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled"
};

const STATUS_TONE: Record<PgMaintenanceStatus, BadgeTone> = {
  open: "pending",
  in_progress: "brand",
  waiting_on_tenant: "pending",
  resolved: "verified",
  closed: "neutral",
  cancelled: "neutral"
};

const OPERATOR_TRANSITIONS: Record<PgMaintenanceStatus, PgMaintenanceStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["waiting_on_tenant", "resolved", "cancelled"],
  waiting_on_tenant: ["in_progress"],
  resolved: ["closed"],
  closed: [],
  cancelled: []
};

const ACTION_LABEL: Partial<Record<PgMaintenanceStatus, string>> = {
  in_progress: "Start work",
  waiting_on_tenant: "Wait for tenant",
  resolved: "Resolve",
  closed: "Close ticket",
  cancelled: "Cancel ticket"
};

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function mergeRequest(
  previous: PgMaintenanceRequest,
  updated: PgMaintenanceRequest
): PgMaintenanceRequest {
  return {
    ...updated,
    comments: updated.comments.length > 0 ? updated.comments : previous.comments
  };
}

export default function MaintenanceWorkspace({
  initialRequests,
  mode,
  propertyId,
  token,
  compact = false
}: {
  initialRequests: PgMaintenanceRequest[];
  mode: MaintenanceMode;
  propertyId?: string;
  token: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [selectedId, setSelectedId] = useState<string | null>(initialRequests[0]?.id ?? null);
  const [filter, setFilter] = useState<TicketFilter>("all");
  const [comment, setComment] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commentIdempotencyKey = useRef<{ requestId: string; key: string } | null>(null);
  const createIdempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setRequests(initialRequests);
    setSelectedId((current) => {
      if (current && initialRequests.some((request) => request.id === current)) return current;
      return initialRequests[0]?.id ?? null;
    });
  }, [initialRequests]);

  const visibleRequests = useMemo(
    () => (filter === "all" ? requests : requests.filter((request) => request.status === filter)),
    [filter, requests]
  );
  useEffect(() => {
    setSelectedId((current) => {
      if (current && visibleRequests.some((request) => request.id === current)) return current;
      return visibleRequests[0]?.id ?? null;
    });
  }, [visibleRequests]);

  const selected = visibleRequests.find((request) => request.id === selectedId) ?? null;
  const transitions = selected && mode === "operator" ? OPERATOR_TRANSITIONS[selected.status] : [];
  const showDetailPane = Boolean(selected) || !compact || visibleRequests.length > 0;

  function replaceRequest(updated: PgMaintenanceRequest) {
    setRequests((current) =>
      current.map((request) =>
        request.id === updated.id ? mergeRequest(request, updated) : request
      )
    );
  }

  function appendComment(requestId: string, nextComment: PgMaintenanceComment) {
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? { ...request, comments: [...request.comments, nextComment] }
          : request
      )
    );
  }

  async function changeStatus(status: PgMaintenanceStatus) {
    if (!selected || mode !== "operator" || !propertyId || pending) return;
    if (!OPERATOR_TRANSITIONS[selected.status].includes(status)) return;

    setPending(`status:${status}`);
    setError(null);
    try {
      replaceRequest(await updateMaintenanceStatus(propertyId, selected.id, status, token));
      router.refresh();
    } catch (cause) {
      setError(failureMessage(cause, "Could not update this maintenance ticket."));
    } finally {
      setPending(null);
    }
  }

  async function submitComment() {
    if (!selected || pending) return;
    const body = comment.trim();
    if (!body) {
      setError("Enter a comment before sending.");
      return;
    }

    setPending("comment");
    setError(null);
    const savedKey = commentIdempotencyKey.current;
    const idempotencyKey =
      savedKey?.requestId === selected.id
        ? savedKey.key
        : (commentIdempotencyKey.current = { requestId: selected.id, key: createIdempotencyKey() })
            .key;

    try {
      const nextComment =
        mode === "operator"
          ? propertyId
            ? await addMaintenanceComment(propertyId, selected.id, { body }, token, idempotencyKey)
            : null
          : await addResidenceMaintenanceComment(selected.id, { body }, token, idempotencyKey);
      if (!nextComment) throw new Error("Could not add this maintenance comment.");
      appendComment(selected.id, nextComment);
      setComment("");
      commentIdempotencyKey.current = null;
      router.refresh();
    } catch (cause) {
      setError(failureMessage(cause, "Could not add this maintenance comment."));
    } finally {
      setPending(null);
    }
  }

  async function createTicket() {
    if (mode !== "tenant" || pending) return;
    const nextCategory = category.trim();
    const nextDescription = description.trim();
    if (!nextCategory) {
      setError("Enter a maintenance category.");
      return;
    }
    if (!nextDescription || nextDescription.length < MINIMUM_DESCRIPTION_LENGTH) {
      setError(`Describe the issue in at least ${MINIMUM_DESCRIPTION_LENGTH} characters.`);
      return;
    }

    setPending("create");
    setError(null);
    const idempotencyKey =
      createIdempotencyKeyRef.current ?? (createIdempotencyKeyRef.current = createIdempotencyKey());
    try {
      const created = await createResidenceMaintenance(
        { category: nextCategory, description: nextDescription },
        token,
        idempotencyKey
      );
      setRequests((current) => [created, ...current]);
      setSelectedId(created.id);
      setCategory("");
      setDescription("");
      createIdempotencyKeyRef.current = null;
      router.refresh();
    } catch (cause) {
      setError(failureMessage(cause, "Could not raise this maintenance ticket."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={`${styles.workspace} ${compact ? styles.compact : ""}`}>
      {mode === "tenant" && (
        <section className={styles.createForm} aria-label="Raise a maintenance ticket">
          <div className={styles.formHeading}>
            <Wrench size={17} aria-hidden="true" />
            <h3>Raise a ticket</h3>
          </div>
          <div className={styles.fieldGrid}>
            <label>
              <span>Category</span>
              <input
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                placeholder="Example: Plumbing"
                disabled={pending !== null}
              />
            </label>
            <label className={styles.descriptionField}>
              <span>Description</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Describe the issue and where it is happening."
                rows={3}
                disabled={pending !== null}
              />
            </label>
          </div>
          <div className={styles.formActions}>
            <Button type="button" disabled={pending !== null} onClick={() => void createTicket()}>
              {pending === "create" ? <Loader2 size={16} className={styles.spin} /> : null}
              Raise ticket
            </Button>
          </div>
        </section>
      )}

      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}

      <div className={`${styles.ticketTool} ${showDetailPane ? "" : styles.ticketToolSingle}`}>
        <div className={styles.listPane}>
          <div className={styles.listHeading}>
            <div>
              <h3>Tickets</h3>
              <span>{requests.length} total</span>
            </div>
            <label className={styles.filterField}>
              <span className={styles.srOnly}>Filter tickets</span>
              <select
                aria-label="Filter tickets"
                value={filter}
                onChange={(event) => setFilter(event.target.value as TicketFilter)}
              >
                <option value="all">All statuses</option>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {visibleRequests.length === 0 ? (
            <div className={styles.empty}>No maintenance tickets match this view.</div>
          ) : (
            <div className={styles.ticketList}>
              {visibleRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  className={`${styles.ticketButton} ${request.id === selected?.id ? styles.ticketButtonActive : ""}`}
                  aria-pressed={request.id === selected?.id}
                  onClick={() => {
                    setSelectedId(request.id);
                    setComment("");
                    setError(null);
                  }}
                >
                  <span className={styles.ticketTopline}>
                    <strong>{request.category}</strong>
                    <Badge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Badge>
                  </span>
                  <span className={styles.ticketDescription}>{request.description}</span>
                  <time dateTime={request.created_at}>{displayDate(request.created_at)}</time>
                </button>
              ))}
            </div>
          )}
        </div>

        {showDetailPane && (
          <div className={styles.detailPane}>
            {!selected ? (
              <div className={styles.emptyDetail}>
                <ClipboardList size={20} aria-hidden="true" />
                Select a maintenance ticket to view its details.
              </div>
            ) : (
              <>
                <div className={styles.ticketDetailHeader}>
                  <div>
                    <h3>{selected.category}</h3>
                    <time dateTime={selected.created_at}>
                      Raised {displayDate(selected.created_at)}
                    </time>
                  </div>
                  <Badge tone={STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
                </div>
                <p className={styles.detailDescription}>{selected.description}</p>

                {mode === "operator" && (
                  <div className={styles.transitionSection}>
                    <span>Available actions</span>
                    {transitions.length === 0 ? (
                      <p>No further status actions are available.</p>
                    ) : (
                      <div className={styles.transitionActions}>
                        {transitions.map((status) => (
                          <Button
                            key={status}
                            type="button"
                            variant={status === "cancelled" ? "tertiary" : "secondary"}
                            disabled={pending !== null}
                            onClick={() => void changeStatus(status)}
                          >
                            {pending === `status:${status}` ? (
                              <Loader2 size={15} className={styles.spin} />
                            ) : null}
                            {ACTION_LABEL[status] ?? STATUS_LABEL[status]}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <section className={styles.commentSection} aria-label="Ticket comments">
                  <div className={styles.commentHeading}>
                    <h4>Comments</h4>
                    <MessageSquarePlus size={16} aria-hidden="true" />
                  </div>
                  {selected.comments.length === 0 ? (
                    <p className={styles.noComments}>No comments yet.</p>
                  ) : (
                    <ol className={styles.comments}>
                      {selected.comments.map((item) => (
                        <li key={item.id}>
                          <div>
                            <strong>{item.author_role.replaceAll("_", " ")}</strong>
                            <time dateTime={item.created_at}>{displayDate(item.created_at)}</time>
                          </div>
                          <p>{item.body}</p>
                        </li>
                      ))}
                    </ol>
                  )}
                  <label className={styles.commentForm}>
                    <span>Add comment</span>
                    <textarea
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                      rows={3}
                      placeholder="Add an update for this ticket."
                      disabled={pending !== null}
                    />
                  </label>
                  <div className={styles.formActions}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending !== null}
                      onClick={() => void submitComment()}
                    >
                      {pending === "comment" ? <Loader2 size={16} className={styles.spin} /> : null}
                      Send comment
                    </Button>
                  </div>
                </section>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
