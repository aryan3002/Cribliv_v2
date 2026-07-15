"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@cribliv/ui";
import type {
  PgMaintenanceComment,
  PgMaintenanceInternalNoteResponse,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { ImagePlus, Loader2, X } from "lucide-react";
import {
  addMaintenanceComment,
  fetchMaintenanceTimeline,
  getMaintenanceTicket,
  updateMaintenanceStatus
} from "@/lib/pg-operations-api";
import { useToast } from "@/components/ui/toast/use-toast";
import MaintenanceTicketDetail from "./MaintenanceTicketDetail";
import {
  createMaintenanceUploadId,
  type PendingMaintenancePhoto,
  releaseMaintenancePhotoPreview,
  useMaintenancePhotoUpload
} from "./useMaintenancePhotoUpload";
import styles from "../MaintenanceWorkspace.module.css";

type CommentSubmission = {
  request: PgMaintenanceRequest;
  body: string;
  photos: PendingMaintenancePhoto[];
  idempotencyKey: string;
  optimisticComment: PgMaintenanceComment;
};
type MergeRequestOptions = { preserveCollections?: boolean };

const OPERATOR_TRANSITIONS: Record<PgMaintenanceStatus, PgMaintenanceStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["waiting_on_tenant", "resolved", "cancelled"],
  waiting_on_tenant: ["in_progress"],
  resolved: ["closed"],
  closed: [],
  cancelled: []
};

const STATUS_LABEL: Record<PgMaintenanceStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_on_tenant: "Waiting on tenant",
  resolved: "Resolved",
  closed: "Closed",
  cancelled: "Cancelled"
};

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

