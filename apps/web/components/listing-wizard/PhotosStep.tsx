"use client";

import { useMemo, useRef } from "react";
import { PhotoGrid, type PhotoGridItem } from "./PhotoGrid";
import type { UploadFile } from "./types";

interface Props {
  uploads: UploadFile[];
  saving: boolean;
  onFilesSelected: (files: FileList | null) => void;
  onUploadAll: () => void;
  onRemove: (clientUploadId: string) => void;
  onRetry: (clientUploadId: string) => void;
  /** New order of uploads, after a drag. The first item is the cover. */
  onReorder: (next: UploadFile[]) => void;
}

export function PhotosStep({
  uploads,
  saving,
  onFilesSelected,
  onUploadAll,
  onRemove,
  onRetry,
  onReorder
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Project the wizard's upload state into the PhotoGrid's view model. The
  // mapping is one-way; PhotoGrid emits a reordered list of PhotoGridItems
  // and we project that back onto the original UploadFile[] by id.
  const gridItems = useMemo<PhotoGridItem[]>(
    () =>
      uploads.map((upload) => ({
        id: upload.clientUploadId,
        previewUrl: upload.previewUrl,
        caption: upload.file?.name,
        status: upload.status,
        progress: upload.progress,
        errorMessage: upload.errorMessage,
        retryable: upload.retryable
      })),
    [uploads]
  );

  const handleReorder = (nextItems: PhotoGridItem[]) => {
    const byId = new Map(uploads.map((u) => [u.clientUploadId, u]));
    const reordered: UploadFile[] = [];
    for (const item of nextItems) {
      const upload = byId.get(item.id);
      if (upload) reordered.push(upload);
    }
    // Defensive: if some id was lost (shouldn't happen), append anything
    // missing in original order so we never silently drop a photo.
    if (reordered.length !== uploads.length) {
      const present = new Set(reordered.map((u) => u.clientUploadId));
      for (const upload of uploads) {
        if (!present.has(upload.clientUploadId)) reordered.push(upload);
      }
    }
    onReorder(reordered);
  };

  const hasPending = uploads.some((u) => u.status === "pending");
  const isPreparing = uploads.some((u) => u.status === "preparing");

  return (
    <div className="cz-card cz-fade cz-fade--2">
      <div className="cz-card__eyebrow">Step 5</div>
      <h2 className="cz-card__title">Add photos</h2>
      <p className="cz-card__intent">
        Upload high-quality photos of your property. Well-lit photos of living spaces, bedrooms, and
        kitchen attract more tenants. Drag a photo to the first slot to make it the cover.
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
        <div className="cz-dropzone__hint">JPG, PNG, HEIC, HEIF, WebP · up to 10 MB each</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
          multiple
          hidden
          onChange={(e) => onFilesSelected(e.target.files)}
        />
      </button>

      {uploads.length > 0 ? (
        <>
          <PhotoGrid
            items={gridItems}
            onReorder={handleReorder}
            onRemove={onRemove}
            onRetry={onRetry}
          />

          <div style={{ marginTop: 18 }}>
            <button
              type="button"
              className="cz-btn cz-btn--primary"
              onClick={onUploadAll}
              disabled={saving || isPreparing || !hasPending}
            >
              {isPreparing ? "Preparing photos…" : "Upload all"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
