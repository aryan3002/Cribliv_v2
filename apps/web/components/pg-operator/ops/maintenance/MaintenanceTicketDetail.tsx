"use client";

import { useEffect, useState } from "react";
import { Badge, Button, type BadgeTone } from "@cribliv/ui";
import type {
  PgMaintenanceComment,
  PgMaintenanceInternalNoteResponse,
  PgMaintenancePriority,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { ImagePlus, Loader2, MessageSquarePlus, X } from "lucide-react";
import { overrideMaintenancePriority } from "@/lib/pg-operations-api";
import MaintenanceInternalNotes from "./MaintenanceInternalNotes";
import MaintenanceResolutionSheet from "./MaintenanceResolutionSheet";
import MaintenanceTimeline from "./MaintenanceTimeline";
import {
  createMaintenanceUploadId,
  type PendingMaintenancePhoto
} from "./useMaintenancePhotoUpload";
import styles from "../MaintenanceWorkspace.module.css";

type MaintenanceMode = "operator" | "tenant";

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

const PRIORITY_LABEL: Record<PgMaintenancePriority, string> = {
  emergency: "Emergency",
  high: "High",
  normal: "Normal",
  low: "Low"
};

const ACTION_LABEL: Partial<Record<PgMaintenanceStatus, string>> = {
  in_progress: "Start work",
  waiting_on_tenant: "Wait for tenant",
  closed: "Close ticket",
  cancelled: "Cancel ticket"
};

const PRIORITIES: PgMaintenancePriority[] = ["emergency", "high", "normal", "low"];

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
}

function rupees(value: number | null): string {
  if (value === null) return "Not recorded";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(value / 100);
}

function locationLabel(request: PgMaintenanceRequest): string {
  const location = request.location;
  const snapshot = request.location_snapshot;
  const room = location?.room_number ?? snapshot.room_number;
  const bed = location?.bed_label ?? snapshot.bed_label;
  if (room && bed) return `Room ${room} · Bed ${bed}`;
  if (room) return `Room ${room}`;
  if (snapshot.floor !== null) return `Floor ${snapshot.floor}`;
  if (snapshot.common_area) return snapshot.common_area.replaceAll("_", " ");
  if (snapshot.detail) return snapshot.detail;
  return snapshot.kind.replaceAll("_", " ");
}

