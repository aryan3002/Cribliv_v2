"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@cribliv/ui";
import type { PgMaintenanceRequest } from "@cribliv/shared-types";
import { ImagePlus, Loader2, X } from "lucide-react";
import { resolveMaintenanceTicket } from "@/lib/pg-operations-api";
import { useToast } from "@/components/ui/toast/use-toast";
import {
  createMaintenanceUploadId,
  type PendingMaintenancePhoto,
  releaseMaintenancePhotoPreview,
  useMaintenancePhotoUpload
} from "./useMaintenancePhotoUpload";
import styles from "../MaintenanceWorkspace.module.css";

function paiseFromRupees(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) return NaN;
  return Math.round(numeric * 100);
}

type ResolutionSubmission = {
  note: string;
  costPaise: number | null;
  chargeableDamage: boolean;
  photos: PendingMaintenancePhoto[];
  idempotencyKey: string;
  optimisticRequest: PgMaintenanceRequest;
};

export default function MaintenanceResolutionSheet({
  request,
  propertyId,
  token,
  onResolved,
  onOptimisticResolved,
  onRollback,
  onPendingChange
}: {
  request: PgMaintenanceRequest;
  propertyId: string;
  token: string;
  onResolved: (request: PgMaintenanceRequest) => void;
  onOptimisticResolved?: (request: PgMaintenanceRequest) => void;
  onRollback?: (request: PgMaintenanceRequest, optimisticRequest: PgMaintenanceRequest) => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");
  const [chargeableDamage, setChargeableDamage] = useState<boolean | null>(null);
  const [photos, setPhotos] = useState<PendingMaintenancePhoto[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(createMaintenanceUploadId());
  const pendingRef = useRef(false);
  const photosRef = useRef<PendingMaintenancePhoto[]>([]);
  const photoUpload = useMaintenancePhotoUpload({ mode: "operator", propertyId, token });

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      photosRef.current.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
    },
    []
  );

  function addPhotos(files: FileList | null) {
    if (!files) return;
    try {
      setPhotos((current) => [...current, ...photoUpload.addFiles(files, current.length)]);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add these photos.");
    }
  }

  function removePhoto(clientUploadId: string) {
    setPhotos((current) => photoUpload.removePhoto(current, clientUploadId));
  }

  async function submit(retrySubmission?: ResolutionSubmission) {
    if (pendingRef.current) return;
    const trimmedNote = retrySubmission?.note ?? note.trim();
    if (!trimmedNote) {
      setError("Enter a resolution note.");
      return;
    }
    const costPaise = retrySubmission ? retrySubmission.costPaise : paiseFromRupees(cost);
    if (Number.isNaN(costPaise) || (costPaise !== null && costPaise < 0)) {
      setError("Enter a cost of 0 or more.");
      return;
    }
    const nextChargeableDamage = retrySubmission?.chargeableDamage ?? chargeableDamage;
    if (nextChargeableDamage === null) {
      setError("Select whether this was chargeable damage.");
      return;
    }
    const nextPhotos = retrySubmission?.photos ?? photos;
    const optimisticRequest =
      retrySubmission?.optimisticRequest ??
      ({
        ...request,
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_note: trimmedNote,
        resolution_source: "operator",
        resolution_cost_paise: costPaise,
        chargeable_damage: nextChargeableDamage,
        fix_photo_urls: nextPhotos
          .map((photo) => photo.previewUrl)
          .filter((url): url is string => Boolean(url))
      } satisfies PgMaintenanceRequest);
    const submission: ResolutionSubmission = {
      note: trimmedNote,
      costPaise,
      chargeableDamage: nextChargeableDamage,
      photos: nextPhotos,
      idempotencyKey: retrySubmission?.idempotencyKey ?? idempotencyKey.current,
      optimisticRequest
    };

    pendingRef.current = true;
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    onOptimisticResolved?.(submission.optimisticRequest);
    try {
      const fixPhotoPaths = await photoUpload.uploadForComment(request, submission.photos);
      const updated = await resolveMaintenanceTicket(
        propertyId,
        request.id,
        {
          note: submission.note,
          chargeable_damage: submission.chargeableDamage,
          ...(submission.costPaise !== null ? { cost_paise: submission.costPaise } : {}),
          ...(fixPhotoPaths.length > 0 ? { fix_photo_paths: fixPhotoPaths } : {})
        },
        token,
        submission.idempotencyKey
      );
      submission.photos.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
      setPhotos([]);
      onResolved(updated);
      toast.success(`Resolved ticket ${request.id}`);
    } catch {
      onRollback?.(request, submission.optimisticRequest);
      toast.error(`Could not resolve ticket ${request.id}.`, {
        action: { label: "Retry", onClick: () => void submit(submission) }
      });
    } finally {
      pendingRef.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }

  return (
    <section className={styles.resolutionSheet} aria-label="Resolve ticket">
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
      <label className={styles.commentForm}>
        <span>Resolution note</span>
        <textarea
          aria-label="Resolution note"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={pending}
        />
      </label>
      <div className={styles.resolutionGrid}>
        <label className={styles.commentForm}>
          <span>Cost in rupees</span>
          <input
            aria-label="Cost in rupees"
            inputMode="decimal"
            min="0"
            type="number"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            disabled={pending}
          />
        </label>
        <fieldset className={styles.radioGroup}>
          <legend>Chargeable damage</legend>
          <label>
            <input
              type="radio"
              name="chargeable-damage"
              checked={chargeableDamage === true}
              onChange={() => setChargeableDamage(true)}
              disabled={pending}
            />
            Yes
          </label>
          <label>
            <input
              type="radio"
              name="chargeable-damage"
              checked={chargeableDamage === false}
              onChange={() => setChargeableDamage(false)}
              disabled={pending}
            />
            No
          </label>
        </fieldset>
      </div>
      <div className={styles.photoUpload}>
        <label className={styles.photoInput}>
          <ImagePlus size={16} aria-hidden="true" />
          <span>Add fix photos</span>
          <input
            aria-label="Add fix photos"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={pending}
            onChange={(event) => {
              addPhotos(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        {photos.length > 0 ? (
          <ul className={styles.pendingPhotos} aria-label="Selected fix photos">
            {photos.map((photo) => (
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
                  disabled={pending}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className={styles.formActions}>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => void submit()}>
          {pending ? <Loader2 size={16} className={styles.spin} /> : null}
          Resolve ticket
        </Button>
      </div>
    </section>
  );
}
