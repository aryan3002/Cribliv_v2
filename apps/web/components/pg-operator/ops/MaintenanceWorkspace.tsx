"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, type BadgeTone } from "@cribliv/ui";
import type {
  PgMaintenanceComment,
  PgMaintenanceCategory,
  PgMaintenanceInternalNoteResponse,
  PgMaintenanceLocation,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { ClipboardList } from "lucide-react";
import { useToast } from "@/components/ui/toast/use-toast";
import {
  addMaintenanceComment,
  addResidenceMaintenanceComment,
  fetchMaintenanceTimeline,
  getMaintenanceTicket,
  getResidenceMaintenanceTicket,
  updateMaintenanceStatus
} from "@/lib/pg-operations-api";
import MaintenanceCreateForm from "./maintenance/MaintenanceCreateForm";
import MaintenanceTicketDetail from "./maintenance/MaintenanceTicketDetail";
import { FALLBACK_MAINTENANCE_CATEGORIES } from "./maintenance/maintenance-constants";
import {
  createMaintenanceUploadId,
  type PendingMaintenancePhoto,
  releaseMaintenancePhotoPreview,
  useMaintenancePhotoUpload
} from "./maintenance/useMaintenancePhotoUpload";
import styles from "./MaintenanceWorkspace.module.css";

type MaintenanceMode = "operator" | "tenant";
type TicketFilter = "active" | "all" | PgMaintenanceStatus;
type CommentSubmission = {
  request: PgMaintenanceRequest;
  body: string;
  photos: PendingMaintenancePhoto[];
  idempotencyKey: string;
  optimisticComment: PgMaintenanceComment;
};
type MergeRequestOptions = { preserveCollections?: boolean };
const ACTIVE_STATUSES: readonly PgMaintenanceStatus[] = [
  "open",
  "in_progress",
  "waiting_on_tenant",
  "resolved"
];

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
  updated: PgMaintenanceRequest,
  options: MergeRequestOptions = {}
): PgMaintenanceRequest {
  return {
    ...updated,
    comments: options.preserveCollections
      ? previous.comments
      : updated.comments.length > 0
        ? updated.comments
        : previous.comments,
    timeline: options.preserveCollections
      ? previous.timeline
      : (updated.timeline ?? previous.timeline)
  };
}

