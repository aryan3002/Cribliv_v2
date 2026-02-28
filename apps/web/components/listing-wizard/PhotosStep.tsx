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
    <>
      <p className="caption">
        Add photos of your property. Good photos help tenants decide faster.
      </p>

      <div
        className="upload-zone"
        role="button"
        tabIndex={0}
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
      >
        <svg
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-tertiary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <p style={{ marginTop: 8 }}>Click or drag photos here</p>
        <p className="caption" style={{ color: "var(--text-tertiary)" }}>
          JPG, PNG up to 10 MB each
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => onFilesSelected(e.target.files)}
          aria-label="Select photos"
        />
      </div>

      {uploads.length > 0 ? (
        <>
          <div className="upload-list">
            {uploads.map((upload) => (
              <div key={upload.clientUploadId} className="upload-item">
                <img
                  className="upload-item__preview"
                  src={upload.previewUrl}
                  alt={upload.file.name}
                />
                <div className="upload-item__info">
                  <div className="upload-item__name">{upload.file.name}</div>
                  <div
                    className={`upload-item__status${
                      upload.status === "complete"
                        ? " upload-item__status--success"
                        : upload.status === "error"
                          ? " upload-item__status--error"
                          : ""
                    }`}
                  >
                    {upload.status === "pending" ? "Ready to upload" : null}
                    {upload.status === "uploading" ? "Uploading..." : null}
                    {upload.status === "complete" ? "Uploaded" : null}
                    {upload.status === "error" ? upload.errorMessage || "Upload failed" : null}
                  </div>
                  {upload.status === "uploading" ? (
                    <div className="progress-bar">
                      <div
                        className="progress-bar__fill"
                        style={{ width: `${upload.progress}%` }}
                      />
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => onRemove(upload.clientUploadId)}
                  aria-label={`Remove ${upload.file.name}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={onUploadAll}
              disabled={saving || uploads.every((u) => u.status !== "pending")}
            >
              Upload All
            </button>
          </div>
        </>
      ) : null}
    </>
  );
}