export default function MaintenanceTicketPageClient({
  initialRequest,
  propertyId,
  token
}: {
  initialRequest: PgMaintenanceRequest;
  propertyId: string;
  token: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [request, setRequest] = useState(initialRequest);
  const [comment, setComment] = useState("");
  const [commentPhotos, setCommentPhotos] = useState<PendingMaintenancePhoto[]>([]);
  const [requestPhotos, setRequestPhotos] = useState<PendingMaintenancePhoto[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commentIdempotencyKey = useRef<{ requestId: string; key: string } | null>(null);
  const commentPhotosRef = useRef<PendingMaintenancePhoto[]>([]);
  const requestPhotosRef = useRef<PendingMaintenancePhoto[]>([]);
  const requestPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const photoUpload = useMaintenancePhotoUpload({ mode: "operator", propertyId, token });
  const transitions = OPERATOR_TRANSITIONS[request.status];

  useEffect(() => {
    setRequest(initialRequest);
  }, [initialRequest]);

  useEffect(() => {
    commentPhotosRef.current = commentPhotos;
  }, [commentPhotos]);

  useEffect(() => {
    requestPhotosRef.current = requestPhotos;
  }, [requestPhotos]);

  useEffect(
    () => () => {
      commentPhotosRef.current.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
      requestPhotosRef.current.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
    },
    []
  );

  async function reloadTicket(fallback: string) {
    try {
      const [detail, timeline] = await Promise.all([
        getMaintenanceTicket(propertyId, request.id, token),
        fetchMaintenanceTimeline(propertyId, request.id, token)
      ]);
      setRequest((current) => mergeRequest(current, { ...detail, timeline }));
      return true;
    } catch (cause) {
      setError(failureMessage(cause, fallback));
      return false;
    }
  }

  function addCommentPhotos(files: FileList | null) {
    if (!files) return;
    try {
      setCommentPhotos((current) => [...current, ...photoUpload.addFiles(files, current.length)]);
      setError(null);
    } catch (cause) {
      setError(failureMessage(cause, "Could not add these photos."));
    }
  }

  function removeCommentPhoto(clientUploadId: string) {
    setCommentPhotos((current) => photoUpload.removePhoto(current, clientUploadId));
  }

  function addRequestPhotos(files: FileList | null) {
    if (!files) return;
    try {
      setRequestPhotos((current) => [...current, ...photoUpload.addFiles(files, current.length)]);
      setError(null);
    } catch (cause) {
      setError(failureMessage(cause, "Could not add these photos."));
    }
  }

  function removeRequestPhoto(clientUploadId: string) {
    setRequestPhotos((current) => photoUpload.removePhoto(current, clientUploadId));
  }

  function appendComment(nextComment: PgMaintenanceComment) {
    setRequest((current) => ({
      ...current,
      comments: current.comments.some((item) => item.id === nextComment.id)
        ? current.comments.map((item) => (item.id === nextComment.id ? nextComment : item))
        : [...current.comments, nextComment]
    }));
  }

  function replaceComment(optimisticId: string, nextComment?: PgMaintenanceComment) {
    setRequest((current) => ({
      ...current,
      comments: current.comments.flatMap((item) =>
        item.id === optimisticId ? (nextComment ? [nextComment] : []) : [item]
      )
    }));
  }

  function appendInternalNote(note: PgMaintenanceInternalNoteResponse, replaceId?: string) {
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
    setRequest((current) => ({
      ...current,
      timeline: [
        ...(current.timeline ?? []).filter(
          (event) => event.id !== note.id && event.id !== replaceId
        ),
        nextEvent
      ]
    }));
  }

  function removeInternalNote(noteId: string) {
    setRequest((current) => ({
      ...current,
      timeline: (current.timeline ?? []).filter((event) => event.id !== noteId)
    }));
  }

  function rollbackStatus(previous: PgMaintenanceRequest, optimisticStatus: PgMaintenanceStatus) {
    setRequest((current) =>
      current.id === previous.id && current.status === optimisticStatus
        ? { ...current, status: previous.status }
        : current
    );
  }

  async function changeStatus(status: PgMaintenanceStatus, sourceRequest = request) {
    if (pending || !OPERATOR_TRANSITIONS[sourceRequest.status].includes(status)) return;
    setPending(`status:${status}`);
    setError(null);
    const optimistic = { ...sourceRequest, status };
    setRequest((current) => mergeRequest(current, optimistic, { preserveCollections: true }));
    const label = STATUS_LABEL[status];
    try {
      const updated = await updateMaintenanceStatus(propertyId, sourceRequest.id, status, token);
      setRequest((current) => mergeRequest(current, updated));
      await reloadTicket("Ticket updated, but the latest timeline could not be loaded.");
      toast.success(`Ticket ${sourceRequest.id} -> ${label}`);
      router.refresh();
    } catch {
      rollbackStatus(sourceRequest, status);
      toast.error(`Could not move ticket ${sourceRequest.id} to ${label}.`, {
        action: { label: "Retry", onClick: () => void changeStatus(status, sourceRequest) }
      });
    } finally {
      setPending(null);
    }
  }

  async function submitComment(retrySubmission?: CommentSubmission) {
    if (pending) return;
    const sourceRequest = retrySubmission?.request ?? request;
    const body = retrySubmission?.body ?? comment.trim();
    const photos = retrySubmission?.photos ?? commentPhotos;
    if (!body && photos.length === 0) {
      setError("Enter a comment or add a photo before sending.");
      return;
    }

    setPending("comment");
    setError(null);
    const savedKey = commentIdempotencyKey.current;
    const idempotencyKey =
      retrySubmission?.idempotencyKey ??
      (savedKey?.requestId === sourceRequest.id
        ? savedKey.key
        : (commentIdempotencyKey.current = {
            requestId: sourceRequest.id,
            key: createMaintenanceUploadId()
          }).key);
    const optimisticComment =
      retrySubmission?.optimisticComment ??
      ({
        id: `optimistic-comment-${idempotencyKey}`,
        request_id: sourceRequest.id,
        author_user_id: null,
        author_role: "pg_operator",
        body,
        attachments: [],
        attachment_urls: photos
          .map((photo) => photo.previewUrl)
          .filter((url): url is string => Boolean(url)),
        created_at: new Date().toISOString()
      } satisfies PgMaintenanceComment);
    const submission: CommentSubmission = {
      request: sourceRequest,
      body,
      photos,
      idempotencyKey,
      optimisticComment
    };
    appendComment(optimisticComment);

    try {
      const attachments = await photoUpload.uploadForComment(sourceRequest, photos);
      const nextComment = await addMaintenanceComment(
        propertyId,
        sourceRequest.id,
        attachments.length > 0 ? { body, attachments } : { body },
        token,
        idempotencyKey
      );
      replaceComment(optimisticComment.id, nextComment);
      setComment("");
      photos.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
      setCommentPhotos([]);
      commentIdempotencyKey.current = null;
      toast.success(`Added comment to ticket ${sourceRequest.id}`);
      await reloadTicket("Comment saved, but the latest ticket detail could not be loaded.");
      router.refresh();
    } catch {
      replaceComment(optimisticComment.id);
      toast.error(`Could not add comment to ticket ${sourceRequest.id}.`, {
        action: { label: "Retry", onClick: () => void submitComment(submission) }
      });
    } finally {
      setPending(null);
    }
  }

  async function submitRequestPhotos() {
    if (pending) return;
    if (requestPhotos.length === 0) {
      setError("Add at least one ticket photo before saving.");
      return;
    }

    setPending("requestPhotos");
    setError(null);
    try {
      const updated = await photoUpload.uploadForRequest(request, requestPhotos);
      setRequest((current) => mergeRequest(current, updated));
      requestPhotos.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
      setRequestPhotos([]);
      await reloadTicket("Photos saved, but the latest ticket detail could not be loaded.");
      router.refresh();
    } catch (cause) {
      setError(failureMessage(cause, "Could not save these ticket photos."));
    } finally {
      setPending(null);
    }
  }

  async function handleRequestUpdated(
    updated: PgMaintenanceRequest,
    options: { reload?: boolean } = {}
  ) {
    setRequest((current) =>
      mergeRequest(current, updated, { preserveCollections: options.reload === false })
    );
    if (options.reload === false) return;
    await reloadTicket("Ticket updated, but the latest detail could not be loaded.");
    router.refresh();
  }

  return (
    <div className={styles.ticketPageShell}>
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}

      <section className={styles.ticketPhotoPanel} aria-label="Ticket photos">
        <div className={styles.ticketPhotoHeader}>
          <h2>Ticket photos</h2>
          <div className={styles.ticketPhotoActions}>
            <button
              type="button"
              className={styles.ticketPhotoButton}
              disabled={pending !== null}
              onClick={() => requestPhotoInputRef.current?.click()}
            >
              <ImagePlus size={16} aria-hidden="true" />
              Add ticket photos
            </button>
            <input
              ref={requestPhotoInputRef}
              className={styles.requestPhotoInput}
              aria-label="Select ticket photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={pending !== null}
              onChange={(event) => {
                addRequestPhotos(event.target.files);
                event.target.value = "";
              }}
            />
            {requestPhotos.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                disabled={pending !== null}
                onClick={() => void submitRequestPhotos()}
              >
                {pending === "requestPhotos" ? <Loader2 size={16} className={styles.spin} /> : null}
                Save ticket photos
              </Button>
            ) : null}
          </div>
        </div>
        {requestPhotos.length > 0 ? (
          <ul className={styles.pendingPhotos} aria-label="Selected ticket photos">
            {requestPhotos.map((photo) => (
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
                  onClick={() => removeRequestPhoto(photo.clientUploadId)}
                  disabled={pending !== null}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className={styles.ticketDetailSurface} aria-label="Maintenance ticket detail">
        <MaintenanceTicketDetail
          request={request}
          mode="operator"
          propertyId={propertyId}
          token={token}
          transitions={transitions}
          pending={pending}
          detailLoading={false}
          comment={comment}
          commentPhotos={commentPhotos}
          onCommentChange={setComment}
          onAddCommentPhotos={addCommentPhotos}
          onRemoveCommentPhoto={removeCommentPhoto}
          onSubmitComment={() => void submitComment()}
          onStatusChange={(status) => void changeStatus(status)}
          onRequestUpdated={(updated, options) => void handleRequestUpdated(updated, options)}
          onInternalNoteCreated={(note, replaceId) => {
            appendInternalNote(note, replaceId);
            if (replaceId) {
              void reloadTicket(
                "Internal note saved, but the latest timeline could not be loaded."
              );
              router.refresh();
            }
          }}
          onInternalNoteRollback={removeInternalNote}
        />
      </section>
    </div>
  );
}
