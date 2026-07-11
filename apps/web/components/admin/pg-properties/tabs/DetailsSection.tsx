"use client";

import { useMemo, useState } from "react";
import type { PgAdminListingFull, PgAdminDetailsPatch } from "@cribliv/shared-types";
import { SectionCard } from "../../primitives/SectionCard";
import { ConfirmDialog } from "../../primitives/ConfirmDialog";
import { updateAdminPgDetails } from "../../../../lib/admin-api";
import { FieldLabel, Chips, titleCase, PAYMENT_MODE_OPTIONS, flattenAmenities } from "../pgFormat";

interface Props {
  full: PgAdminListingFull;
  accessToken: string;
  listingId: string;
  onSaved: (next: PgAdminListingFull["pg_details"]) => void;
  /** Called with the new title when it changed, so the container can refresh the header + cached full. */
  onTitleSaved?: (title: string) => void;
  onToast?: (msg: string, kind?: "success" | "error") => void;
}

type Draft = {
  title: string;
  total_beds: string;
  gender_policy: string;
  tenant_type: string;
  price_negotiable: boolean;
  security_deposit: string; // rupees
  deposit_refundable_pct: string;
  maintenance: string; // rupees
  rent_due_day: string;
  payment_modes: string[];
  notice_period_days: string;
  lock_in_months: string;
  electricity_mode: string;
  meals_provided: boolean;
  meals_veg_only: boolean;
  meal_charges: string; // rupees
  hr_smoking: boolean;
  hr_alcohol: boolean;
  hr_non_veg: boolean;
  hr_pets: boolean;
  hr_cooking_in_room: boolean;
};

const HOUSE_RULES: Array<{ key: keyof Draft; rule: string; label: string }> = [
  { key: "hr_smoking", rule: "smoking", label: "Smoking" },
  { key: "hr_alcohol", rule: "alcohol", label: "Alcohol" },
  { key: "hr_non_veg", rule: "non_veg", label: "Non-veg" },
  { key: "hr_pets", rule: "pets", label: "Pets" },
  { key: "hr_cooking_in_room", rule: "cooking_in_room", label: "Cooking in room" }
];

const paiseToRupeeStr = (p?: number | null) =>
  p != null && p > 0 ? String(Math.round(p / 100)) : "";
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const rupeeStrToPaise = (s: string): number | null => {
  const n = numOrNull(s);
  return n == null ? null : Math.round(n * 100);
};

function buildDraft(d: PgAdminListingFull["pg_details"], listingTitle: string): Draft {
  const meals = (d.meals ?? {}) as { provided?: boolean; veg_only?: boolean };
  const hr = (d.house_rules ?? {}) as Record<string, unknown>;
  return {
    title: listingTitle,
    total_beds: d.total_beds != null ? String(d.total_beds) : "",
    gender_policy: d.gender_policy ?? "",
    tenant_type: d.tenant_type ?? "",
    price_negotiable: d.price_negotiable,
    security_deposit: paiseToRupeeStr(d.security_deposit_paise),
    deposit_refundable_pct:
      d.deposit_refundable_pct != null ? String(d.deposit_refundable_pct) : "",
    maintenance: paiseToRupeeStr(d.maintenance_paise),
    rent_due_day: d.rent_due_day != null ? String(d.rent_due_day) : "",
    payment_modes: d.payment_modes ?? [],
    notice_period_days: d.notice_period_days != null ? String(d.notice_period_days) : "",
    lock_in_months: d.lock_in_months != null ? String(d.lock_in_months) : "",
    electricity_mode: d.electricity_mode ?? "",
    meals_provided: !!meals.provided,
    meals_veg_only: !!meals.veg_only,
    meal_charges: paiseToRupeeStr(d.meal_charges_paise),
    hr_smoking: hr.smoking === true,
    hr_alcohol: hr.alcohol === true,
    hr_non_veg: hr.non_veg === true,
    hr_pets: hr.pets === true,
    hr_cooking_in_room: hr.cooking_in_room === true
  };
}

const inputStyle = { width: "100%" } as const;

