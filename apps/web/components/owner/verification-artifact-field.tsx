"use client";

import { RefreshCw, Trash2, Upload } from "lucide-react";
import { useId, type ChangeEvent } from "react";

export type VerificationArtifactFieldStatus = "idle" | "uploading" | "ready" | "error";

export interface VerificationArtifactFieldCopy {
  selectFile: string;
  retry: string;
  remove: string;
  ready: string;
  noFile: string;
  uploaded: string;
}

export function VerificationArtifactField(props: {
  accept: string;
  label: string;
  file: File | null;
  status: VerificationArtifactFieldStatus;
  progress: number;
  error?: string;
  onSelect(file: File): void;
  onRemove(): void;
  onRetry(): void;
  copy?: VerificationArtifactFieldCopy;
}): JSX.Element {
  const inputId = useId();
  const copy = props.copy ?? {
    selectFile: "Select file",
    retry: "Retry",
    remove: "Remove",
    ready: "Ready",
    noFile: "No file selected",
    uploaded: "uploaded"
  };
  const progress = Math.max(0, Math.min(100, Math.round(props.progress)));

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    props.onSelect(file);
    event.target.value = "";
  }

  return (
    <div className={`ovc-artifact ovc-artifact--${props.status}`}>
      <label className="ovc-field-label" htmlFor={inputId}>
        {props.label}
      </label>
      <input
        id={inputId}
        className="ovc-artifact__input"
        type="file"
        accept={props.accept}
        onChange={onChange}
      />
      <div className="ovc-artifact__surface">
        <label className="ovc-artifact__select" htmlFor={inputId}>
          <Upload size={16} aria-hidden="true" />
          {copy.selectFile}
        </label>
        <div className="ovc-artifact__meta">
          <strong>{props.file ? props.file.name : copy.noFile}</strong>
          {props.file ? <span>{formatFileSize(props.file.size)}</span> : null}
        </div>
      </div>

      {props.file && props.status === "uploading" ? (
        <div className="ovc-artifact__progress">
          <progress aria-label={props.label} value={progress} max={100} />
          <span>
            {progress}% {copy.uploaded}
          </span>
        </div>
      ) : null}

      {props.file && props.status === "ready" ? (
        <p className="ovc-artifact__ready" role="status">
          {copy.ready}
        </p>
      ) : null}

      {props.file && props.status === "error" ? (
        <div className="ovc-artifact__failure">
          {props.error ? <p role="alert">{props.error}</p> : null}
          <div className="ovc-artifact__actions">
            <button type="button" onClick={props.onRetry}>
              <RefreshCw size={16} aria-hidden="true" />
              {copy.retry}
            </button>
            <button type="button" onClick={props.onRemove}>
              <Trash2 size={16} aria-hidden="true" />
              {copy.remove}
            </button>
          </div>
        </div>
      ) : null}

      {props.file && props.status !== "error" ? (
        <button type="button" className="ovc-artifact__remove" onClick={props.onRemove}>
          <Trash2 size={16} aria-hidden="true" />
          {copy.remove}
        </button>
      ) : null}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1000) return `${bytes} B`;
  const kb = bytes / 1000;
  if (kb < 1000) {
    return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(kb)} KB`;
  }
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(kb / 1000)} MB`;
}
