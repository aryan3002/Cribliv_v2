// apps/web/lib/pg-wizard-state.ts
import type { PgListingPayload } from "@cribliv/shared-types";
import type { DraftPartial } from "./pg-wizard-sanitizer";

export type PgWizardStep = 1 | 2 | 3 | 4 | 5 | 6;

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
  | { type: "SUBMIT_FAIL"; error: string };

export function initialPgWizardState(): PgWizardState {
  return {
    draft: {},
    ui: {},
    currentStep: 1,
    undoStack: [],
    submitting: false
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

function cellKey(rt: {
  sharing: string;
  ac: boolean;
  bathroom_kind?: string;
  furnishing?: string;
}): string {
  return `${rt.sharing}|${rt.ac}|${rt.bathroom_kind ?? "attached_western"}|${rt.furnishing ?? "semi_furnished"}`;
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
        currentStep: Math.min(6, Math.max(1, action.step)) as PgWizardStep
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

  return { property, pg_details, room_types } as PgListingPayload;
}
