// packages/shared-types/src/pg-operator.ts
// Shared types for the PG Operator module (V1). Re-exported by index.
// Spec: vault Features/PG Operator Role/03-V1-Data-Model.md

export type PgPropertyStatus = "active" | "paused" | "archived";

// Storage shape: integer FKs to cities/localities (matches existing listing_locations).
// DTOs at controller layer accept slug + resolve; payloads from voice agent carry slug.
export interface PgProperty {
  id: string;
  operator_id: string;
  display_name: string;
  internal_code: string | null;
  city_id: number;
  locality_id: number | null;
  /** Precise geocode (0032). Null until geocoded → projection uses locality centroid. */
  lat: number | null;
  lng: number | null;
  status: PgPropertyStatus;
  is_primary: boolean;
  total_floors: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type PgGenderPolicy = "boys" | "girls" | "coed";
export type PgTenantType = "students" | "working" | "any";
export type PgElectricityMode = "flat" | "submetered" | "split_equally";
export type PgSharingKind = "single" | "double" | "triple" | "quad" | "dorm";
export type PgBathroomKind =
  | "attached_western"
  | "attached_indian"
  | "shared_western"
  | "shared_indian";
export type PgFurnishing = "unfurnished" | "semi_furnished" | "fully_furnished";

export interface PgRoomType {
  id: string;
  listing_id: string;
  sharing: PgSharingKind;
  ac: boolean;
  bathroom_kind: PgBathroomKind;
  furnishing: PgFurnishing;
  room_size_sqft: number | null;
  monthly_rent_paise: number;
  vacancy_count: number;
  available_from: string | null;
}

export interface PgMeals {
  provided: boolean;
  breakfast?: boolean;
  lunch?: boolean;
  snack?: boolean;
  dinner?: boolean;
  veg_only?: boolean;
}

// gender_policy + tenant_type are FIRST-CLASS columns on pg_details (filter-critical for
// tenant search). House rules covers free-form/jsonb-stored policy only.
export interface PgHouseRules {
  curfew_time?: string | null;
  guests_policy?: string | null;
  smoking: boolean;
  alcohol: boolean;
  non_veg: boolean;
  pets: boolean;
  cooking_in_room: boolean;
  quiet_hours?: { from: string; to: string } | null;
}

export interface PgAmenities {
  core?: string[]; // wifi, hot_water, power_backup, cctv, security_guard
  room?: string[]; // ac, tv, study_table, wardrobe, safety_locker, mattress
  services?: string[]; // housekeeping, laundry, biometric_access
  extras?: string[]; // parking_2w, parking_4w, fridge, microwave, gym, indoor_games
}

export interface PgNearby {
  metro?: string[];
  college?: string[];
  office?: string[];
}

export interface PgPaymentTerms {
  notice_period_days?: number | null;
  lock_in_months?: number | null;
  electricity_mode?: PgElectricityMode | null;
  maintenance_paise?: number | null;
  rent_due_day?: number | null;
  payment_modes?: Array<"upi" | "bank_transfer" | "cash">;
}

export interface PgListingPayload {
  property: {
    display_name: string;
    internal_code?: string | null;
    // Slug-based public API — pg-properties.service resolves to city_id/locality_id on write.
    city_slug: string;
    locality_slug?: string | null;
    total_floors?: number | null;
    lat?: number | null;
    lng?: number | null;
    formatted_address?: string | null;
  };
  pg_details: {
    total_beds: number;
    // First-class filter fields (column-stored on pg_details for indexed search)
    gender_policy?: PgGenderPolicy | null;
    tenant_type?: PgTenantType | null;
    security_deposit_paise?: number | null;
    deposit_refundable_pct?: number | null;
    price_negotiable?: boolean;
    meals?: PgMeals;
    meal_charges_paise?: number | null;
    amenities?: PgAmenities;
    house_rules?: PgHouseRules;
    nearby?: PgNearby;
    late_fee_policy?: Record<string, unknown> | null;
  } & PgPaymentTerms;
  room_types: Array<{
    sharing: PgSharingKind;
    ac: boolean;
    bathroom_kind?: PgBathroomKind;
    furnishing?: PgFurnishing;
    monthly_rent_paise: number;
    vacancy_count: number;
    security_deposit_paise?: number;
    deposit_refundable_pct?: number;
    available_from?: string | null;
  }>;
}

export type PgSegmentationPath = "self_serve" | "sales_assist";

export interface PgSegmentationResult {
  path: PgSegmentationPath;
  reason: string;
  next_step: string;
}

export interface TrendPoint {
  day: string; // ISO date (YYYY-MM-DD)
  appearances: number;
  clicks: number;
  views: number;
  leads: number;
}

export interface PgDashboardListingHealth {
  listing_id: string;
  status: string;
  views_7d: number;
  contact_unlocks_7d: number;
  search_appearances_7d: number; // true per-listing impressions
  ctr_7d: number; // clicks / appearances, 0–1
  interest_rate_7d: number; // contact_unlocks_7d / views_7d, 0–1
  trend_7d: TrendPoint[]; // 7 points, oldest→newest
  last_updated: string;
  composite_score?: number; // 0–100 listing quality score from listing_scores
  // Identity + headline data for the dashboard card (optional — older payloads omit).
  title?: string | null;
  cover_photo?: string | null; // absolute URL
  city_slug?: string | null;
  locality_slug?: string | null;
  gender_policy?: string | null;
  total_beds?: number | null;
  starting_rent_paise?: number | null;
  total_vacancy?: number;
}

export interface PgDashboardLead {
  lead_id: string;
  source: string;
  status: string;
  created_at: string;
  contact: { phone_masked: string };
}

export interface PgPortfolioSummary {
  appearances: number;
  clicks: number;
  views: number;
  leads: number;
  ctr: number; // clicks / appearances, 0–1
  interest_rate: number; // leads / views, 0–1
  conversion: number; // leads / appearances, 0–1 (full funnel)
  deltas: {
    // % change vs the prior 7d; null when the prior period was 0 (no baseline)
    appearances: number | null;
    views: number | null;
    leads: number | null;
  };
}

export interface PgSearchInsights {
  top_queries: Array<{ query: string; count: number }>;
  top_filters: Array<{ key: string; value: string; count: number }>;
  zero_result_queries: Array<{ query: string; count: number }>;
}

export interface PgDashboardData {
  listing_health: PgDashboardListingHealth[];
  leads_inbox: PgDashboardLead[];
  portfolio: PgPortfolioSummary;
  trend_30d: TrendPoint[]; // aggregated across listings, 30 points oldest→newest
  search_insights: PgSearchInsights;
}
