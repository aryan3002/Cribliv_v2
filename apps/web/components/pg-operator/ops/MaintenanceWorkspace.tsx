"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, type BadgeTone } from "@cribliv/ui";
import type {
  PgMaintenanceComment,
  PgMaintenanceRequest,
  PgMaintenanceStatus
} from "@cribliv/shared-types";
import { ClipboardList, ImagePlus, Loader2, MessageSquarePlus, Wrench, X } from "lucide-react";
import {
  addMaintenanceComment,
  addResidenceMaintenanceComment,
  completeMaintenancePhotos,
  completeResidenceMaintenancePhotos,
  createResidenceMaintenance,
  presignMaintenancePhotos,
  presignResidenceMaintenancePhotos,
  updateMaintenanceStatus
} from "@/lib/pg-operations-api";
import styles from "./MaintenanceWorkspace.module.css";

type MaintenanceMode = "operator" | "tenant";
type TicketFilter = "all" | PgMaintenanceStatus;
type PendingPhoto = {
  clientUploadId: string;
  file: File;
  previewUrl: string | null;
};

const MINIMUM_DESCRIPTION_LENGTH = 10;
const MAX_PHOTOS_PER_UPLOAD = 6;
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAINTENANCE_CATEGORIES = [
  "Plumbing",
  "Electrical",
  "Internet/Wi-Fi",
  "Appliance",
  "Furniture",
  "Cleaning",
  "Pest control",
  "Water supply",
  "Power backup",
  "Food/Mess",
  "Security",
  "Room access/keys",
  "Noise/roommate",
  "Billing",
  "Other"
] as const;

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

function createPreviewUrl(file: File): string | null {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  return URL.createObjectURL(file);
}

