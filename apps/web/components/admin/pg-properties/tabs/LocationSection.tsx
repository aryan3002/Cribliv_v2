"use client";

import { useMemo, useState } from "react";
import type {
  PgAdminListingFull,
  PgAdminPropertyPatch,
  PgPropertyStatus
} from "@cribliv/shared-types";
import { SectionCard } from "../../primitives/SectionCard";
import { ConfirmDialog } from "../../primitives/ConfirmDialog";
import { updateAdminPgProperty } from "../../../../lib/admin-api";
import { FieldLabel } from "../pgFormat";
import { LocationMapPicker } from "../LocationMapPicker";

type Property = NonNullable<PgAdminListingFull["property"]>;

interface Props {
  full: PgAdminListingFull;
  accessToken: string;
  onSaved: (property: Property) => void;
  onToast?: (msg: string, kind?: "success" | "error") => void;
}

type Draft = {
  display_name: string;
  status: PgPropertyStatus;
  city_slug: string;
  locality_slug: string;
  lat: string;
  lng: string;
  total_floors: string;
  internal_code: string;
};

function buildDraft(p: Property): Draft {
  return {
    display_name: p.display_name ?? "",
    status: (p.status as PgPropertyStatus) ?? "active",
    city_slug: p.city_slug ?? "",
    locality_slug: p.locality_slug ?? "",
    lat: p.lat != null ? String(p.lat) : "",
    lng: p.lng != null ? String(p.lng) : "",
    total_floors: p.total_floors != null ? String(p.total_floors) : "",
    internal_code: p.internal_code ?? ""
  };
}

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const inputStyle = { width: "100%" } as const;

export function LocationSection({ full, accessToken, onSaved, onToast }: Props) {
  const p = full.property;
  const initial = useMemo(() => (p ? buildDraft(p) : null), [p]);
  const [draft, setDraft] = useState<Draft | null>(initial);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  if (!p || !draft || !initial) {
    return (
      <SectionCard title="Property & location">
        <div style={{ color: "var(--ad-text-3)", fontSize: 13 }}>
          This listing has no linked PG property, so location/geo can’t be edited.
        </div>
      </SectionCard>
    );
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const latNum = numOrNull(draft.lat);
  const lngNum = numOrNull(draft.lng);

  const save = async () => {
    setSaving(true);
    try {
      const patch: PgAdminPropertyPatch = {
        display_name: draft.display_name || undefined,
        status: draft.status,
        city_slug: draft.city_slug || undefined,
        locality_slug: draft.locality_slug ? draft.locality_slug : null,
        lat: latNum,
        lng: lngNum,
        total_floors: numOrNull(draft.total_floors),
        internal_code: draft.internal_code ? draft.internal_code : null
      };
      await updateAdminPgProperty(accessToken, p.id, patch);
      onSaved({
        ...p,
        display_name: draft.display_name || null,
        status: draft.status,
        city_slug: draft.city_slug || null,
        locality_slug: draft.locality_slug || null,
        lat: latNum,
        lng: lngNum,
        total_floors: numOrNull(draft.total_floors),
        internal_code: draft.internal_code || null
      });
      onToast?.("Location updated", "success");
    } catch (e) {
      const err = e as Error & { code?: string };
      onToast?.(err.code ? `Save failed: ${err.code}` : err.message || "Save failed", "error");
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)",
        gap: 16,
        alignItems: "start"
      }}
    >
      <SectionCard
        title="Property & location"
        subtitle="Shared by every listing this operator owns. Geo/locality propagate to public listings on save."
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div>
            <FieldLabel>Property name</FieldLabel>
            <input
              className="admin-input"
              style={inputStyle}
              value={draft.display_name}
              onChange={(e) => set("display_name", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Property status</FieldLabel>
            <select
              className="admin-input"
              style={inputStyle}
              value={draft.status}
              onChange={(e) => set("status", e.target.value as PgPropertyStatus)}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <FieldLabel>City slug</FieldLabel>
              <input
                className="admin-input"
                style={inputStyle}
                value={draft.city_slug}
                onChange={(e) => set("city_slug", e.target.value.toLowerCase())}
                placeholder="lucknow"
              />
            </div>
            <div>
              <FieldLabel>Locality slug</FieldLabel>
              <input
                className="admin-input"
                style={inputStyle}
                value={draft.locality_slug}
                onChange={(e) => set("locality_slug", e.target.value.toLowerCase())}
                placeholder="mahanagar"
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <FieldLabel>Latitude</FieldLabel>
              <input
                className="admin-input"
                style={inputStyle}
                value={draft.lat}
                onChange={(e) => set("lat", e.target.value)}
                placeholder="26.8467"
              />
            </div>
            <div>
              <FieldLabel>Longitude</FieldLabel>
              <input
                className="admin-input"
                style={inputStyle}
                value={draft.lng}
                onChange={(e) => set("lng", e.target.value)}
                placeholder="80.9462"
              />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <FieldLabel>Total floors</FieldLabel>
              <input
                className="admin-input"
                type="number"
                min={1}
                style={inputStyle}
                value={draft.total_floors}
                onChange={(e) => set("total_floors", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel>Internal code</FieldLabel>
              <input
                className="admin-input"
                style={inputStyle}
                value={draft.internal_code}
                onChange={(e) => set("internal_code", e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="admin-btn admin-btn--primary"
              disabled={!dirty || saving}
              onClick={() => setConfirm(true)}
            >
              {saving ? "Saving…" : "Save location"}
            </button>
            {dirty && (
              <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>Unsaved changes</span>
            )}
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Map" subtitle="Drag the pin or click the map to set exact coordinates.">
        <LocationMapPicker
          lat={latNum}
          lng={lngNum}
          onChange={(la, ln) =>
            setDraft((d) => (d ? { ...d, lat: la.toFixed(6), lng: ln.toFixed(6) } : d))
          }
        />
      </SectionCard>

      <ConfirmDialog
        open={confirm}
        title="Save location changes?"
        body={
          <div style={{ fontSize: 13, color: "var(--ad-text-2)" }}>
            Geo/locality changes propagate to the public listing and CribLiv map. Logged to the
            admin audit trail.
          </div>
        }
        confirmLabel="Save location"
        busy={saving}
        onCancel={() => setConfirm(false)}
        onConfirm={save}
      />
    </div>
  );
}
