"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@cribliv/ui";
import type {
  PgMaintenanceCategory,
  PgMaintenanceCommonArea,
  PgMaintenanceLocation,
  PgMaintenanceLocationInput,
  PgMaintenanceLocationKind,
  PgMaintenanceRequest
} from "@cribliv/shared-types";
import { ImagePlus, Loader2, Wrench, X } from "lucide-react";
import { createResidenceMaintenance } from "@/lib/pg-operations-api";
import { COMMON_AREA_OPTIONS, MINIMUM_DESCRIPTION_LENGTH } from "./maintenance-constants";
import { formatMaintenanceSlaHint } from "./maintenance-formatters";
import {
  createMaintenanceUploadId,
  type PendingMaintenancePhoto,
  releaseMaintenancePhotoPreview,
  useMaintenancePhotoUpload
} from "./useMaintenancePhotoUpload";
import styles from "../MaintenanceWorkspace.module.css";

type MaintenanceCreateFormProps = {
  token: string;
  categories: PgMaintenanceCategory[];
  currentResidenceLocation: PgMaintenanceLocation | null;
  onCreated(request: PgMaintenanceRequest): void;
};

type LocationOption = {
  value: PgMaintenanceLocationKind;
  label: string;
};

function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

function buildLocationOptions(location: PgMaintenanceLocation | null): LocationOption[] {
  const options: LocationOption[] = [];
  if (location?.bed_id) options.push({ value: "bed", label: "My bed" });
  if (location?.room_id) options.push({ value: "room", label: "My room" });
  if (location?.floor !== null && location?.floor !== undefined) {
    options.push({ value: "floor", label: `Floor ${location.floor}` });
  }
  options.push(
    { value: "common_area", label: "Common area" },
    { value: "property_wide", label: "Property wide" },
    { value: "other", label: "Other" }
  );
  return options;
}

function buildLocationInput({
  kind,
  commonArea,
  detail,
  currentResidenceLocation
}: {
  kind: PgMaintenanceLocationKind;
  commonArea: PgMaintenanceCommonArea | "";
  detail: string;
  currentResidenceLocation: PgMaintenanceLocation | null;
}): PgMaintenanceLocationInput {
  if (kind === "bed") {
    return {
      kind,
      room_id: currentResidenceLocation?.room_id ?? undefined,
      bed_id: currentResidenceLocation?.bed_id ?? undefined,
      floor: currentResidenceLocation?.floor ?? undefined
    };
  }
  if (kind === "room") {
    return {
      kind,
      room_id: currentResidenceLocation?.room_id ?? undefined,
      floor: currentResidenceLocation?.floor ?? undefined
    };
  }
  if (kind === "floor") {
    return {
      kind,
      floor: currentResidenceLocation?.floor ?? undefined
    };
  }
  if (kind === "common_area") {
    return {
      kind,
      common_area: commonArea || undefined
    };
  }
  if (kind === "other") {
    return {
      kind,
      detail
    };
  }
  return { kind };
}

