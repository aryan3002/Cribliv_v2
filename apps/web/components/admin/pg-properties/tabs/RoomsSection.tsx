"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { PgAdminListingFull, PgAdminRoomInput } from "@cribliv/shared-types";
import { SectionCard } from "../../primitives/SectionCard";
import { ConfirmDialog } from "../../primitives/ConfirmDialog";
import { replaceAdminPgRooms } from "../../../../lib/admin-api";
import {
  rupeesFromPaise,
  titleCase,
  SHARING_OPTIONS,
  BATHROOM_OPTIONS,
  FURNISHING_OPTIONS
} from "../pgFormat";

interface Props {
  full: PgAdminListingFull;
  accessToken: string;
  listingId: string;
  onSaved: (rooms: PgAdminListingFull["room_types"]) => void;
  onToast?: (msg: string, kind?: "success" | "error") => void;
  refetchFull: () => Promise<void>;
}

// Editable row keeps rent as a rupee string for the input.
type Row = {
  sharing: string;
  ac: boolean;
  bathroom_kind: string;
  furnishing: string;
  rent: string; // rupees
  vacancy: string;
  available_from: string; // YYYY-MM-DD or ""
};

const MIN_RENT = 2000;
const MAX_RENT = 50000;

function toRow(r: PgAdminListingFull["room_types"][number]): Row {
  return {
    sharing: r.sharing,
    ac: r.ac,
    bathroom_kind: r.bathroom_kind ?? "attached_western",
    furnishing: r.furnishing ?? "semi_furnished",
    rent: r.monthly_rent_paise ? String(Math.round(r.monthly_rent_paise / 100)) : "",
    vacancy: String(r.vacancy_count ?? 0),
    available_from: r.available_from ? r.available_from.slice(0, 10) : ""
  };
}

function blankRow(): Row {
  return {
    sharing: "double",
    ac: false,
    bathroom_kind: "attached_western",
    furnishing: "semi_furnished",
    rent: "",
    vacancy: "0",
    available_from: ""
  };
}

