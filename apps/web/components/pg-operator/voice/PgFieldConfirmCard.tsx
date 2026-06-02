"use client";

import { motion } from "framer-motion";

interface Props {
  field: string;
  value: unknown;
  confidence: number;
  onUndo: (field: string) => void;
  onEdit?: () => void;
}

// Human labels for the dotted field paths the voice agent extracts. Falls back
// to a de-slugged last segment so an unmapped field still reads cleanly.
const FIELD_LABELS: Record<string, string> = {
  "property.display_name": "PG name",
  "property.city_slug": "City",
  "property.locality_slug": "Locality",
  "property.formatted_address": "Address",
  "pg_details.gender_policy": "Gender policy",
  "pg_details.tenant_type": "Tenant type",
  "pg_details.security_deposit_paise": "Security deposit",
  "pg_details.notice_period_days": "Notice period",
  "pg_details.meals": "Meals"
};

export function pgFieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const last = field.split(".").pop() ?? field;
  return last
    .replace(/_paise$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(field: string, value: unknown): string {
  if (field.endsWith("_paise") && typeof value === "number") {
    return `₹${Math.round(value / 100).toLocaleString("en-IN")}`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** A confirmation card for one voice-extracted field, with undo + low-confidence nudge. */
export function PgFieldConfirmCard({ field, value, confidence, onUndo, onEdit }: Props) {
  const low = confidence < 0.6;
  return (
    <motion.div
      className="pgo-glass pgo-field-confirm"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, opacity: 0.65 }}>{pgFieldLabel(field)}</span>
        <span
          className="pgo-field-confirm__chip"
          style={{ fontSize: 11, opacity: 0.7 }}
          aria-label={`confidence ${Math.round(confidence * 100)} percent`}
        >
          {Math.round(confidence * 100)}%
        </span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{formatValue(field, value)}</div>
      {low && (
        <div style={{ fontSize: 12, color: "var(--pgo-warning, #f59e0b)" }}>
          Please confirm — I wasn&apos;t sure.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
        <button
          type="button"
          className="pgo-field-confirm__undo"
          onClick={() => onUndo(field)}
          style={{ fontSize: 12 }}
        >
          Undo
        </button>
        {onEdit && (
          <button
            type="button"
            className="pgo-field-confirm__edit"
            onClick={onEdit}
            style={{ fontSize: 12 }}
          >
            Edit
          </button>
        )}
      </div>
    </motion.div>
  );
}
