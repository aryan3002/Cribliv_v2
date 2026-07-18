// PG Operator REST adapter — thin wrappers over the canonical `fetchApi`.
// Convention:
//   - Read endpoints + simple POSTs (no Idempotency-Key required) → positional `(body?, token?)`
//   - Mutating endpoints with Idempotency-Key → object-arg `({ idempotencyKey, payload|input, token? })`
// `fetchApi` already unwraps the backend `{ data, meta }` envelope; do NOT add an unwrap here.

import { fetchApi } from "./api";
import type {
  PgDashboardData,
  PgSegmentationResult,
  PgProperty,
  PgListingPayload
} from "@cribliv/shared-types";

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function genIdempotencyKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

export function getMe(token?: string) {
  return fetchApi<{ operator: { id: string; role: string }; properties: PgProperty[] }>(
    "/pg-operator/me",
    { headers: authHeaders(token) }
  );
}

export function segment(
  body: { total_beds: number; property_count?: number; has_existing_listings?: boolean },
  token?: string
) {
  return fetchApi<PgSegmentationResult>("/pg-operator/segment", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function getOnboardingState(token?: string) {
  return fetchApi<{ state: "needs_property" | "ready_to_list"; property_count: number }>(
    "/pg-operator/onboarding-state",
    { headers: authHeaders(token) }
  );
}

export function getDashboard(token?: string) {
  // no-store: per-operator authed data + admin analytics overrides must reflect
  // immediately (a cut/restore can't linger behind a static cache).
  return fetchApi<PgDashboardData>("/pg-operator/dashboard", {
    headers: authHeaders(token),
    cache: "no-store"
  });
}

/**
 * Reveal a lead's real tenant contact. Dev-revealed for now; in V1.5 this is
 * gated behind the operator-pays plan (the API returns 402 payment_required).
 */
export function openPgLead(leadId: string, token?: string) {
  return fetchApi<{ lead_id: string; phone: string | null; tenant_name: string }>(
    `/pg-operator/leads/${leadId}/open`,
    { method: "POST", headers: authHeaders(token) }
  );
}

export type PgLeadStatus = "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";

/**
 * Move a lead through the pipeline. Backed by the shared LeadsService transition
 * graph (same as owner). NOTE: the PATCH /pg-operator/leads/:id/status route must
 * exist on the API for this to persist across reloads.
 */
export function updatePgLeadStatus(leadId: string, status: PgLeadStatus, token?: string) {
  return fetchApi<{ lead_id: string; status: string }>(`/pg-operator/leads/${leadId}/status`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ status })
  });
}

export function createPgListing(args: {
  idempotencyKey: string;
  payload: PgListingPayload;
  token?: string;
}) {
  return fetchApi<{ listing_id: string; status: string }>("/pg-operator/listings", {
    method: "POST",
    headers: {
      ...authHeaders(args.token),
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey
    },
    body: JSON.stringify(args.payload)
  });
}

/**
 * BUG-M1 — load a committed listing back into the wizard. Returns the EXACT
 * PgListingPayload (inverse of the write path); ownership-scoped server-side.
 */
export function getPgListingEditPayload(id: string, token?: string) {
  return fetchApi<PgListingPayload>(`/pg-operator/listings/${id}/edit`, {
    headers: authHeaders(token)
  });
}

/**
 * BUG-M1 — save an edited listing back to the SAME id (re-enters pending_review
 * per the MATERIAL-EDIT rule). Idempotency-keyed like create; the wizard sends a
 * fresh key per save.
 */
export function updatePgListing(args: {
  id: string;
  idempotencyKey: string;
  payload: PgListingPayload;
  token?: string;
}) {
  return fetchApi<{ listing_id: string; status: string }>(`/pg-operator/listings/${args.id}`, {
    method: "PUT",
    headers: {
      ...authHeaders(args.token),
      "Content-Type": "application/json",
      "Idempotency-Key": args.idempotencyKey
    },
    body: JSON.stringify(args.payload)
  });
}

