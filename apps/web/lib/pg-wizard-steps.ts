export type PgStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const PG_STEP_ORDER: PgStep[] = [1, 2, 3, 4, 5, 6, 7];

export const STEP_META: Record<
  PgStep,
  { label: string; title: string; desc: string; minutes: number }
> = {
  1: {
    label: "Basics",
    title: "Property & Identity",
    desc: "Name, capacity, who it's for.",
    minutes: 1
  },
  2: {
    label: "Location",
    title: "Location",
    desc: "Pin the exact address and what's nearby.",
    minutes: 1
  },
  3: {
    label: "Rooms & Pricing",
    title: "Rooms & Pricing",
    desc: "Add room types, rent, and vacancies.",
    minutes: 2
  },
  4: {
    label: "Food & Amenities",
    title: "Food & Amenities",
    desc: "Meals and the facilities you offer.",
    minutes: 1
  },
  5: {
    label: "Rules & Agreement",
    title: "Rules & Agreement",
    desc: "House rules, deposit, and payment terms.",
    minutes: 2
  },
  6: {
    label: "Photos",
    title: "Photos",
    desc: "Show tenants around — photos build trust.",
    minutes: 1
  },
  7: {
    label: "Review",
    title: "Review & Publish",
    desc: "Check everything, then submit for review.",
    minutes: 1
  }
};

export function pgStepLabel(step: PgStep): string {
  return STEP_META[step].label;
}

export function nextStep(step: PgStep): PgStep {
  const i = PG_STEP_ORDER.indexOf(step);
  return PG_STEP_ORDER[Math.min(i + 1, PG_STEP_ORDER.length - 1)];
}

export function prevStep(step: PgStep): PgStep {
  const i = PG_STEP_ORDER.indexOf(step);
  return PG_STEP_ORDER[Math.max(i - 1, 0)];
}

/** Minimum photos required before publishing (mirrors PgReviewStep). */
export const PG_MIN_PHOTOS = 4;

export interface PgStepValidation {
  ok: boolean;
  /** Friendly message shown when the step is incomplete. */
  hint?: string;
}

/**
 * Per-step required-field gating. Returns ok:false + a friendly hint when the
 * operator hasn't filled the minimum to advance. Optional steps return ok:true.
 * `draft` is the wizard draft (DraftPartial); `photoCount` is pendingPhotos length.
 */
export function validatePgStep(step: PgStep, draft: any, photoCount = 0): PgStepValidation {
  const p = draft?.property ?? {};
  const d = draft?.pg_details ?? {};
  const rooms = draft?.room_types ?? [];
  switch (step) {
    case 1:
      if (!p.display_name || String(p.display_name).trim().length < 2)
        return { ok: false, hint: "Add a property name to continue." };
      if (!d.gender_policy) return { ok: false, hint: "Pick who the PG is for." };
      if (!d.tenant_type) return { ok: false, hint: "Choose a tenant type." };
      if (!((d.total_beds ?? 0) > 0)) return { ok: false, hint: "Set the total number of beds." };
      return { ok: true };
    case 2:
      if (!p.city_slug) return { ok: false, hint: "Select your city." };
      if (p.lat == null || p.lng == null)
        return { ok: false, hint: "Drop a pin on the map so tenants can find you." };
      return { ok: true };
    case 3:
      if (!Array.isArray(rooms) || rooms.length < 1)
        return { ok: false, hint: "Add at least one room type." };
      if (!rooms.some((r: any) => (r.monthly_rent_paise ?? 0) > 0))
        return { ok: false, hint: "Set monthly rent for your room type." };
      return { ok: true };
    case 4:
      return { ok: true }; // food & amenities are optional
    case 5:
      if (!((d.security_deposit_paise ?? 0) > 0))
        return { ok: false, hint: "Add a security deposit amount." };
      if (d.notice_period_days == null) return { ok: false, hint: "Choose a notice period." };
      return { ok: true };
    case 6:
      if (photoCount < PG_MIN_PHOTOS)
        return { ok: false, hint: `Add ${PG_MIN_PHOTOS - photoCount} more photo(s) to continue.` };
      return { ok: true };
    case 7:
    default:
      return { ok: true };
  }
}
