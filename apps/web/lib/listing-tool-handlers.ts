/* ──────────────────────────────────────────────────────────────────────
 * listing-tool-handlers.ts
 *
 * Pure mapping: tool call from Maya  →  next form state + UI hints.
 *
 * The page uses these to (a) update the wizard form, (b) animate the
 * fields that just changed (gold-leaf glow + chip slide), and (c)
 * optionally jump to a different step.
 *
 * No React, no DOM. Just a switch + a small normaliser. All voice
 * decisions live in one place so manual edits and voice edits go
 * through the same reducer.
 * ──────────────────────────────────────────────────────────────────── */

import type {
  WizardForm,
  Furnishing,
  ListingType,
  SharingType
} from "../components/listing-wizard/types";
import {
  AMENITIES_FLAT,
  AMENITIES_PG,
  CITIES,
  EMPTY_FORM
} from "../components/listing-wizard/types";

/* ─── Output of every tool dispatch ────────────────────────────────── */
export interface ToolDispatchResult {
  nextForm: WizardForm;
  nextStep?: number;
  fieldsAnimated: (keyof WizardForm)[];
  toast?: string;
  /** A typed signal the UI can react to (e.g. trigger AI title gen). */
  uiAction?: "generate_title" | "request_review" | "summarize";
  /** Verbatim message to send back as the function output. */
  toolOutput: Record<string, unknown>;
}

const ALLOWED_FURNISHING: Furnishing[] = ["unfurnished", "semi_furnished", "fully_furnished"];
const ALLOWED_SHARING: SharingType[] = ["single", "double", "triple", "quad"];
const ALLOWED_TENANT = ["any", "family", "bachelor", "female", "male"];
const CITY_SLUGS = CITIES.map((c) => c.toLowerCase());

const ALLOWED_AMENITIES = new Set<string>([...AMENITIES_FLAT, ...AMENITIES_PG]);

/* ─── Helpers ──────────────────────────────────────────────────────── */

function asNumberString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(Math.round(value));
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[, _]/g, "").trim();
    const n = Number(cleaned);
    if (Number.isFinite(n) && n >= 0) return String(Math.round(n));
  }
  return null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (["yes", "true", "haan", "1"].includes(v)) return true;
    if (["no", "false", "nahin", "nahi", "0"].includes(v)) return false;
  }
  return null;
}

