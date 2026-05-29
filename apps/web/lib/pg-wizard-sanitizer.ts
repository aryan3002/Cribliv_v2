import type { PgListingPayload } from "@cribliv/shared-types";

/**
 * Wizard draft partial. Each top-level slice is independently shallow-Partial so
 * arrays (`room_types`) keep proper Array typing instead of becoming a
 * weird index-Partial (which a naive `Partial2<T>` would produce).
 */
export type DraftPartial = {
  property?: Partial<PgListingPayload["property"]>;
  pg_details?: Partial<PgListingPayload["pg_details"]>;
  room_types?: Array<Partial<PgListingPayload["room_types"][number]>>;
};

function stripObject<T extends Record<string, unknown>>(obj: T): T | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    out[k] = v;
  }
  return Object.keys(out).length ? (out as T) : undefined;
}

export function sanitizePartialDraft(d: DraftPartial): DraftPartial {
  const out: DraftPartial = {};
  if (d.property) {
    const p: Record<string, unknown> = { ...d.property };
    if (typeof p.display_name === "string" && p.display_name.trim().length < 2)
      delete p.display_name;
    if (typeof p.city_slug === "string" && p.city_slug.trim() === "") delete p.city_slug;
    const stripped = stripObject(p);
    if (stripped) out.property = stripped as DraftPartial["property"];
  }
  if (d.pg_details) {
    const g: Record<string, unknown> = { ...d.pg_details };
    if (typeof g.total_beds === "number" && (!Number.isInteger(g.total_beds) || g.total_beds < 1)) {
      delete g.total_beds;
    }
    const stripped = stripObject(g);
    if (stripped) out.pg_details = stripped as DraftPartial["pg_details"];
  }
  if (Array.isArray(d.room_types)) {
    const filtered = d.room_types.filter(
      (rt) =>
        rt &&
        typeof rt.monthly_rent_paise === "number" &&
        rt.monthly_rent_paise > 0 &&
        typeof rt.vacancy_count === "number" &&
        rt.vacancy_count > 0
    );
    if (filtered.length) out.room_types = filtered as DraftPartial["room_types"];
  }
  return out;
}