export function RoomsSection({
  full,
  accessToken,
  listingId,
  onSaved,
  onToast,
  refetchFull
}: Props) {
  const initial = useMemo(() => full.room_types.map(toRow), [full.room_types]);
  const [rows, setRows] = useState<Row[]>(initial);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const dirty = JSON.stringify(rows) !== JSON.stringify(initial);
  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const rentPaise = (r: Row) => {
    const n = Number(r.rent);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const startingPaise = rows.length
    ? Math.min(...rows.map(rentPaise).filter((n) => Number.isFinite(n)))
    : null;

  const errors: string[] = [];
  if (rows.length === 0) errors.push("At least one room type is required.");
  rows.forEach((r, i) => {
    const rent = Number(r.rent);
    if (!Number.isFinite(rent) || rent < MIN_RENT || rent > MAX_RENT)
      errors.push(
        `Row ${i + 1}: rent must be ₹${MIN_RENT.toLocaleString("en-IN")}–₹${MAX_RENT.toLocaleString("en-IN")}.`
      );
    const vac = Number(r.vacancy);
    if (!Number.isInteger(vac) || vac < 0 || vac > 500)
      errors.push(`Row ${i + 1}: vacancy must be 0–500.`);
  });
  const canSave = dirty && errors.length === 0;

  const save = async () => {
    setSaving(true);
    try {
      const payload: PgAdminRoomInput[] = rows.map((r) => ({
        sharing: r.sharing,
        ac: r.ac,
        bathroom_kind: r.bathroom_kind,
        furnishing: r.furnishing,
        monthly_rent_paise: Math.round(Number(r.rent) * 100),
        vacancy_count: Number(r.vacancy),
        available_from: r.available_from || null
      }));
      await replaceAdminPgRooms(accessToken, listingId, payload);
      // Optimistic patch + background re-sync (starting rent / projection changed).
      onSaved(
        payload.map((p) => ({
          sharing: p.sharing,
          ac: p.ac,
          bathroom_kind: p.bathroom_kind ?? null,
          furnishing: p.furnishing ?? null,
          monthly_rent_paise: p.monthly_rent_paise,
          vacancy_count: p.vacancy_count,
          available_from: p.available_from ?? null
        }))
      );
      void refetchFull();
      onToast?.("Rooms updated", "success");
    } catch (e) {
      const err = e as Error & { code?: string };
      onToast?.(err.code ? `Save failed: ${err.code}` : err.message || "Save failed", "error");
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  };

  return (
    <SectionCard
      title="Rooms & pricing"
      subtitle={
        startingPaise != null && Number.isFinite(startingPaise)
          ? `Starting ${rupeesFromPaise(startingPaise)}/mo`
          : "Add at least one room type."
      }
      action={
        <button type="button" className="admin-chip" onClick={addRow}>
          <Plus size={13} /> Add room
        </button>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((r, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 0.7fr 1.1fr 1.1fr 1fr 0.8fr 1fr auto",
              gap: 8,
              alignItems: "end",
              padding: "10px",
              border: "1px solid var(--ad-border)",
              borderRadius: 10,
              background: "var(--ad-surface-2)"
            }}
          >
            <Field label="Sharing">
              <select
                className="admin-input"
                value={r.sharing}
                onChange={(e) => setRow(i, { sharing: e.target.value })}
              >
                {SHARING_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="AC">
              <select
                className="admin-input"
                value={r.ac ? "ac" : "non"}
                onChange={(e) => setRow(i, { ac: e.target.value === "ac" })}
              >
                <option value="non">Non-AC</option>
                <option value="ac">AC</option>
              </select>
            </Field>
            <Field label="Bathroom">
              <select
                className="admin-input"
                value={r.bathroom_kind}
                onChange={(e) => setRow(i, { bathroom_kind: e.target.value })}
              >
                {BATHROOM_OPTIONS.map((b) => (
                  <option key={b} value={b}>
                    {titleCase(b)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Furnishing">
              <select
                className="admin-input"
                value={r.furnishing}
                onChange={(e) => setRow(i, { furnishing: e.target.value })}
              >
                {FURNISHING_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {titleCase(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Rent ₹/mo">
              <input
                className="admin-input"
                type="number"
                min={MIN_RENT}
                max={MAX_RENT}
                value={r.rent}
                onChange={(e) => setRow(i, { rent: e.target.value })}
              />
            </Field>
            <Field label="Vacancy">
              <input
                className="admin-input"
                type="number"
                min={0}
                max={500}
                value={r.vacancy}
                onChange={(e) => setRow(i, { vacancy: e.target.value })}
              />
            </Field>
            <Field label="Available">
              <input
                className="admin-input"
                type="date"
                value={r.available_from}
                onChange={(e) => setRow(i, { available_from: e.target.value })}
              />
            </Field>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              title="Remove"
              onClick={() => removeRow(i)}
              style={{ height: 34 }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ color: "var(--ad-text-3)", fontSize: 13 }}>
            No rooms. Add one to publish pricing.
          </div>
        )}
      </div>

      {errors.length > 0 && dirty && (
        <ul
          style={{ margin: "12px 0 0", paddingLeft: 18, color: "var(--ad-danger)", fontSize: 12 }}
        >
          {errors.slice(0, 4).map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={!canSave || saving}
          onClick={() => setConfirm(true)}
        >
          {saving ? "Saving…" : "Save rooms"}
        </button>
        {dirty && <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>Unsaved changes</span>}
      </div>

      <ConfirmDialog
        open={confirm}
        title="Save room changes?"
        body={
          <div style={{ fontSize: 13, color: "var(--ad-text-2)" }}>
            This replaces the listing’s room set and updates the public starting price. Logged to
            the admin audit trail.
          </div>
        }
        confirmLabel="Save rooms"
        busy={saving}
        onCancel={() => setConfirm(false)}
        onConfirm={save}
      />
    </SectionCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: "var(--ad-text-3)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          marginBottom: 3
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