export interface PgListingDetail {
  id: string;
  status: string;
  title: string | null;
  monthly_rent: number | null;
  created_at: string | null;
  city_slug: string | null;
  locality_slug: string | null;
  verification_status: string | null;
  has_exact_geo: boolean;
  /** Persisted quality score 0-100, matches the dashboard exactly. 0 for unscored listings. */
  composite_score: number;
  pg_details: {
    total_beds: number | null;
    gender_policy: string | null;
    tenant_type: string | null;
    security_deposit_paise: number | null;
    notice_period_days: number | null;
    lock_in_months: number | null;
    electricity_mode: string | null;
    rent_due_day: number | null;
    price_negotiable: boolean;
    payment_modes: string[];
    meals: Record<string, unknown> | null;
    amenities: Record<string, unknown>;
    house_rules: Record<string, unknown>;
  };
  room_types: Array<{
    sharing: string;
    ac: boolean;
    bathroom_kind: string | null;
    furnishing: string | null;
    has_balcony: boolean;
    monthly_rent_paise: number;
    vacancy_count: number;
    security_deposit_paise: number | null;
    deposit_refundable_pct: number | null;
    available_from: string | null;
  }>;
  photos: Array<{ blob_path: string; is_cover: boolean }>;
  // Owner-style edit hydration: structured photos with id + order (drives the
  // wizard's existing-photo grid + reorder on save).
  photoItems: Array<{
    id: string;
    url: string;
    blob_path: string;
    sort_order: number;
    is_cover: boolean;
  }>;
}

export function getPgListingDetail(id: string, token?: string) {
  return fetchApi<PgListingDetail>(`/pg-operator/listings/${id}`, {
    headers: authHeaders(token)
  });
}

export type PgListingVisibility = "active" | "paused" | "archived";

/** Toggle a live listing's public visibility (active ↔ paused, or archived). */
export function setPgListingStatus(id: string, status: PgListingVisibility, token?: string) {
  return fetchApi<{ id: string; status: string }>(`/pg-operator/listings/${id}/status`, {
    method: "PATCH",
    headers: authHeaders(token),
    body: JSON.stringify({ status })
  });
}

/** Submit a draft listing for admin review (draft → pending_review). */
export function submitPgListing(id: string, token?: string) {
  return fetchApi<{ listing_id: string; status: string }>(`/pg-operator/listings/${id}/submit`, {
    method: "POST",
    headers: authHeaders(token)
  });
}

// NOTE: no createPgProperty helper. Under 1 listing : 1 property, properties are
// only created via listing publish (createPgListing) — there is no standalone
// create-property endpoint, so a property is never born without a listing.

// ─── Canonical localities (shared with SEO + CriblMaps) ───────────────────────
// The wizard MUST pick locality from this canonical set so listings are findable
// by locality search, SEO landing pages, and the map — never free Places text.
export interface PgCityLocality {
  slug: string;
  name_en: string;
  lat: number | null;
  lng: number | null;
}

const localityCache = new Map<string, { items: PgCityLocality[] }>();

export async function listCityLocalities(citySlug: string): Promise<{ items: PgCityLocality[] }> {
  if (localityCache.has(citySlug)) return localityCache.get(citySlug)!;

  if (typeof window !== "undefined") {
    const raw = window.sessionStorage.getItem(`pg:loc:${citySlug}`);
    if (raw) {
      const cached = { items: JSON.parse(raw) as PgCityLocality[] };
      localityCache.set(citySlug, cached);
      return cached;
    }
  }

  const result = await fetchApi<{ items: PgCityLocality[] }>(
    `/seo/localities/${encodeURIComponent(citySlug)}`
  );
  localityCache.set(citySlug, result);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(`pg:loc:${citySlug}`, JSON.stringify(result.items));
  }
  return result;
}

export async function getPgNearby(
  token: string,
  lat: number,
  lng: number
): Promise<{ metro: string[]; college: string[]; office: string[] }> {
  // Always resolve to a fully-shaped result — a missing/partial body (or any
  // network error) must never leave a category `undefined`, which previously
  // crashed the location step (`postgisNearby[category]` on undefined).
  try {
    const res = await fetchApi<{
      metro?: string[];
      college?: string[];
      office?: string[];
    } | null>(`/pg-operator/listings/nearby?lat=${lat}&lng=${lng}`, {
      headers: authHeaders(token)
    });
    return {
      metro: res?.metro ?? [],
      college: res?.college ?? [],
      office: res?.office ?? []
    };
  } catch {
    return { metro: [], college: [], office: [] };
  }
}