export default function MaintenanceCreateForm({
  token,
  categories,
  currentResidenceLocation,
  onCreated
}: MaintenanceCreateFormProps) {
  const [categorySlug, setCategorySlug] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [description, setDescription] = useState("");
  const [locationKind, setLocationKind] = useState<PgMaintenanceLocationKind | "">(
    currentResidenceLocation ? "" : "property_wide"
  );
  const [commonArea, setCommonArea] = useState<PgMaintenanceCommonArea | "">("");
  const [locationDetail, setLocationDetail] = useState("");
  const [photos, setPhotos] = useState<PendingMaintenancePhoto[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoUpload = useMaintenancePhotoUpload({
    mode: "tenant",
    propertyId: currentResidenceLocation?.property_id,
    token
  });
  const idempotencyKeyRef = useRef<string | null>(null);
  const photosRef = useRef<PendingMaintenancePhoto[]>([]);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(
    () => () => {
      photosRef.current.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
    },
    []
  );

  const activeCategories = useMemo(
    () =>
      categories.filter((category) => category.active).sort((a, b) => a.sort_order - b.sort_order),
    [categories]
  );
  const selectedCategory =
    activeCategories.find((category) => category.slug === categorySlug) ?? null;
  const slaHint = formatMaintenanceSlaHint(selectedCategory);
  const locationOptions = useMemo(
    () => buildLocationOptions(currentResidenceLocation),
    [currentResidenceLocation]
  );
  const legacyPayload = currentResidenceLocation === null;

  function normalizeCategory(value: string): string {
    return (
      activeCategories.find(
        (category) => category.slug === value || category.display_name === value
      )?.slug ?? value
    );
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    try {
      setPhotos((current) => [...current, ...photoUpload.addFiles(files, current.length)]);
      setError(null);
    } catch (cause) {
      setError(failureMessage(cause, "Could not add these photos."));
    }
  }

  function removePhoto(clientUploadId: string) {
    setPhotos((current) => photoUpload.removePhoto(current, clientUploadId));
  }

  async function submit() {
    const nextDescription = description.trim();
    const nextDetail = locationDetail.trim();
    if (!categorySlug) {
      setError("Choose a maintenance category.");
      return;
    }
    if (selectedCategory?.slug === "other" && !customCategory.trim()) {
      setError("Enter the issue category.");
      return;
    }
    if (!nextDescription || nextDescription.length < MINIMUM_DESCRIPTION_LENGTH) {
      setError(`Describe the issue in at least ${MINIMUM_DESCRIPTION_LENGTH} characters.`);
      return;
    }
    if (!legacyPayload && !locationKind) {
      setError("Choose where the issue is happening.");
      return;
    }
    if (!legacyPayload && locationKind === "common_area" && !commonArea) {
      setError("Choose the common area.");
      return;
    }
    if (!legacyPayload && locationKind === "other" && !nextDetail) {
      setError("Enter the location detail.");
      return;
    }
    const nextLocationKind = locationKind as PgMaintenanceLocationKind;

    setPending(true);
    setError(null);
    const idempotencyKey =
      idempotencyKeyRef.current ?? (idempotencyKeyRef.current = createMaintenanceUploadId());
    try {
      const createdBase = await createResidenceMaintenance(
        legacyPayload
          ? {
              category:
                selectedCategory?.slug === "other"
                  ? customCategory.trim()
                  : (selectedCategory?.display_name ?? categorySlug),
              description: nextDescription
            }
          : {
              category_slug: categorySlug,
              category:
                selectedCategory?.slug === "other" && customCategory.trim()
                  ? customCategory.trim()
                  : undefined,
              description: nextDescription,
              location: buildLocationInput({
                kind: nextLocationKind,
                commonArea,
                detail: nextDetail,
                currentResidenceLocation
              })
            },
        token,
        idempotencyKey
      );

      let created = createdBase;
      let photoUploadError: string | null = null;
      if (photos.length > 0) {
        try {
          created = await photoUpload.uploadForRequest(createdBase, photos);
        } catch (cause) {
          photoUploadError = `Ticket raised, but photos could not be uploaded. ${failureMessage(
            cause,
            "Add them in a comment."
          )}`;
        }
      }

      onCreated(created);
      setCategorySlug("");
      setCustomCategory("");
      setDescription("");
      setLocationKind(currentResidenceLocation ? "" : "property_wide");
      setCommonArea("");
      setLocationDetail("");
      photos.forEach((photo) => releaseMaintenancePhotoPreview(photo.previewUrl));
      setPhotos([]);
      idempotencyKeyRef.current = null;
      if (photoUploadError) setError(photoUploadError);
    } catch (cause) {
      setError(failureMessage(cause, "Could not raise this maintenance ticket."));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.createForm} aria-label="Raise a maintenance ticket">
      <div className={styles.formHeading}>
        <Wrench size={17} aria-hidden="true" />
        <h3>Raise a ticket</h3>
      </div>
      <div className={styles.fieldGrid}>
        <label>
          <span>Category</span>
          <select
            value={categorySlug}
            onChange={(event) => {
              const nextCategorySlug = normalizeCategory(event.target.value);
              setCategorySlug(nextCategorySlug);
              if (nextCategorySlug !== "other") setCustomCategory("");
            }}
            disabled={pending}
          >
            <option value="">Choose category</option>
            {activeCategories.map((category) => (
              <option
                key={category.slug}
                value={legacyPayload ? category.display_name : category.slug}
              >
                {category.display_name}
              </option>
            ))}
          </select>
        </label>
        {selectedCategory?.slug === "other" && (
          <label>
            <span>Issue category</span>
            <input
              value={customCategory}
              onChange={(event) => setCustomCategory(event.target.value)}
              disabled={pending}
            />
          </label>
        )}
        {!legacyPayload && (
          <label>
            <span>Location</span>
            <select
              value={locationKind}
              onChange={(event) => {
                const value = event.target.value as PgMaintenanceLocationKind | "";
                setLocationKind(value);
                if (value !== "common_area") setCommonArea("");
                if (value !== "other") setLocationDetail("");
              }}
              disabled={pending}
            >
              <option value="">Choose location</option>
              {locationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {locationKind === "common_area" && (
          <label>
            <span>Common area</span>
            <select
              value={commonArea}
              onChange={(event) => setCommonArea(event.target.value as PgMaintenanceCommonArea)}
              disabled={pending}
            >
              <option value="">Choose common area</option>
              {COMMON_AREA_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {locationKind === "other" && (
          <label>
            <span>Location detail</span>
            <input
              value={locationDetail}
              onChange={(event) => setLocationDetail(event.target.value)}
              disabled={pending}
            />
          </label>
        )}
        <label className={styles.descriptionField}>
          <span>Description</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            disabled={pending}
          />
        </label>
      </div>
      {slaHint && <p className={styles.formHint}>{slaHint}</p>}
      <div className={styles.photoUpload}>
        <label className={styles.photoInput}>
          <ImagePlus size={16} aria-hidden="true" />
          <span>Add photos</span>
          <input
            aria-label="Add photos"
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
        {photos.length > 0 && (
          <ul className={styles.pendingPhotos} aria-label="Selected ticket photos">
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
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.formActions}>
        <Button type="button" disabled={pending} onClick={() => void submit()}>
          {pending ? <Loader2 size={16} className={styles.spin} /> : null}
          Raise ticket
        </Button>
      </div>
    </section>
  );
}