export default function MaintenanceWorkspace({
  initialRequests,
  mode,
  propertyId,
  token,
  compact = false,
  categories = FALLBACK_MAINTENANCE_CATEGORIES,
  currentResidenceLocation = null,
  readOnly = false
}: {
  initialRequests: PgMaintenanceRequest[];
  mode: MaintenanceMode;
  propertyId?: string;
  token: string;
  compact?: boolean;
  categories?: PgMaintenanceCategory[];
  currentResidenceLocation?: PgMaintenanceLocation | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [requests, setRequests] = useState(initialRequests);
  const [selectedId, setSelectedId] = useState<string | null>(initialRequests[0]?.id ?? null);
  const [filter, setFilter] = useState<TicketFilter>("active");
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

  const visibleRequests = useMemo(() => {
    if (filter === "all") return requests;
    if (filter === "active") {
      return requests.filter((request) => ACTIVE_STATUSES.includes(request.status));
    }
    return requests.filter((request) => request.status === filter);
  }, [filter, requests]);
  useEffect(() => {
    setSelectedId((current) => {
      if (current && visibleRequests.some((request) => request.id === current)) return current;
      return visibleRequests[0]?.id ?? null;
    });
  }, [visibleRequests]);

  const selected = visibleRequests.find((request) => request.id === selectedId) ?? null;
  const transitions = selected && mode === "operator" ? OPERATOR_TRANSITIONS[selected.status] : [];
  const showDetailPane = Boolean(selected) || !compact || visibleRequests.length > 0;

  function replaceRequest(updated: PgMaintenanceRequest, options?: MergeRequestOptions) {
    setRequests((current) =>
      current.map((request) =>
        request.id === updated.id ? mergeRequest(request, updated, options) : request
      )
    );
  }

  function appendComment(requestId: string, nextComment: PgMaintenanceComment) {
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? {
              ...request,
              comments: request.comments.some((item) => item.id === nextComment.id)
                ? request.comments.map((item) => (item.id === nextComment.id ? nextComment : item))
                : [...request.comments, nextComment]
            }
          : request
      )
    );
  }

  function replaceComment(
    requestId: string,
    optimisticId: string,
    nextComment?: PgMaintenanceComment
  ) {
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? {
              ...request,
              comments: request.comments.flatMap((item) =>
                item.id === optimisticId ? (nextComment ? [nextComment] : []) : [item]
              )
            }
          : request
      )
    );
  }

  function rollbackStatus(
    requestId: string,
    previousStatus: PgMaintenanceStatus,
    optimisticStatus: PgMaintenanceStatus
  ) {
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId && request.status === optimisticStatus
          ? {
              ...request,
              status: previousStatus
            }
          : request
      )
    );
  }

  function appendInternalNote(
    requestId: string,
    note: PgMaintenanceInternalNoteResponse,
    replaceId?: string
  ) {
    const nextEvent = {
      id: note.id,
      request_id: note.request_id,
      event_type: "internal_note_added" as const,
      visibility: note.visibility,
      actor_user_id: note.author_user_id,
      actor_role: note.author_role,
      from_status: null,
      to_status: null,
      payload: { body: note.body, attachments: note.attachments },
      created_at: note.created_at
    };
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? {
              ...request,
              timeline: [
                ...(request.timeline ?? []).filter(
                  (event) => event.id !== note.id && event.id !== replaceId
                ),
                nextEvent
              ]
            }
          : request
      )
    );
  }

  function removeInternalNote(requestId: string, noteId: string) {
    setRequests((current) =>
      current.map((request) =>
        request.id === requestId
          ? {
              ...request,
              timeline: (request.timeline ?? []).filter((event) => event.id !== noteId)
            }
          : request
      )
    );
  }

  useEffect(() => {
    if (!selectedId) return;
    if (selected?.timeline !== undefined) return;
    const requestId = selectedId;
    let active = true;
    async function loadDetail() {
      try {
        const detail =
          mode === "operator"
            ? propertyId
              ? await getMaintenanceTicket(propertyId, requestId, token)
              : null
            : await getResidenceMaintenanceTicket(requestId, token);
        if (!detail || !active) return;
        const timeline =
          mode === "operator" && propertyId
            ? await fetchMaintenanceTimeline(propertyId, requestId, token)
            : (detail.timeline ?? []);
        if (!active) return;
        replaceRequest({ ...detail, timeline });
      } catch (cause) {
        if (!active) return;
        setError(failureMessage(cause, "Could not load this maintenance ticket."));
      }
    }
    void loadDetail();
    return () => {
      active = false;
    };
  }, [mode, propertyId, selected?.timeline, selectedId, token]);

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

  async function changeStatus(status: PgMaintenanceStatus, request = selected) {
    if (!request || mode !== "operator" || !propertyId || pending) return;
    if (!OPERATOR_TRANSITIONS[request.status].includes(status)) return;

    setPending(`status:${status}`);
    setError(null);
    const optimistic = { ...request, status };
    replaceRequest(optimistic, { preserveCollections: true });
    const label = STATUS_LABEL[status];
    try {
      replaceRequest(await updateMaintenanceStatus(propertyId, request.id, status, token));
      toast.success(`Ticket ${request.id} -> ${label}`);
      router.refresh();
    } catch {
      rollbackStatus(request.id, request.status, status);
      toast.error(`Could not move ticket ${request.id} to ${label}.`, {
        action: { label: "Retry", onClick: () => void changeStatus(status, request) }
      });
    } finally {
      setPending(null);
    }
  }

  async function submitComment(retrySubmission?: CommentSubmission) {
    const request = retrySubmission?.request ?? selected;
    if (!request || pending || readOnly) return;
    const body = retrySubmission?.body ?? comment.trim();
    const photos = retrySubmission?.photos ?? commentPhotos;
    if (!body && photos.length === 0) {
      setError("Enter a comment or add a photo before sending.");
      return;
    }

    const savedKey = commentIdempotencyKey.current;
    const idempotencyKey =
      retrySubmission?.idempotencyKey ??
      (savedKey?.requestId === request.id
        ? savedKey.key
        : (commentIdempotencyKey.current = {
            requestId: request.id,
            key: createMaintenanceUploadId()
          }).key);
    const optimisticComment =
      retrySubmission?.optimisticComment ??
      ({
        id: `optimistic-comment-${idempotencyKey}`,
        request_id: request.id,
        author_user_id: null,
        author_role: mode === "operator" ? "pg_operator" : "tenant",
        body,
        attachments: [],
        attachment_urls: photos
          .map((photo) => photo.previewUrl)
          .filter((url): url is string => Boolean(url)),
        created_at: new Date().toISOString()
      } satisfies PgMaintenanceComment);
    const submission: CommentSubmission = {
      request,
      body,
      photos,
      idempotencyKey,
      optimisticComment
    };

    setPending("comment");
    setError(null);
    appendComment(request.id, optimisticComment);

    try {
      const attachments = await photoUpload.uploadForComment(request, photos);
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
            ? await addMaintenanceComment(propertyId, request.id, payload, token, idempotencyKey)
            : null
          : await addResidenceMaintenanceComment(request.id, payload, token, idempotencyKey);
      if (!nextComment) throw new Error("Could not add this maintenance comment.");
      replaceComment(request.id, optimisticComment.id, nextComment);
      setComment("");
      photos.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
      setCommentPhotos([]);
      commentIdempotencyKey.current = null;
      toast.success(`Added comment to ticket ${request.id}`);
      router.refresh();
    } catch {
      replaceComment(request.id, optimisticComment.id);
      toast.error(`Could not add comment to ticket ${request.id}.`, {
        action: { label: "Retry", onClick: () => void submitComment(submission) }
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <div className={`${styles.workspace} ${compact ? styles.compact : ""}`}>
      {mode === "tenant" && !readOnly && (
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
              <span>{visibleRequests.length} total</span>
            </div>
            <label className={styles.filterField}>
              <span className={styles.srOnly}>Filter tickets</span>
              <select
                aria-label="Filter tickets"
                value={filter}
                onChange={(event) => setFilter(event.target.value as TicketFilter)}
              >
                <option value="active">Active work</option>
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
              <MaintenanceTicketDetail
                request={selected}
                mode={mode}
                propertyId={propertyId}
                token={token}
                transitions={transitions}
                pending={pending}
                detailLoading={selected.timeline === undefined}
                comment={comment}
                commentPhotos={commentPhotos}
                readOnly={readOnly}
                onCommentChange={setComment}
                onAddCommentPhotos={addPhotos}
                onRemoveCommentPhoto={removePhoto}
                onSubmitComment={() => void submitComment()}
                onStatusChange={(status) => void changeStatus(status)}
                onRequestUpdated={(updated, options) => {
                  replaceRequest(updated, { preserveCollections: options?.reload === false });
                  if (options?.reload !== false) router.refresh();
                }}
                onInternalNoteCreated={(note, replaceId) => {
                  appendInternalNote(selected.id, note, replaceId);
                  if (replaceId) router.refresh();
                }}
                onInternalNoteRollback={(noteId) => removeInternalNote(selected.id, noteId)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