// ─── Draft persistence (§6.2) ─────────────────────────────────────────────────

export interface PgDraftSummary {
  draft_id: string;
  display_name: string;
  updated_at: string;
  committed_listing_id: string | null;
}

export function putPgDraft(
  token: string,
  input: {
    draft_id?: string;
    payload: PgListingPayload;
    field_confidence?: Record<string, number>;
    source: "manual" | "voice";
    pg_property_id?: string | null;
  }
) {
  return fetchApi<{ draft_id: string; updated_at: string }>("/pg-operator/listings/draft", {
    method: "PUT",
    headers: {
      ...authHeaders(token),
      "Content-Type": "application/json",
      "Idempotency-Key": genIdempotencyKey()
    },
    body: JSON.stringify(input)
  });
}

export function listPgDrafts(token?: string) {
  return fetchApi<{ items: PgDraftSummary[] }>("/pg-operator/listings/drafts", {
    headers: authHeaders(token)
  });
}

export function getPgDraft(token: string, draftId: string) {
  return fetchApi<{
    draft_id: string;
    payload: PgListingPayload;
    field_confidence: Record<string, number>;
    updated_at: string;
  }>(`/pg-operator/listings/draft/${draftId}`, { headers: authHeaders(token) });
}

export function deletePgDraft(token: string, draftId: string) {
  return fetchApi<void>(`/pg-operator/listings/draft/${draftId}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
}

// ─── AI assist stubs (§6.4) — endpoints ship in Plan 2; wizard shows soft toast until then ──

export class AiAssistUnavailable extends Error {
  constructor() {
    super("AI assist coming soon");
    this.name = "AiAssistUnavailable";
  }
}

function handleAiUnavailable(err: unknown): never {
  if ((err as any)?.status === 404 || (err as any)?.message?.includes("404")) {
    throw new AiAssistUnavailable();
  }
  throw err;
}

export function generatePgContent(
  token: string,
  payload: PgListingPayload
): Promise<{ title: string; description: string }> {
  return (
    fetchApi<{ title?: string; description?: string } | null>(
      "/pg-operator/listings/generate-content",
      {
        method: "POST",
        headers: { ...authHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({ payload })
      }
    )
      // Normalize before the caller reads .title/.description so an unexpected
      // empty/partial body can't throw "reading 'title' of undefined".
      .then((res) => ({ title: res?.title ?? "", description: res?.description ?? "" }))
      .catch(handleAiUnavailable)
  );
}

export function getPgPricingSuggestions(
  token: string,
  input: { city_slug: string; locality_slug?: string; sharings: string[] }
) {
  return fetchApi<{
    suggestions: Array<{
      sharing: string;
      p25_paise: number;
      p50_paise: number;
      p75_paise: number;
      sample: number;
    }>;
  }>("/pg-operator/listings/pricing-suggestions", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).catch(handleAiUnavailable);
}

export function getPgAmenitySuggestions(token: string, payload: PgListingPayload) {
  return fetchApi<{ amenities: string[]; house_rules: string[] }>(
    "/pg-operator/listings/amenity-suggestions",
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({ payload })
    }
  ).catch(handleAiUnavailable);
}

// ─── Sales-assist lead ──────────────────────────────────────────────────────────────────────

// Sales-assist lead for large PGs routed off the self-serve wizard. Posts to the
// canonical sales endpoint (POST /sales/leads, source=pg_sales_assist); the
// bed/city/phone the form collects ride along in `metadata` for sales follow-up.
// (Previously POSTed to a non-existent /pg-operator/sales-assist-lead route → 404.)
export function submitSalesAssistLead(
  body: { total_beds: number; city: string; phone: string; notes?: string },
  token?: string
) {
  return fetchApi<{ id: string; status: string; source: string }>("/sales/leads", {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "pg_sales_assist",
      notes: body.notes,
      metadata: { total_beds: body.total_beds, city: body.city, phone: body.phone }
    })
  });
}