export default function MaintenanceTicketDetail({
  request,
  mode,
  propertyId,
  token,
  transitions,
  pending,
  comment,
  commentPhotos,
  readOnly = false,
  onCommentChange,
  onAddCommentPhotos,
  onRemoveCommentPhoto,
  onSubmitComment,
  onStatusChange,
  onRequestUpdated,
  onInternalNoteCreated
}: {
  request: PgMaintenanceRequest;
  mode: MaintenanceMode;
  propertyId?: string;
  token: string;
  transitions: PgMaintenanceStatus[];
  pending: string | null;
  comment: string;
  commentPhotos: PendingMaintenancePhoto[];
  readOnly?: boolean;
  onCommentChange: (value: string) => void;
  onAddCommentPhotos: (files: FileList | null) => void;
  onRemoveCommentPhoto: (clientUploadId: string) => void;
  onSubmitComment: () => void;
  onStatusChange: (status: PgMaintenanceStatus) => void;
  onRequestUpdated: (request: PgMaintenanceRequest) => void;
  onInternalNoteCreated: (note: PgMaintenanceInternalNoteResponse) => void;
}) {
  const [showResolution, setShowResolution] = useState(false);
  const [showPriority, setShowPriority] = useState(false);
  const [priority, setPriority] = useState<PgMaintenancePriority>(request.priority);
  const [priorityReason, setPriorityReason] = useState("");
  const [priorityPending, setPriorityPending] = useState(false);
  const [priorityError, setPriorityError] = useState<string | null>(null);
  const selectedLocation = request.location;
  const operatorCanResolve = mode === "operator" && propertyId && transitions.includes("resolved");

  useEffect(() => {
    setShowResolution(false);
    setShowPriority(false);
    setPriority(request.priority);
    setPriorityReason("");
    setPriorityPending(false);
    setPriorityError(null);
  }, [request.id, request.priority]);

  async function submitPriority() {
    if (!propertyId || priorityPending) return;
    const reason = priorityReason.trim();
    if (!reason) {
      setPriorityError("Enter a priority override reason.");
      return;
    }
    setPriorityPending(true);
    setPriorityError(null);
    try {
      onRequestUpdated(
        await overrideMaintenancePriority(
          propertyId,
          request.id,
          { priority, reason },
          token,
          createMaintenanceUploadId()
        )
      );
      setShowPriority(false);
      setPriorityReason("");
    } catch (cause) {
      setPriorityError(cause instanceof Error ? cause.message : "Could not override priority.");
    } finally {
      setPriorityPending(false);
    }
  }

  return (
    <>
      <div className={styles.ticketDetailHeader}>
        <div>
          <h3>{request.category}</h3>
          <time dateTime={request.created_at}>Raised {displayDate(request.created_at)}</time>
        </div>
        <Badge tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Badge>
      </div>

      <dl className={styles.summaryGrid}>
        <div>
          <dt>Ticket ID</dt>
          <dd>{request.id}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{PRIORITY_LABEL[request.priority]}</dd>
        </div>
        <div>
          <dt>SLA</dt>
          <dd className={request.is_overdue ? styles.dangerText : undefined}>
            Due {displayDate(request.sla_due_at)}
          </dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{request.category_label_snapshot || request.category}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{locationLabel(request)}</dd>
        </div>
      </dl>

      <section className={styles.detailSection} aria-label="Issue">
        <h4>Issue</h4>
        <p className={styles.detailDescription}>{request.description}</p>
        {request.photo_urls.length > 0 ? (
          <div className={styles.photoGrid} aria-label="Maintenance photos">
            {request.photo_urls.map((url, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt={`Maintenance photo ${index + 1}`} />
            ))}
          </div>
        ) : null}
        <dl className={styles.locationGrid}>
          <div>
            <dt>Location snapshot</dt>
            <dd>{locationLabel(request)}</dd>
          </div>
          {selectedLocation?.tenant_name ? (
            <div>
              <dt>Tenant</dt>
              <dd>{selectedLocation.tenant_name}</dd>
            </div>
          ) : null}
          {selectedLocation?.floor !== null && selectedLocation?.floor !== undefined ? (
            <div>
              <dt>Floor</dt>
              <dd>Floor {selectedLocation.floor}</dd>
            </div>
          ) : null}
          {selectedLocation?.tenant_phone_e164 ? (
            <div>
              <dt>Phone</dt>
              <dd>{selectedLocation.tenant_phone_e164}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {mode === "operator" && propertyId ? (
        <section className={styles.transitionSection} aria-label="Ticket actions">
          <span>Available actions</span>
          {transitions.length === 0 ? (
            <p>No further status actions are available.</p>
          ) : (
            <div className={styles.transitionActions}>
              {transitions.map((status) =>
                status === "resolved" ? (
                  <Button
                    key={status}
                    type="button"
                    variant="secondary"
                    disabled={pending !== null}
                    onClick={() => setShowResolution((current) => !current)}
                  >
                    Resolve
                  </Button>
                ) : (
                  <Button
                    key={status}
                    type="button"
                    variant={status === "cancelled" ? "tertiary" : "secondary"}
                    disabled={pending !== null}
                    onClick={() => onStatusChange(status)}
                  >
                    {pending === `status:${status}` ? (
                      <Loader2 size={15} className={styles.spin} />
                    ) : null}
                    {ACTION_LABEL[status] ?? STATUS_LABEL[status]}
                  </Button>
                )
              )}
              <Button
                type="button"
                variant="tertiary"
                disabled={pending !== null}
                onClick={() => setShowPriority((current) => !current)}
              >
                Override priority
              </Button>
            </div>
          )}
          {showResolution && operatorCanResolve ? (
            <MaintenanceResolutionSheet
              request={request}
              propertyId={propertyId}
              token={token}
              onResolved={(updated) => {
                setShowResolution(false);
                onRequestUpdated(updated);
              }}
            />
          ) : null}
          {showPriority ? (
            <div className={styles.priorityOverride}>
              {priorityError ? (
                <p role="alert" className={styles.error}>
                  {priorityError}
                </p>
              ) : null}
              <label>
                <span>Priority</span>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as PgMaintenancePriority)}
                  disabled={priorityPending}
                >
                  {PRIORITIES.map((item) => (
                    <option key={item} value={item}>
                      {PRIORITY_LABEL[item]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Reason</span>
                <textarea
                  value={priorityReason}
                  onChange={(event) => setPriorityReason(event.target.value)}
                  rows={2}
                  disabled={priorityPending}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                disabled={priorityPending}
                onClick={() => void submitPriority()}
              >
                {priorityPending ? <Loader2 size={15} className={styles.spin} /> : null}
                Save priority
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={styles.commentSection} aria-label="Ticket comments">
        <div className={styles.commentHeading}>
          <h4>Public thread</h4>
          <MessageSquarePlus size={16} aria-hidden="true" />
        </div>
        {request.comments.length === 0 ? (
          <p className={styles.noComments}>No comments yet.</p>
        ) : (
          <ol className={styles.comments}>
            {request.comments.map((item: PgMaintenanceComment) => (
              <li key={item.id}>
                <div>
                  <strong>{item.author_role.replaceAll("_", " ")}</strong>
                  <time dateTime={item.created_at}>{displayDate(item.created_at)}</time>
                </div>
                <p>{item.body}</p>
                {item.attachment_urls.length > 0 ? (
                  <div className={styles.commentPhotos} aria-label="Comment photos">
                    {item.attachment_urls.map((url, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={url} src={url} alt={`Comment photo ${index + 1}`} />
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {!readOnly ? (
          <>
            <label className={styles.commentForm}>
              <span>Add comment</span>
              <textarea
                value={comment}
                onChange={(event) => onCommentChange(event.target.value)}
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
                    onAddCommentPhotos(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
              {commentPhotos.length > 0 ? (
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
                        onClick={() => onRemoveCommentPhoto(photo.clientUploadId)}
                        disabled={pending !== null}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <div className={styles.formActions}>
              <Button
                type="button"
                variant="secondary"
                disabled={pending !== null}
                onClick={onSubmitComment}
              >
                {pending === "comment" ? <Loader2 size={16} className={styles.spin} /> : null}
                Send comment
              </Button>
            </div>
          </>
        ) : null}
      </section>

      {mode === "operator" && propertyId ? (
        <MaintenanceInternalNotes
          key={request.id}
          request={request}
          propertyId={propertyId}
          token={token}
          onCreated={onInternalNoteCreated}
        />
      ) : null}

      <section className={styles.detailSection} aria-label="Timeline">
        <h4>Timeline</h4>
        <MaintenanceTimeline events={request.timeline ?? []} mode={mode} />
      </section>

      {request.resolution_note ? (
        <section className={styles.detailSection} aria-label="Resolution">
          <h4>Resolution</h4>
          <dl className={styles.resolutionCard}>
            <div>
              <dt>Note</dt>
              <dd>{request.resolution_note}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>{rupees(request.resolution_cost_paise)}</dd>
            </div>
            <div>
              <dt>Chargeable damage</dt>
              <dd>{request.chargeable_damage ? "Yes" : "No"}</dd>
            </div>
          </dl>
          {request.fix_photo_urls.length > 0 ? (
            <div className={styles.photoGrid} aria-label="Fix photos">
              {request.fix_photo_urls.map((url, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={url} src={url} alt={`Fix photo ${index + 1}`} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
