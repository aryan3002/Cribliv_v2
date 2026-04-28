"use client";

import { useRef } from "react";
import type { UploadFile } from "./types";

interface Props {
  uploads: UploadFile[];
  saving: boolean;
  onFilesSelected: (files: FileList | null) => void;
  onUploadAll: () => void;
  onRemove: (clientUploadId: string) => void;
}

export function PhotosStep({ uploads, saving, onFilesSelected, onUploadAll, onRemove }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="cz-card cz-fade cz-fade--2">
      <div className="cz-card__eyebrow">V · The pictures</div>
      <h2 className="cz-card__title">A few honest photos.</h2>
      <p className="cz-card__intent">
        Three or four is plenty — natural light, the living room, a clean kitchen, and the view if
        you have one.
      </p>

      <button
        type="button"
        className="cz-dropzone"
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFilesSelected(e.dataTransfer.files);
        }}
        aria-label="Upload photos"
      >
        <svg
          className="cz-dropzone__icon"
          width="44"
          height="44"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="8.5" cy="9" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <div className="cz-dropzone__title">Click or drop photos here</div>
        <div className="cz-dropzone__hint">JPG / PNG · up to 10 MB each</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => onFilesSelected(e.target.files)}
        />
      </button>

      {uploads.length > 0 ? (
        <>
          <div className="cz-contact-sheet">
            {uploads.map((upload) => (
              <figure key={upload.clientUploadId} className="cz-polaroid">
                <img src={upload.previewUrl} alt={upload.file.name} className="cz-polaroid__img" />
                {upload.status === "uploading" ? (
                  <div className="cz-polaroid__progress">
                    <span style={{ width: `${upload.progress}%` }} />
                  </div>
                ) : null}
                <figcaption className="cz-polaroid__caption">
                  {upload.status === "complete"
                    ? "Uploaded"
                    : upload.status === "error"
                      ? upload.errorMessage || "Upload failed"
                      : upload.status === "uploading"
                        ? "Uploading…"
                        : upload.file.name}
                </figcaption>
                <button
                  type="button"
                  className="cz-polaroid__remove"
                  aria-label={`Remove ${upload.file.name}`}
                  onClick={() => onRemove(upload.clientUploadId)}
                >
                  ×
                </button>
              </figure>
            ))}
          </div>

          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              className="cz-btn cz-btn--primary"
              onClick={onUploadAll}
              disabled={saving || uploads.every((u) => u.status !== "pending")}
            >
              Upload all
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
