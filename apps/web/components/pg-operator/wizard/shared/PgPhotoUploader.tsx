"use client";
import { Dispatch, useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Upload, X, Star } from "lucide-react";
import type { PgWizardAction, PgWizardState, PendingPhoto } from "@/lib/pg-wizard-state";

const ACCEPTED_MIME = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_PHOTOS = 20;
const MIN_PHOTOS = 4;

function genId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fallthrough
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

interface Props {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
}

export default function PgPhotoUploader({ state, dispatch }: Props) {
  const photos = state.pendingPhotos ?? [];
  const [rejection, setRejection] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // Revoke any blob URLs lingering at unmount (covers route-away mid-wizard).
  useEffect(() => {
    return () => {
      for (const p of photos) {
        try {
          URL.revokeObjectURL(p.previewUrl);
        } catch {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ingest = useCallback(
    (files: FileList | File[]) => {
      setRejection(null);
      const arr = Array.from(files);
      const accepted: PendingPhoto[] = [];
      const rejected: string[] = [];

      for (const f of arr) {
        if (photos.length + accepted.length >= MAX_PHOTOS) {
          rejected.push(`${f.name} (max ${MAX_PHOTOS} photos)`);
          continue;
        }
        if (!ACCEPTED_MIME.includes(f.type)) {
          rejected.push(`${f.name} (only JPG, PNG, WebP)`);
          continue;
        }
        if (f.size > MAX_FILE_BYTES) {
          rejected.push(`${f.name} (max 10 MB)`);
          continue;
        }
        accepted.push({
          clientUploadId: genId(),
          file: f,
          previewUrl: URL.createObjectURL(f),
          sizeBytes: f.size,
          contentType: f.type,
          sortOrder: 0, // reducer reassigns based on order
          isCover: false
        });
      }

      if (accepted.length > 0) dispatch({ type: "ADD_PHOTOS", photos: accepted });
      if (rejected.length > 0) setRejection(`Skipped: ${rejected.join(", ")}`);
    },
    [photos.length, dispatch]
  );

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) ingest(e.dataTransfer.files);
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div
        className={`pgo-dropzone${dragOver ? " pgo-dropzone--drag" : ""}`}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <div className="pgo-dropzone__icon">
          <ImagePlus size={48} />
        </div>
        <h3 className="pgo-heading pgo-heading--sm" style={{ marginBottom: 6 }}>
          Upload Property Photos
        </h3>
        <p className="pgo-desc" style={{ margin: "0 auto", fontSize: 14 }}>
          Drag and drop images, or click to browse
        </p>
        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6
          }}
        >
          <Upload size={14} />
          <span className="pgo-caption">JPG, PNG, WebP — max 10 MB each — up to {MAX_PHOTOS}</span>
        </div>
        <p
          className="pgo-caption"
          style={{
            marginTop: 8,
            color: photos.length >= MIN_PHOTOS ? "var(--pgo-success, #22c55e)" : undefined
          }}
        >
          {photos.length} of {MIN_PHOTOS} minimum
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_MIME.join(",")}
          multiple
          aria-label="photos"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) ingest(e.target.files);
            // Allow re-selecting the same filename.
            e.target.value = "";
          }}
        />
      </div>

      {rejection && (
        <p role="alert" className="pgo-field__error" style={{ marginTop: 8 }}>
          {rejection}
        </p>
      )}

      {photos.length > 0 && (
        <div className="pgo-dropzone__thumbnails">
          {photos
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((p) => (
              <div key={p.clientUploadId} className="pgo-dropzone__thumb">
                <img src={p.previewUrl} alt="" />
                {p.isCover && (
                  <span className="pgo-dropzone__cover-badge" aria-label="Cover photo">
                    <Star size={12} /> Cover
                  </span>
                )}
                <div className="pgo-dropzone__thumb-actions">
                  {!p.isCover && (
                    <button
                      type="button"
                      className="pgo-dropzone__thumb-action"
                      aria-label="Make cover"
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: "SET_COVER_PHOTO", clientUploadId: p.clientUploadId });
                      }}
                    >
                      <Star size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="pgo-dropzone__thumb-action"
                    aria-label="Remove photo"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch({ type: "REMOVE_PHOTO", clientUploadId: p.clientUploadId });
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