export function DetailsSection({
  full,
  accessToken,
  listingId,
  onSaved,
  onTitleSaved,
  onToast
}: Props) {
  const d = full.pg_details;
  const listingTitle = full.listing.title ?? "";
  const initial = useMemo(() => buildDraft(d, listingTitle), [d, listingTitle]);
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => ({ ...p, [k]: v }));
  const togglePayment = (m: string) =>
    setDraft((p) => ({
      ...p,
      payment_modes: p.payment_modes.includes(m)
        ? p.payment_modes.filter((x) => x !== m)
        : [...p.payment_modes, m]
    }));

  const buildPatch = (): PgAdminDetailsPatch => {
    const meals = {
      ...((d.meals as Record<string, unknown>) ?? {}),
      provided: draft.meals_provided,
      veg_only: draft.meals_veg_only
    };
    const house_rules = {
      ...((d.house_rules as Record<string, unknown>) ?? {}),
      smoking: draft.hr_smoking,
      alcohol: draft.hr_alcohol,
      non_veg: draft.hr_non_veg,
      pets: draft.hr_pets,
      cooking_in_room: draft.hr_cooking_in_room
    };
    return {
      title: draft.title.trim().length >= 2 ? draft.title.trim() : undefined,
      total_beds: numOrNull(draft.total_beds) ?? undefined,
      gender_policy: (draft.gender_policy || null) as PgAdminDetailsPatch["gender_policy"],
      tenant_type: (draft.tenant_type || null) as PgAdminDetailsPatch["tenant_type"],
      price_negotiable: draft.price_negotiable,
      security_deposit_paise: rupeeStrToPaise(draft.security_deposit) ?? undefined,
      deposit_refundable_pct: numOrNull(draft.deposit_refundable_pct) ?? undefined,
      maintenance_paise: rupeeStrToPaise(draft.maintenance),
      rent_due_day: numOrNull(draft.rent_due_day),
      payment_modes: draft.payment_modes as PgAdminDetailsPatch["payment_modes"],
      notice_period_days: numOrNull(draft.notice_period_days),
      lock_in_months: numOrNull(draft.lock_in_months),
      electricity_mode: (draft.electricity_mode || null) as PgAdminDetailsPatch["electricity_mode"],
      meals,
      meal_charges_paise: rupeeStrToPaise(draft.meal_charges),
      house_rules
    };
  };

  const save = async () => {
    setSaving(true);
    try {
      const patch = buildPatch();
      await updateAdminPgDetails(accessToken, listingId, patch);
      // Optimistic merge into the cached full payload.
      onSaved({
        ...d,
        total_beds: patch.total_beds ?? d.total_beds,
        gender_policy: patch.gender_policy ?? null,
        tenant_type: patch.tenant_type ?? null,
        price_negotiable: !!patch.price_negotiable,
        security_deposit_paise: patch.security_deposit_paise ?? null,
        deposit_refundable_pct: patch.deposit_refundable_pct ?? null,
        maintenance_paise: patch.maintenance_paise ?? null,
        rent_due_day: patch.rent_due_day ?? null,
        payment_modes: patch.payment_modes ?? [],
        notice_period_days: patch.notice_period_days ?? null,
        lock_in_months: patch.lock_in_months ?? null,
        electricity_mode: patch.electricity_mode ?? null,
        meals: patch.meals ?? null,
        meal_charges_paise: patch.meal_charges_paise ?? null,
        house_rules: patch.house_rules ?? d.house_rules
      });
      if (patch.title && patch.title !== listingTitle) onTitleSaved?.(patch.title);
      onToast?.("Listing details updated", "success");
    } catch (e) {
      const err = e as Error & { code?: string };
      onToast?.(err.code ? `Save failed: ${err.code}` : err.message || "Save failed", "error");
    } finally {
      setSaving(false);
      setConfirm(false);
    }
  };

  const amenityList = flattenAmenities(d.amenities);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <SectionCard
        title="Listing title"
        subtitle="The public title tenants see on cards, search and the listing page. Distinct from the building/property name (edited under Location)."
      >
        <input
          className="admin-input"
          style={inputStyle}
          value={draft.title}
          onChange={(e) => set("title", e.target.value)}
          placeholder="e.g. Sunrise Residency, Boys PG near XYZ College"
          aria-label="listing title"
        />
        {draft.title.trim().length > 0 && draft.title.trim().length < 2 && (
          <span
            style={{
              fontSize: 11,
              color: "var(--ad-danger, #dc2626)",
              marginTop: 5,
              display: "block"
            }}
          >
            Title must be at least 2 characters.
          </span>
        )}
      </SectionCard>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16
        }}
      >
        <SectionCard title="Identity">
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <FieldLabel>For</FieldLabel>
              <select
                className="admin-input"
                style={inputStyle}
                value={draft.gender_policy}
                onChange={(e) => set("gender_policy", e.target.value)}
              >
                <option value="">-</option>
                <option value="boys">Boys</option>
                <option value="girls">Girls</option>
                <option value="coed">Co-ed</option>
              </select>
            </div>
            <div>
              <FieldLabel>Tenant type</FieldLabel>
              <select
                className="admin-input"
                style={inputStyle}
                value={draft.tenant_type}
                onChange={(e) => set("tenant_type", e.target.value)}
              >
                <option value="">-</option>
                <option value="students">Students</option>
                <option value="working">Working</option>
                <option value="any">Any</option>
              </select>
            </div>
            <div style={{ maxWidth: 160 }}>
              <FieldLabel>Total beds</FieldLabel>
              <input
                className="admin-input"
                type="number"
                min={1}
                style={inputStyle}
                value={draft.total_beds}
                onChange={(e) => set("total_beds", e.target.value)}
              />
            </div>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                color: "var(--ad-text)"
              }}
            >
              <input
                type="checkbox"
                checked={draft.price_negotiable}
                onChange={(e) => set("price_negotiable", e.target.checked)}
              />
              Price negotiable
            </label>
          </div>
        </SectionCard>

        <SectionCard title="Money">
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <FieldLabel>Security deposit (₹)</FieldLabel>
              <input
                className="admin-input"
                type="number"
                min={0}
                style={inputStyle}
                value={draft.security_deposit}
                onChange={(e) => set("security_deposit", e.target.value)}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <FieldLabel>Refundable %</FieldLabel>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  max={100}
                  style={inputStyle}
                  value={draft.deposit_refundable_pct}
                  onChange={(e) => set("deposit_refundable_pct", e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Maintenance (₹)</FieldLabel>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  style={inputStyle}
                  value={draft.maintenance}
                  onChange={(e) => set("maintenance", e.target.value)}
                />
              </div>
            </div>
            <div style={{ maxWidth: 160 }}>
              <FieldLabel>Rent due day (1-28)</FieldLabel>
              <input
                className="admin-input"
                type="number"
                min={1}
                max={28}
                style={inputStyle}
                value={draft.rent_due_day}
                onChange={(e) => set("rent_due_day", e.target.value)}
              />
            </div>
            <div>
              <FieldLabel>Payment modes</FieldLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {PAYMENT_MODE_OPTIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className="admin-chip"
                    aria-pressed={draft.payment_modes.includes(m)}
                    onClick={() => togglePayment(m)}
                  >
                    {titleCase(m)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Stay terms">
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <FieldLabel>Notice (days)</FieldLabel>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  max={180}
                  style={inputStyle}
                  value={draft.notice_period_days}
                  onChange={(e) => set("notice_period_days", e.target.value)}
                />
              </div>
              <div>
                <FieldLabel>Lock-in (months)</FieldLabel>
                <input
                  className="admin-input"
                  type="number"
                  min={0}
                  max={24}
                  style={inputStyle}
                  value={draft.lock_in_months}
                  onChange={(e) => set("lock_in_months", e.target.value)}
                />
              </div>
            </div>
            <div>
              <FieldLabel>Electricity</FieldLabel>
              <select
                className="admin-input"
                style={inputStyle}
                value={draft.electricity_mode}
                onChange={(e) => set("electricity_mode", e.target.value)}
              >
                <option value="">-</option>
                <option value="flat">Flat</option>
                <option value="submetered">Sub-metered</option>
                <option value="split_equally">Split equally</option>
              </select>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Food">
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={draft.meals_provided}
                onChange={(e) => set("meals_provided", e.target.checked)}
              />
              Meals provided
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
                opacity: draft.meals_provided ? 1 : 0.5
              }}
            >
              <input
                type="checkbox"
                disabled={!draft.meals_provided}
                checked={draft.meals_veg_only}
                onChange={(e) => set("meals_veg_only", e.target.checked)}
              />
              Veg only
            </label>
            <div style={{ maxWidth: 180 }}>
              <FieldLabel>Meal charges (₹/mo)</FieldLabel>
              <input
                className="admin-input"
                type="number"
                min={0}
                style={inputStyle}
                value={draft.meal_charges}
                onChange={(e) => set("meal_charges", e.target.value)}
              />
            </div>
          </div>
        </SectionCard>

        <SectionCard title="House rules" subtitle="Toggle what's allowed.">
          <div style={{ display: "grid", gap: 8 }}>
            {HOUSE_RULES.map((r) => (
              <label
                key={r.rule}
                style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={draft[r.key] as boolean}
                  onChange={(e) => set(r.key, e.target.checked as never)}
                />
                {r.label} allowed
              </label>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Amenities" subtitle="Read-only here. Edit from the operator wizard.">
          <Chips items={amenityList} />
        </SectionCard>
      </div>

      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          position: "sticky",
          bottom: 0,
          paddingTop: 8
        }}
      >
        <button
          type="button"
          className="admin-btn admin-btn--primary"
          disabled={!dirty || saving}
          onClick={() => setConfirm(true)}
        >
          {saving ? "Saving…" : "Save details"}
        </button>
        {dirty && <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>Unsaved changes</span>}
      </div>

      <ConfirmDialog
        open={confirm}
        title="Save listing details?"
        body={
          <div style={{ fontSize: 13, color: "var(--ad-text-2)" }}>
            This updates the live listing and is logged to the admin audit trail.
          </div>
        }
        confirmLabel="Save details"
        busy={saving}
        onCancel={() => setConfirm(false)}
        onConfirm={save}
      />
    </div>
  );
}
