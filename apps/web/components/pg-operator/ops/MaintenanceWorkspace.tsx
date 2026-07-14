"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, type BadgeTone } from "@cribliv/ui";
import type {
  PgMaintenanceComment,
  PgMaintenanceCategory,
  PgMaintenanceLocation,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { ClipboardList, ImagePlus, Loader2, MessageSquarePlus, X } from "lucide-react";
import {
  addMaintenanceComment,
  addResidenceMaintenanceComment,
  updateMaintenanceStatus
} from "@/lib/pg-operations-api";
import MaintenanceCreateForm from "./maintenance/MaintenanceCreateForm";
import { FALLBACK_MAINTENANCE_CATEGORIES } from "./maintenance/maintenance-constants";
import {
  createMaintenanceUploadId,
  type PendingMaintenancePhoto,
  releaseMaintenancePhotoPreview,
  useMaintenancePhotoUpload
} from "./maintenance/useMaintenancePhotoUpload";
import styles from "./MaintenanceWorkspace.module.css";

type MaintenanceMode = "operator" | "tenant";
type TicketFilter = "all" | PgMaintenanceStatus;

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
  compact = false,
  categories = FALLBACK_MAINTENANCE_CATEGORIES,
  currentResidenceLocation = null
}: {
  initialRequests: PgMaintenanceRequest[];
  mode: MaintenanceMode;
  propertyId?: string;
  token: string;
  compact?: boolean;
  categories?: PgMaintenanceCategory[];
  currentResidenceLocation?: PgMaintenanceLocation | null;
}) {
  const router = useRouter();
  const [requests, setRequests] = useState(initialRequests);
  const [selectedId, setSelectedId] = useState<string | null>(initialRequests[0]?.id ?? null);
  const [filter, setFilter] = useState<TicketFilter>("all");
  const [comment, setComment] = useState("");
  const [commentPhotos, setCommentPhotos] = useState<PendingMaintenancePhoto[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commentIdempotencyKey = useRef<{ requestId: string; key: string } | null>(null);
  const commentPhotosRef = useRef<PendingMaintenancePhoto[]>([]);
  const photoUpload = useMaintenancePhotoUpload({ mode, propertyId, token });

  useEffect(() => {
    setRequests(initialRequests);
    setSelectedId((current) => {
      if (current && initialRequests.some((request) => request.id === current)) return current;
      return initialRequests[0]?.id ?? null;
    });
  }, [initialRequests]);

  useEffect(() => {
    commentPhotosRef.current = commentPhotos;
  }, [commentPhotos]);

  useEffect(
    () => () => {
      commentPhotosRef.current.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
    },
    []
  );

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
  const selectedLocation = selected?.location ?? null;

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

  function addPhotos(files: FileList | null) {
    if (!files) return;
    try {
      setCommentPhotos((current) => [...current, ...photoUpload.addFiles(files, current.length)]);
      setError(null);
    } catch (cause) {
      setError(failureMessage(cause, "Could not add these photos."));
    }
  }

  function removePhoto(clientUploadId: string) {
    setCommentPhotos((current) => photoUpload.removePhoto(current, clientUploadId));
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
    if (!body && commentPhotos.length === 0) {
      setError("Enter a comment or add a photo before sending.");
      return;
    }

    setPending("comment");
    setError(null);
    const savedKey = commentIdempotencyKey.current;
    const idempotencyKey =
      savedKey?.requestId === selected.id
        ? savedKey.key
        : (commentIdempotencyKey.current = {
            requestId: selected.id,
            key: createMaintenanceUploadId()
          }).key;

    try {
      const attachments = await photoUpload.uploadForComment(selected, commentPhotos);
      const payload =
        attachments.length > 0
          ? {
              body,
              attachments
            }
          : { body };
      const nextComment =
        mode === "operator"
          ? propertyId
            ? await addMaintenanceComment(propertyId, selected.id, payload, token, idempotencyKey)
            : null
          : await addResidenceMaintenanceComment(selected.id, payload, token, idempotencyKey);
      if (!nextComment) throw new Error("Could not add this maintenance comment.");
      appendComment(selected.id, nextComment);
      setComment("");
      commentPhotos.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
      setCommentPhotos([]);
      commentIdempotencyKey.current = null;
      router.refresh();
    } catch (cause) {
      setError(failureMessage(cause, "Could not add this maintenance comment."));
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={`${styles.workspace} ${compact ? styles.compact : ""}`}>
      {mode === "tenant" && (
        <MaintenanceCreateForm
          token={token}
          categories={categories}
          currentResidenceLocation={currentResidenceLocation}
          onCreated={(created) => {
            setRequests((current) => [created, ...current]);
            setSelectedId(created.id);
            setError(null);
            router.refresh();
          }}
        />
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
                    commentPhotos.forEach((photo) =>
                      releaseMaintenancePhotoPreview(photo.previewUrl)
                    );
                    setCommentPhotos([]);
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

                {selectedLocation && (
                  <dl className={styles.locationGrid}>
                    <div>
                      <dt>Room</dt>
                      <dd>
                        Room {selectedLocation.room_number}
                        {selectedLocation.bed_label ? ` · Bed ${selectedLocation.bed_label}` : ""}
                      </dd>
                    </div>
                    {selectedLocation.floor !== null && selectedLocation.floor !== undefined && (
                      <div>
                        <dt>Floor</dt>
                        <dd>Floor {selectedLocation.floor}</dd>
                      </div>
                    )}
                    {selectedLocation.tenant_name && (
                      <div>
                        <dt>Tenant</dt>
                        <dd>{selectedLocation.tenant_name}</dd>
                      </div>
                    )}
                    {selectedLocation.tenant_phone_e164 && (
                      <div>
                        <dt>Phone</dt>
                        <dd>{selectedLocation.tenant_phone_e164}</dd>
                      </div>
                    )}
                  </dl>
                )}

                {selected.photo_urls.length > 0 && (
                  <div className={styles.photoGrid} aria-label="Maintenance photos">
                    {selected.photo_urls.map((url, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={url} src={url} alt={`Maintenance photo ${index + 1}`} />
                    ))}
                  </div>
                )}

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
                          {item.attachment_urls.length > 0 && (
                            <div className={styles.commentPhotos} aria-label="Comment photos">
                              {item.attachment_urls.map((url, index) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={url} src={url} alt={`Comment photo ${index + 1}`} />
                              ))}
                            </div>
                          )}
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
                  <div className={styles.photoUpload}>
                    <label className={styles.photoInput}>
                      <ImagePlus size={16} aria-hidden="true" />
                      <span>Add comment photos</span>
                      <input
                        aria-label="Add comment photos"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        disabled={pending !== null}
                        onChange={(event) => {
                          addPhotos(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                    {commentPhotos.length > 0 && (
                      <ul className={styles.pendingPhotos} aria-label="Selected comment photos">
                        {commentPhotos.map((photo) => (
                          <li key={photo.clientUploadId}>
                            {photo.previewUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={photo.previewUrl} alt="" />
                            ) : (
                              <ImagePlus size={16} aria-hidden="true" />
                            )}
                            <span>{photo.file.name}</span>
                            <button
                              type="button"
                              aria-label={`Remove ${photo.file.name}`}
                              onClick={() => removePhoto(photo.clientUploadId)}
                              disabled={pending !== null}
                            >
                              <X size={14} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
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
