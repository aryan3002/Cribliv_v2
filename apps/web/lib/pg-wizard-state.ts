// apps/web/lib/pg-wizard-state.ts
import type { PgListingPayload } from "@cribliv/shared-types";
import type { DraftPartial } from "./pg-wizard-sanitizer";

export type PgWizardStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface PgWizardUndoEntry {
  field: string;
  previousValue: unknown;
  newValue: unknown;
  confidence: number;
  ts: number;
}

/** UI-only scratch state. NEVER serialised into a submit payload. */
export interface PgWizardUi {
  /** Which sharing kinds the operator wants offered (drives Step 2 matrix rows). */
  sharing_options?: Array<"single" | "double" | "triple" | "quad" | "dorm">;
}

/**
 * A photo queued for upload. We collect files BEFORE the listing exists,
 * upload them via Azure SAS only after the wizard's POST returns a listing_id.
 * `previewUrl` is an in-memory blob URL; not persisted across reloads (by design —
 * Files can't survive a refresh, sessionStorage can't either).
 */
export interface PendingPhoto {
  clientUploadId: string;
  file: File;
  previewUrl: string;
  sizeBytes: number;
  contentType: string;
  sortOrder: number;
  isCover: boolean;
  // Edit mode (owner-style): existing server photos are seeded as `complete`
  // with their persisted ids so they render, count toward the minimum, and are
  // reordered (not re-uploaded). New photos stay `pending`/undefined.
  status?: "pending" | "complete";
  photoId?: string;
  blobPath?: string;
}

export interface PgWizardState {
  draft: DraftPartial;
  ui: PgWizardUi;
  currentStep: PgWizardStep;
  undoStack: PgWizardUndoEntry[];
  draftId?: string;
  pgPropertyId?: string; // set after Task 0 endpoint creates the property
  idempotencyKey?: string;
  submitting: boolean;
  submitError?: string;
  /** Photos queued in step 6; uploaded post-create. Not persisted to sessionStorage. */
  pendingPhotos: PendingPhoto[];
  /** Optional assistant-mode toggle (voice ↔ text). Persists across step nav. */
  assistantMode?: "voice" | "text";
}

export type PgWizardAction =
  | { type: "SET_FIELD"; path: string; value: unknown }
  | { type: "SET_UI_FIELD"; path: keyof PgWizardUi; value: unknown }
  | { type: "MERGE_DRAFT"; partial: DraftPartial }
  | {
      type: "UPSERT_ROOM_TYPE";
      row: NonNullable<PgListingPayload["room_types"]>[number];
    }
  | { type: "REMOVE_ROOM_TYPE"; key: string }
  | { type: "GOTO_STEP"; step: number }
  | {
      type: "VOICE_EXTRACTED";
      field: string;
      value: unknown;
      confidence: number;
    }
  | { type: "UNDO_LAST" }
  | { type: "SET_DRAFT_ID"; draftId: string }
  | { type: "SET_PG_PROPERTY_ID"; pgPropertyId: string }
  | { type: "SUBMIT_BEGIN" }
  | { type: "SUBMIT_OK" }
  | { type: "SUBMIT_FAIL"; error: string }
  | { type: "ADD_PHOTOS"; photos: PendingPhoto[] }
  | { type: "HYDRATE_PHOTOS"; photos: PendingPhoto[] }
  | { type: "REMOVE_PHOTO"; clientUploadId: string }
  | { type: "SET_COVER_PHOTO"; clientUploadId: string }
  | { type: "REORDER_PHOTOS"; orderedIds: string[] }
  | { type: "CLEAR_PHOTOS" }
  | { type: "SET_ASSISTANT_MODE"; mode: "voice" | "text" }
  | {
      type: "HYDRATE_DRAFT";
      draftId: string;
      payload: DraftPartial;
      field_confidence?: Record<string, number>;
    };

export function initialPgWizardState(): PgWizardState {
  return {
    draft: {},
    ui: {},
    currentStep: 1,
    undoStack: [],
    submitting: false,
    pendingPhotos: []
  };
}

// Rent bounds per pg-extraction-schema.ts PricingMatrixSchema
const RENT_MIN_PAISE = 200_000; // ₹2,000
const RENT_MAX_PAISE = 5_000_000; // ₹50,000
export const RENT_BOUNDS = { min: RENT_MIN_PAISE, max: RENT_MAX_PAISE };

function setByPath(obj: any, path: string, value: unknown): any {
  const keys = path.split(".");
  const next = { ...obj };
  let cur: any = next;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...(cur[keys[i]] ?? {}) };
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return next;
}

function getByPath(obj: any, path: string): unknown {
  return path.split(".").reduce<any>((acc, k) => (acc ? acc[k] : undefined), obj);
}