function normaliseAmenities(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const filtered = value
    .map((v) => (typeof v === "string" ? v.trim() : null))
    .filter((v): v is string => Boolean(v));
  // Match against allowed set case-insensitively, but keep the
  // canonical (capitalised) form so checkbox state lights up.
  const canonical = new Map<string, string>();
  for (const allowed of ALLOWED_AMENITIES) canonical.set(allowed.toLowerCase(), allowed);
  const out: string[] = [];
  for (const item of filtered) {
    const c = canonical.get(item.toLowerCase());
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

function normaliseCity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lower = value.trim().toLowerCase();
  if (CITY_SLUGS.includes(lower)) return lower;
  // Allow casual variants ("bengaluru" → "bangalore") if our list expands later.
  return null;
}

/* ─── update_listing_fields ───────────────────────────────────────── */

export function applyUpdateListingFields(
  prev: WizardForm,
  args: Record<string, unknown>
): ToolDispatchResult {
  const next: WizardForm = { ...prev };
  const animated: (keyof WizardForm)[] = [];

  function set<K extends keyof WizardForm>(key: K, value: WizardForm[K]) {
    if (next[key] !== value) {
      next[key] = value;
      animated.push(key);
    }
  }

  if (args.listing_type === "pg" || args.listing_type === "flat_house") {
    set("listing_type", args.listing_type as ListingType);
  }

  if ("monthly_rent" in args) {
    const v = asNumberString(args.monthly_rent);
    if (v) set("monthly_rent", v);
  }
  if ("deposit" in args) {
    const v = asNumberString(args.deposit);
    if (v) set("deposit", v);
  }
  if (typeof args.furnishing === "string") {
    const f = args.furnishing as Furnishing;
    if (ALLOWED_FURNISHING.includes(f)) set("furnishing", f);
  }

  if ("city" in args) {
    const c = normaliseCity(args.city);
    if (c) set("city", c);
  }
  if ("locality" in args) {
    const v = asString(args.locality);
    if (v) set("locality", v);
  }
  if ("address" in args) {
    const v = asString(args.address);
    if (v) set("address", v);
  }
  if ("landmark" in args) {
    const v = asString(args.landmark);
    if (v) set("landmark", v);
  }
  if ("pincode" in args) {
    const v = asString(args.pincode);
    if (v && /^\d{6}$/.test(v)) set("pincode", v);
  }

  if ("bedrooms" in args) {
    const v = asNumberString(args.bedrooms);
    if (v) set("bedrooms", v);
  }
  if ("bathrooms" in args) {
    const v = asNumberString(args.bathrooms);
    if (v) set("bathrooms", v);
  }
  if ("area_sqft" in args) {
    const v = asNumberString(args.area_sqft);
    if (v) set("area_sqft", v);
  }
  if (typeof args.preferred_tenant === "string" && ALLOWED_TENANT.includes(args.preferred_tenant)) {
    set("preferred_tenant", args.preferred_tenant);
  }

  if ("beds" in args) {
    const v = asNumberString(args.beds);
    if (v) set("beds", v);
  }
  if (typeof args.sharing_type === "string") {
    const s = args.sharing_type as SharingType;
    if (ALLOWED_SHARING.includes(s)) set("sharing_type", s);
  }
  if ("meals_included" in args) {
    const v = asBoolean(args.meals_included);
    if (v != null) set("meals_included", v);
  }
  if ("attached_bathroom" in args) {
    const v = asBoolean(args.attached_bathroom);
    if (v != null) set("attached_bathroom", v);
  }

  if ("amenities" in args) {
    const a = normaliseAmenities(args.amenities);
    if (a && JSON.stringify(a) !== JSON.stringify(prev.amenities)) {
      next.amenities = a;
      animated.push("amenities");
    }
  }

  if ("title" in args) {
    const v = asString(args.title);
    if (v && v.length <= 120) set("title", v);
  }
  if ("description" in args) {
    const v = asString(args.description);
    if (v) set("description", v);
  }

  return {
    nextForm: next,
    fieldsAnimated: animated,
    toolOutput: {
      ok: true,
      updated_fields: animated,
      message:
        animated.length === 0
          ? "No fields changed."
          : `Updated ${animated.length} field${animated.length > 1 ? "s" : ""}.`
    }
  };
}

/* ─── navigate_to_step ─────────────────────────────────────────────── */

export function applyNavigateToStep(
  prev: WizardForm,
  args: Record<string, unknown>
): ToolDispatchResult {
  const raw = typeof args.step === "number" ? args.step : Number(args.step);
  const step = Number.isFinite(raw) ? Math.max(0, Math.min(5, Math.round(raw))) : null;
  const reason = typeof args.reason === "string" ? args.reason : undefined;
  return {
    nextForm: prev,
    fieldsAnimated: [],
    nextStep: step ?? undefined,
    toast: reason,
    toolOutput: { ok: step != null, step, message: step != null ? "Navigated." : "Invalid step." }
  };
}

/* ─── generate_title_and_description ──────────────────────────────── */

export function applyGenerateTitle(prev: WizardForm): ToolDispatchResult {
  return {
    nextForm: prev,
    fieldsAnimated: [],
    uiAction: "generate_title",
    toolOutput: {
      ok: true,
      message: "Drafting title and description in the form now."
    }
  };
}

/* ─── request_review ───────────────────────────────────────────────── */

export function applyRequestReview(prev: WizardForm): ToolDispatchResult {
  return {
    nextForm: prev,
    fieldsAnimated: [],
    nextStep: 5,
    uiAction: "request_review",
    toolOutput: { ok: true, message: "Moved to review." }
  };
}

/* ─── summarize_progress ───────────────────────────────────────────── */

export function applySummarize(prev: WizardForm): ToolDispatchResult {
  return {
    nextForm: prev,
    fieldsAnimated: [],
    uiAction: "summarize",
    toolOutput: {
      ok: true,
      summary: summariseForm(prev)
    }
  };
}

/* ─── Top-level dispatch ───────────────────────────────────────────── */

export function dispatchToolCall(
  toolName: string,
  args: Record<string, unknown>,
  prev: WizardForm
): ToolDispatchResult | null {
  switch (toolName) {
    case "update_listing_fields":
      return applyUpdateListingFields(prev, args);
    case "navigate_to_step":
      return applyNavigateToStep(prev, args);
    case "generate_title_and_description":
      return applyGenerateTitle(prev);
    case "request_review":
      return applyRequestReview(prev);
    case "summarize_progress":
      return applySummarize(prev);
    default:
      return null;
  }
}

/* ─── Form snapshot helpers (for sending context to Maya) ─────────── */

/**
 * Strip empty / default values out of the WizardForm so we don't waste
 * tokens telling Maya "title=, description=, deposit=" repeatedly.
 */
export function getFilledFields(form: WizardForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(form) as (keyof WizardForm)[];
  for (const key of keys) {
    const value = form[key];
    if (value === EMPTY_FORM[key]) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** Field names still missing — drives Maya's prioritisation. */
export function getMissingFields(form: WizardForm): string[] {
  const required: (keyof WizardForm)[] = ["listing_type", "monthly_rent", "city", "title"];
  const niceToHave: (keyof WizardForm)[] = [
    "deposit",
    "furnishing",
    "locality",
    "bedrooms",
    "bathrooms",
    "area_sqft",
    "amenities",
    "description"
  ];
  const isPg = form.listing_type === "pg";
  const pgFields: (keyof WizardForm)[] = ["beds", "sharing_type"];
  const flatFields: (keyof WizardForm)[] = ["bedrooms", "bathrooms"];

  const all: (keyof WizardForm)[] = [
    ...required,
    ...niceToHave.filter((k) => !(isPg ? flatFields.includes(k) : pgFields.includes(k))),
    ...(isPg ? pgFields : [])
  ];

  return all.filter((k) => {
    const v = form[k];
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === "string") return v.trim().length === 0;
    return v == null;
  });
}

/** Plain-language summary used both in chips and in summarize_progress. */
export function summariseForm(form: WizardForm): string {
  const parts: string[] = [];
  if (form.listing_type) parts.push(form.listing_type === "pg" ? "PG" : "Flat / House");
  if (form.bedrooms) parts.push(`${form.bedrooms} BHK`);
  else if (form.beds) parts.push(`${form.beds} beds`);
  if (form.locality && form.city) parts.push(`${form.locality}, ${cap(form.city)}`);
  else if (form.city) parts.push(cap(form.city));
  if (form.monthly_rent) parts.push(`₹${Number(form.monthly_rent).toLocaleString("en-IN")}/mo`);
  if (form.furnishing) parts.push(form.furnishing.replace(/_/g, " "));
  if (form.amenities.length) parts.push(`${form.amenities.length} amenities`);
  return parts.length === 0 ? "Nothing captured yet." : parts.join(" • ");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