function releasePreviewUrl(value: string | null) {
  if (!value || typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") return;
  URL.revokeObjectURL(value);
}

function buildPendingPhotos(files: FileList | File[], existingCount: number): PendingPhoto[] {
  const availableSlots = MAX_PHOTOS_PER_UPLOAD - existingCount;
  if (availableSlots <= 0) {
    throw new Error(`Add up to ${MAX_PHOTOS_PER_UPLOAD} photos.`);
  }
  const selected = Array.from(files).slice(0, availableSlots);
  if (selected.length === 0) return [];
  for (const file of selected) {
    if (!ACCEPTED_PHOTO_TYPES.has(file.type)) {
      throw new Error("Upload JPG, PNG, or WebP photos only.");
    }
    if (file.size > MAX_PHOTO_SIZE_BYTES) {
      throw new Error("Each photo must be 10 MB or smaller.");
    }
  }
  return selected.map((file) => ({
    clientUploadId: createIdempotencyKey(),
    file,
    previewUrl: createPreviewUrl(file)
  }));
}

async function uploadBlob(uploadUrl: string, file: File) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      "x-ms-blob-type": "BlockBlob"
    },
    body: file
  });
  if (!response.ok) {
    throw new Error("Could not upload one of the selected photos.");
  }
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
  const [otherCategory, setOtherCategory] = useState("");
  const [description, setDescription] = useState("");
  const [createPhotos, setCreatePhotos] = useState<PendingPhoto[]>([]);
  const [commentPhotos, setCommentPhotos] = useState<PendingPhoto[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commentIdempotencyKey = useRef<{ requestId: string; key: string } | null>(null);
  const createIdempotencyKeyRef = useRef<string | null>(null);
  const createPhotosRef = useRef<PendingPhoto[]>([]);
  const commentPhotosRef = useRef<PendingPhoto[]>([]);

  useEffect(() => {
    setRequests(initialRequests);
    setSelectedId((current) => {
      if (current && initialRequests.some((request) => request.id === current)) return current;
      return initialRequests[0]?.id ?? null;
    });
  }, [initialRequests]);

  useEffect(() => {
    createPhotosRef.current = createPhotos;
  }, [createPhotos]);

  useEffect(() => {
    commentPhotosRef.current = commentPhotos;
  }, [commentPhotos]);

  useEffect(
    () => () => {
      createPhotosRef.current.forEach((photo) => releasePreviewUrl(photo.previewUrl));
      commentPhotosRef.current.forEach((photo) => releasePreviewUrl(photo.previewUrl));
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

  function addPhotos(target: "create" | "comment", files: FileList | null) {
    if (!files) return;
    try {
      if (target === "create") {
        const next = buildPendingPhotos(files, createPhotos.length);
        setCreatePhotos((current) => [...current, ...next]);
      } else {
        const next = buildPendingPhotos(files, commentPhotos.length);
        setCommentPhotos((current) => [...current, ...next]);
      }
      setError(null);
    } catch (cause) {
      setError(failureMessage(cause, "Could not add these photos."));
    }
  }

  function removePhoto(target: "create" | "comment", clientUploadId: string) {
    const remove = (photos: PendingPhoto[]) => {
      const removed = photos.find((photo) => photo.clientUploadId === clientUploadId);
      releasePreviewUrl(removed?.previewUrl ?? null);
      return photos.filter((photo) => photo.clientUploadId !== clientUploadId);
    };
    if (target === "create") {
      setCreatePhotos(remove);
    } else {
      setCommentPhotos(remove);
    }
  }

  async function presignAndUploadPhotos(request: PgMaintenanceRequest, photos: PendingPhoto[]) {
    if (photos.length === 0) return [];
    const files = photos.map((photo) => ({
      clientUploadId: photo.clientUploadId,
      contentType: photo.file.type,
      sizeBytes: photo.file.size
    }));
    const presign =
      mode === "operator"
        ? propertyId
          ? await presignMaintenancePhotos(
              propertyId,
              request.id,
              files,
              token,
              createIdempotencyKey()
            )
          : null
        : await presignResidenceMaintenancePhotos(request.id, files, token, createIdempotencyKey());
    if (!presign) throw new Error("Could not prepare photo uploads.");

    const photosByClientId = new Map(photos.map((photo) => [photo.clientUploadId, photo]));
    await Promise.all(
      presign.uploads.map((upload, index) => {
        const pendingPhoto = photosByClientId.get(upload.clientUploadId) ?? photos[index];
        if (!pendingPhoto) throw new Error("Could not match one of the selected photos.");
        return uploadBlob(upload.uploadUrl, pendingPhoto.file);
      })
    );

    return presign.uploads.map((upload) => ({
      clientUploadId: upload.clientUploadId,
      blobPath: upload.blobPath
    }));
  }

  async function attachPhotosToRequest(
    request: PgMaintenanceRequest,
    photos: PendingPhoto[]
  ): Promise<PgMaintenanceRequest> {
    if (photos.length === 0) return request;
    const completed = await presignAndUploadPhotos(request, photos);
    return mode === "operator"
      ? propertyId
        ? completeMaintenancePhotos(
            propertyId,
            request.id,
            completed,
            token,
            createIdempotencyKey()
          )
        : request
      : completeResidenceMaintenancePhotos(request.id, completed, token, createIdempotencyKey());
  }

  async function uploadCommentAttachments(request: PgMaintenanceRequest, photos: PendingPhoto[]) {
    if (photos.length === 0) return [];
    const uploaded = await presignAndUploadPhotos(request, photos);
    return uploaded.map((photo) => photo.blobPath);
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
        : (commentIdempotencyKey.current = { requestId: selected.id, key: createIdempotencyKey() })
            .key;

    try {
      const attachments = await uploadCommentAttachments(selected, commentPhotos);
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
      commentPhotos.forEach((photo) => releasePreviewUrl(photo.previewUrl));
      setCommentPhotos([]);
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
    const nextCategory = category === "Other" ? otherCategory.trim() : category.trim();
    const nextDescription = description.trim();
    if (!nextCategory) {
      setError(
        category === "Other" ? "Enter the issue category." : "Choose a maintenance category."
      );
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
      const createdBase = await createResidenceMaintenance(
        { category: nextCategory, description: nextDescription },
        token,
        idempotencyKey
      );
      let created = createdBase;
      let photoUploadError: string | null = null;
      if (createPhotos.length > 0) {
        try {
          created = await attachPhotosToRequest(createdBase, createPhotos);
        } catch (cause) {
          photoUploadError = `Ticket raised, but photos could not be uploaded. ${failureMessage(
            cause,
            "Add them in a comment."
          )}`;
        }
      }
      setRequests((current) => [created, ...current]);
      setSelectedId(created.id);
      setCategory("");
      setOtherCategory("");
      setDescription("");
      createPhotos.forEach((photo) => releasePreviewUrl(photo.previewUrl));
      setCreatePhotos([]);
      createIdempotencyKeyRef.current = null;
      if (photoUploadError) {
        setError(photoUploadError);
      }
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
              <select
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value);
                  if (event.target.value !== "Other") setOtherCategory("");
                }}
                disabled={pending !== null}
              >
                <option value="">Choose category</option>
                {MAINTENANCE_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            {category === "Other" && (
              <label>
                <span>Issue category</span>
                <input
                  value={otherCategory}
                  onChange={(event) => setOtherCategory(event.target.value)}
                  placeholder="Example: Lift"
                  disabled={pending !== null}
                />
              </label>
            )}
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
          <div className={styles.photoUpload}>
            <label className={styles.photoInput}>
              <ImagePlus size={16} aria-hidden="true" />
              <span>Add photos</span>
              <input
                aria-label="Add photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                disabled={pending !== null}
                onChange={(event) => {
                  addPhotos("create", event.target.files);
                  event.target.value = "";
                }}
              />
            </label>
            {createPhotos.length > 0 && (
              <ul className={styles.pendingPhotos} aria-label="Selected ticket photos">
                {createPhotos.map((photo) => (
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
                      onClick={() => removePhoto("create", photo.clientUploadId)}
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
                    commentPhotos.forEach((photo) => releasePreviewUrl(photo.previewUrl));
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
                          addPhotos("comment", event.target.files);
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
                              onClick={() => removePhoto("comment", photo.clientUploadId)}
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
