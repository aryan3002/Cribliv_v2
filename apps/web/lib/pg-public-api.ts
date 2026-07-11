import { fetchApi, buildSearchQuery } from "./api";

export type PgLocationSource = "exact" | "locality" | "city";

export interface PgMapPoint {
  lat: number;
  lng: number;
  source: PgLocationSource;
  label: string;
  city_slug: string;
  locality_slug: string | null;
}

export interface PgCard {
  id: string;
  title: string;
  city: string;
  city_name: string | null;
  locality: string | null;
  listing_type: "pg";
  starting_rent: number | null;
  sharing_options: string[];
  gender_policy: string | null;
  food_included: boolean;
  verified: boolean;
  cover_photo: string | null;
  lat: number | null;
  lng: number | null;
}

export interface PgSearchResponse {
  items: PgCard[];
  total: number;
  page: number;
  page_size: number;
}

export interface PgPublicDetail {
  id: string;
  status: string;
  title: string | null;
  monthly_rent: number | null;
  created_at: string | null;
  city_slug: string | null;
  locality_slug: string | null;
  location_point: PgMapPoint | null;
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
    monthly_rent_paise: number;
    vacancy_count: number;
    available_from: string | null;
  }>;
  photos: Array<{ blob_path: string; is_cover: boolean }>;
}

export function searchPgListings(
  query: Record<string, string>,
  opts: { server?: boolean } = {}
): Promise<PgSearchResponse> {
  const qs = buildSearchQuery(query);
  return fetchApi<PgSearchResponse>(`/pg/listings${qs ? `?${qs}` : ""}`, undefined, opts);
}

export function getPgPublicListing(
  id: string,
  opts: { server?: boolean } = {}
): Promise<PgPublicDetail> {
  return fetchApi<PgPublicDetail>(`/pg/listings/${id}`, undefined, opts);
}

export function expressPgInterest(
  id: string,
  token: string
): Promise<{ interested: boolean; created: boolean; lead_id?: string; reason?: string }> {
  return fetchApi(`/pg/listings/${id}/interest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });
}