export function cellKey(rt: {
  sharing: string;
  ac: boolean;
  bathroom_kind?: string;
  furnishing?: string;
  has_balcony?: boolean;
}): string {
  return `${rt.sharing}|${rt.ac}|${rt.bathroom_kind ?? "attached_western"}|${rt.furnishing ?? "semi_furnished"}|${rt.has_balcony ? 1 : 0}`;
}

function deepMerge<T>(a: T, b: T): T {
  if (typeof a !== "object" || typeof b !== "object" || a == null || b == null) {
    return (b ?? a) as T;
  }
  if (Array.isArray(b)) return b as T;
  const out: any = { ...(a as any) };
  for (const k of Object.keys(b as any)) {
    out[k] = deepMerge((a as any)[k], (b as any)[k]);
  }
  return out;
}

function genIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fallthrough
  }
  // Fallback: timestamp + random hex (RFC4122-ish, not cryptographically strong).
  const rand = Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${rand}`;
}

export function pgWizardReducer(state: PgWizardState, action: PgWizardAction): PgWizardState {
  switch (action.type) {
    case "SET_FIELD":
      return {
        ...state,
        draft: setByPath(state.draft, action.path, action.value)
      };
    case "SET_UI_FIELD":
      return {
        ...state,
        ui: { ...state.ui, [action.path]: action.value } as PgWizardUi
      };
    case "MERGE_DRAFT":
      return {
        ...state,
        draft: deepMerge(state.draft as any, action.partial as any)
      };
    case "UPSERT_ROOM_TYPE": {
      const existing = state.draft.room_types ?? [];
      const k = cellKey(action.row as any);
      const filtered = existing.filter((r) => cellKey(r as any) !== k);
      return {
        ...state,
        draft: {
          ...state.draft,
          room_types: [...filtered, action.row] as any
        }
      };
    }
    case "REMOVE_ROOM_TYPE": {
      const existing = state.draft.room_types ?? [];
      return {
        ...state,
        draft: {
          ...state.draft,
          room_types: existing.filter((r) => cellKey(r as any) !== action.key) as any
        }
      };
    }
    case "GOTO_STEP":
      return {
        ...state,
        currentStep: Math.min(7, Math.max(1, action.step)) as PgWizardStep
      };
    case "HYDRATE_DRAFT":
      return {
        ...state,
        draftId: action.draftId,
        draft: deepMerge(state.draft as any, action.payload as any)
      };
    case "VOICE_EXTRACTED": {
      const prev = getByPath(state.draft, action.field);
      return {
        ...state,
        draft: setByPath(state.draft, action.field, action.value),
        undoStack: [
          ...state.undoStack,
          {
            field: action.field,
            previousValue: prev,
            newValue: action.value,
            confidence: action.confidence,
            ts: Date.now()
          }
        ]
      };
    }
    case "UNDO_LAST": {
      const entry = state.undoStack[state.undoStack.length - 1];
      if (!entry) return state;
      return {
        ...state,
        draft: setByPath(state.draft, entry.field, entry.previousValue),
        undoStack: state.undoStack.slice(0, -1)
      };
    }
    case "SET_DRAFT_ID":
      return { ...state, draftId: action.draftId };
    case "SET_PG_PROPERTY_ID":
      return { ...state, pgPropertyId: action.pgPropertyId };
    case "SUBMIT_BEGIN":
      return {
        ...state,
        submitting: true,
        submitError: undefined,
        idempotencyKey: state.idempotencyKey ?? genIdempotencyKey()
      };
    case "SUBMIT_OK":
      return { ...state, submitting: false };
    case "SUBMIT_FAIL":
      return { ...state, submitting: false, submitError: action.error };
    case "HYDRATE_PHOTOS":
      // Seed existing server photos verbatim (preserve their order + cover);
      // unlike ADD_PHOTOS this does NOT recompute sortOrder/isCover.
      return { ...state, pendingPhotos: action.photos };
    case "ADD_PHOTOS": {
      const existing = state.pendingPhotos ?? [];
      // First-uploaded becomes cover by default when no cover exists yet.
      const hasCover = existing.some((p) => p.isCover);
      const incoming = action.photos.map((p, i) => ({
        ...p,
        sortOrder: existing.length + i,
        isCover: !hasCover && i === 0 ? true : p.isCover
      }));
      return { ...state, pendingPhotos: [...existing, ...incoming] };
    }
    case "REMOVE_PHOTO": {
      const removed = (state.pendingPhotos ?? []).find(
        (p) => p.clientUploadId === action.clientUploadId
      );
      if (removed) {
        try {
          URL.revokeObjectURL(removed.previewUrl);
        } catch {}
      }
      let remaining = (state.pendingPhotos ?? []).filter(
        (p) => p.clientUploadId !== action.clientUploadId
      );
      // If we removed the cover, promote the first remaining as cover.
      if (removed?.isCover && remaining.length > 0 && !remaining.some((p) => p.isCover)) {
        remaining = remaining.map((p, i) => (i === 0 ? { ...p, isCover: true } : p));
      }
      return { ...state, pendingPhotos: remaining };
    }
    case "SET_COVER_PHOTO":
      return {
        ...state,
        pendingPhotos: (state.pendingPhotos ?? []).map((p) => ({
          ...p,
          isCover: p.clientUploadId === action.clientUploadId
        }))
      };
    case "REORDER_PHOTOS": {
      const ids = action.orderedIds;
      const byId = new Map((state.pendingPhotos ?? []).map((p) => [p.clientUploadId, p]));
      const reordered = ids
        .map((id, i) => {
          const p = byId.get(id);
          return p ? { ...p, sortOrder: i } : null;
        })
        .filter((p): p is PendingPhoto => p != null);
      return { ...state, pendingPhotos: reordered };
    }
    case "CLEAR_PHOTOS": {
      for (const p of state.pendingPhotos ?? []) {
        try {
          URL.revokeObjectURL(p.previewUrl);
        } catch {}
      }
      return { ...state, pendingPhotos: [] };
    }
    case "SET_ASSISTANT_MODE":
      return { ...state, assistantMode: action.mode };
    default:
      return state;
  }
}

/**
 * Build a payload that strictly conforms to PgListingCreateSchema:
 *  - drops UI-only fields (sharing_options, room_config)
 *  - hoists meal_charges_paise from meals → pg_details
 *  - filters room_types entries with rent out of [₹2k, ₹50k]
 *  - drops any unknown top-level / pg_details keys we might have accumulated
 */
export function buildSubmitPayload(state: PgWizardState): PgListingPayload {
  const d: any = state.draft ?? {};
  const property = {
    display_name: d.property?.display_name ?? "",
    city_slug: d.property?.city_slug ?? "",
    ...(d.property?.locality_slug != null ? { locality_slug: d.property.locality_slug } : {}),
    ...(d.property?.internal_code != null ? { internal_code: d.property.internal_code } : {}),
    ...(d.property?.total_floors != null ? { total_floors: d.property.total_floors } : {})
  };

  const rawPg = { ...(d.pg_details ?? {}) };
  // Hoist meal_charges_paise if it ended up under meals (but don't overwrite an existing pg-level value)
  const rawMeals = { ...(rawPg.meals ?? {}) };
  if (rawMeals.meal_charges_paise != null && rawPg.meal_charges_paise == null) {
    rawPg.meal_charges_paise = rawMeals.meal_charges_paise;
  }
  delete (rawMeals as any).meal_charges_paise;
  if (Object.keys(rawMeals).length > 0) rawPg.meals = rawMeals;
  else delete rawPg.meals;

  // pg_details is .strict() — pick only schema-known keys.
  // ⚠ Must stay in sync with apps/api/src/modules/pg-operator/dto/pg-listing.dto.ts
  // (the `pg_details` block, lines 24-52). If backend adds a column, add it here OR
  // the wizard will silently drop it before submit.
  const PG_KEYS = new Set([
    "total_beds",
    "gender_policy",
    "tenant_type",
    "notice_period_days",
    "lock_in_months",
    "security_deposit_paise",
    "deposit_refundable_pct",
    "electricity_mode",
    "maintenance_paise",
    "rent_due_day",
    "payment_modes",
    "late_fee_policy",
    "price_negotiable",
    "meals",
    "meal_charges_paise",
    "amenities",
    "house_rules",
    "nearby"
  ]);
  const pg_details: any = { total_beds: rawPg.total_beds };
  for (const k of Object.keys(rawPg)) {
    if (PG_KEYS.has(k) && rawPg[k] !== undefined) pg_details[k] = rawPg[k];
  }

  // PgHouseRules requires these 5 booleans — default to false when untouched.
  if (pg_details.house_rules || rawPg.house_rules) {
    const hr = { ...(pg_details.house_rules ?? rawPg.house_rules ?? {}) };
    hr.smoking = hr.smoking ?? false;
    hr.alcohol = hr.alcohol ?? false;
    hr.non_veg = hr.non_veg ?? false;
    hr.pets = hr.pets ?? false;
    hr.cooking_in_room = hr.cooking_in_room ?? false;
    pg_details.house_rules = hr;
  }

  const room_types = Array.isArray(d.room_types)
    ? d.room_types.filter(
        (rt: any) =>
          rt &&
          typeof rt.monthly_rent_paise === "number" &&
          rt.monthly_rent_paise >= RENT_MIN_PAISE &&
          rt.monthly_rent_paise <= RENT_MAX_PAISE &&
          typeof rt.vacancy_count === "number" &&
          rt.vacancy_count > 0
      )
    : [];

  // Per-listing title (its own field) — kept distinct from the building name.
  const title = typeof d.title === "string" && d.title.trim() ? d.title.trim() : undefined;
  const description =
    typeof d.description === "string" && d.description.trim() ? d.description.trim() : undefined;

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    property,
    pg_details,
    room_types
  } as PgListingPayload;
}
