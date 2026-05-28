import {
  type OwnerDraftPayloadSnakeCase,
  type OwnerListingCaptureExtractResponse,
  type CaptureFieldDefinition,
  type ConfidenceTier,
  CAPTURE_FIELD_DEFINITIONS,
  getCaptureFieldDefinition,
  getCaptureValue,
  setCaptureValue,
  hasCaptureValue,
  formatCaptureValue,
  cloneCaptureDraft
} from "./types";
import { useState, useMemo } from "react";

interface Props {
  captureResult: OwnerListingCaptureExtractResponse;
  draft: Partial<OwnerDraftPayloadSnakeCase>;
  onDraftChange: (draft: Partial<OwnerDraftPayloadSnakeCase>) => void;
  onContinue: () => void;
  onReRecord: () => void;
}

export function CaptureConfirmation({
  captureResult,
  draft,
  onDraftChange,
  onContinue,
  onReRecord
}: Props) {
  const [confirmedFields, setConfirmedFields] = useState<Record<string, boolean>>({});
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  const tiers = captureResult.field_confidence_tier;
  const confirmRequired = captureResult.confirm_fields;
  const missingRequired = captureResult.missing_required_fields;

  const visiblePaths = useMemo(() => {
    return CAPTURE_FIELD_DEFINITIONS.map((d) => d.path).filter((p) => hasCaptureValue(draft, p));
  }, [draft]);

  const highConfidence = useMemo(
    () => visiblePaths.filter((p) => tiers[p] === "high" && !confirmRequired.includes(p)),
    [visiblePaths, tiers, confirmRequired]
  );

  const reviewFields = useMemo(
    () => confirmRequired.filter((p) => hasCaptureValue(draft, p)),
    [confirmRequired, draft]
  );

  const unresolvedReview = useMemo(
    () => reviewFields.filter((p) => !confirmedFields[p]),
    [reviewFields, confirmedFields]
  );

  const unresolvedRequired = useMemo(
    () => missingRequired.filter((p) => !hasCaptureValue(draft, p)),
    [missingRequired, draft]
  );

  const canContinue = unresolvedReview.length === 0 && unresolvedRequired.length === 0;

  function startEdit(path: string) {
    const value = getCaptureValue(draft, path);
    setEditingValue(
      typeof value === "boolean" ? (value ? "true" : "false") : value == null ? "" : String(value)
    );
    setEditingField(path);
  }

  function saveEdit(path: string) {
    const def = getCaptureFieldDefinition(path);
    if (!def) return;
    let nextValue: unknown = editingValue;
    if (def.type === "number") {
      const parsed = Number(editingValue);
      nextValue = Number.isFinite(parsed) ? parsed : undefined;
    } else if (def.type === "boolean") {
      nextValue = editingValue === "true";
    }
    onDraftChange(setCaptureValue(draft, path, nextValue));
    setConfirmedFields((prev) => ({ ...prev, [path]: true }));
    setEditingField(null);
  }

  function confirm(path: string) {
    setConfirmedFields((prev) => ({ ...prev, [path]: true }));
  }

  function renderField(path: string, requireConfirmation: boolean) {
    const def = getCaptureFieldDefinition(path);
    if (!def) return null;
    const value = getCaptureValue(draft, path);
    const tier = tiers[path] ?? "medium";
    const isEditing = editingField === path;
    const isConfirmed = confirmedFields[path];

    return (
      <div
        key={path}
        className={`capture-field-card${isConfirmed ? " capture-field-card--confirmed" : ""}`}
      >
        <div className="capture-field-card__head">
          <span className="capture-field-card__label">{def.label}</span>
          <span className={`capture-tier capture-tier--${tier}`}>{tier}</span>
        </div>

        {isEditing ? (
          <div className="capture-field-card__edit">
            {renderEditInput(def)}
            <div className="capture-field-card__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => saveEdit(path)}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setEditingField(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="capture-field-card__value">{formatCaptureValue(path, value)}</div>
            <div className="capture-field-card__actions">
              {requireConfirmation && !isConfirmed ? (
                <button
                  type="button"
                  className="btn btn--trust btn--sm"
                  onClick={() => confirm(path)}
                >
                  ✓ Confirm
                </button>
              ) : isConfirmed ? (
                <span className="capture-field-card__check">✓</span>
              ) : null}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => startEdit(path)}
              >
                Edit
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  function renderEditInput(def: CaptureFieldDefinition) {
    if (def.type === "select") {
      return (
        <select
          className="input"
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
        >
          <option value="">Select...</option>
          {def.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }
    if (def.type === "boolean") {
      return (
        <select
          className="input"
          value={editingValue}
          onChange={(e) => setEditingValue(e.target.value)}
        >
          <option value="">Select...</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    return (
      <input
        className="input"
        type={def.type === "number" ? "number" : "text"}
        value={editingValue}
        onChange={(e) => setEditingValue(e.target.value)}
        autoFocus
      />
    );
  }

  function renderMissingField(path: string) {
    const def = getCaptureFieldDefinition(path);
    if (!def) return null;
    const isEditing = editingField === path;

    return (
      <div key={path} className="capture-field-card capture-field-card--missing">
        <div className="capture-field-card__head">
          <span className="capture-field-card__label">{def.label}</span>
          <span className="capture-tier capture-tier--low">required</span>
        </div>
        {isEditing ? (
          <div className="capture-field-card__edit">
            {renderEditInput(def)}
            <div className="capture-field-card__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => saveEdit(path)}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setEditingField(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="capture-field-card__actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => startEdit(path)}
            >
              + Add
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card capture-confirmation">
      <div className="capture-confirmation__header">
        <h3>AI Draft Review</h3>
        <p className="caption">
          We extracted <strong>{visiblePaths.length}</strong> fields from your voice input. Review
          the highlighted fields below.
        </p>
      </div>

      <div className="capture-confirmation__stats">
        <div className="capture-stat capture-stat--green">
          <span className="capture-stat__num">{highConfidence.length}</span>
          <span className="capture-stat__label">Auto-filled</span>
        </div>
        <div className="capture-stat capture-stat--amber">
          <span className="capture-stat__num">{reviewFields.length}</span>
          <span className="capture-stat__label">Review needed</span>
        </div>
        <div className="capture-stat capture-stat--red">
          <span className="capture-stat__num">{missingRequired.length}</span>
          <span className="capture-stat__label">Missing</span>
        </div>
      </div>

      {highConfidence.length > 0 ? (
        <div className="capture-section">
          <h4 className="capture-section__title">
            <span className="capture-section__dot capture-section__dot--green" />
            Auto-filled (high confidence)
          </h4>
          {highConfidence.map((p) => renderField(p, false))}
        </div>
      ) : null}

      {reviewFields.length > 0 ? (
        <div className="capture-section">
          <h4 className="capture-section__title">
            <span className="capture-section__dot capture-section__dot--amber" />
            Please review ({unresolvedReview.length} remaining)
          </h4>
          {reviewFields.map((p) => renderField(p, true))}
        </div>
      ) : null}

      {missingRequired.length > 0 ? (
        <div className="capture-section">
          <h4 className="capture-section__title">
            <span className="capture-section__dot capture-section__dot--red" />
            Missing required fields ({unresolvedRequired.length} remaining)
          </h4>
          {missingRequired.map((p) => renderMissingField(p))}
        </div>
      ) : null}

      {captureResult.critical_warnings.length > 0 ? (
        <div className="alert alert--warning" role="alert">
          {captureResult.critical_warnings.map((w, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : "var(--space-1) 0 0" }}>
              {w}
            </p>
          ))}
        </div>
      ) : null}

      <details className="capture-transcript">
        <summary>View transcript</summary>
        <p className="capture-transcript__text">
          {captureResult.transcript_echo || "No transcript available."}
        </p>
      </details>

      <div className="wizard-nav">
        <button type="button" className="btn btn--secondary" onClick={onReRecord}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginRight: 6 }}
          >
            <rect x="9" y="1" width="6" height="14" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <line x1="12" y1="21" x2="12" y2="17" />
            <line x1="8" y1="21" x2="16" y2="21" />
          </svg>
          Re-record
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={onContinue}
          disabled={!canContinue}
        >
          {canContinue
            ? "Continue to Form →"
            : `Resolve ${unresolvedReview.length + unresolvedRequired.length} fields`}
        </button>
      </div>
    </div>
  );
}
