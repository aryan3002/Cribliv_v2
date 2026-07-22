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

// Canonical PG amenity taxonomy — single source of truth for BOTH the backend
// Zod enum (pg-extraction-schema.ts) and the wizard UI (PgAmenitiesFoodStep).
// Superset of the original tokens: expanding is additive, so existing stored
// amenities remain valid. Keep tokens snake_case and stable (they are persisted).
export const PG_AMENITY_CORE = [
  "wifi",
  "hot_water",
  "power_backup",
  "cctv",
  "security_guard",
  "lift",
  "fire_safety",
  "ro_water",
  "drinking_water",
  "inverter_backup"
] as const;
export const PG_AMENITY_ROOM = [
  "ac",
  "tv",
  "study_table",
  "wardrobe",
  "safety_locker",
  "mattress",
  "attached_bathroom",
  "geyser",
  "fan",
  "curtains",
  "chair",
  "room_cleaning"
] as const;
export const PG_AMENITY_SERVICES = [
  "housekeeping",
  "laundry",
  "biometric_access",
  "mess_food",
  "cook",
  "warden",
  "maintenance_staff",
  "doctor_on_call",
  "deep_cleaning",
  "water_supply_247"
] as const;
export const PG_AMENITY_EXTRAS = [
  "parking_2w",
  "parking_4w",
  "fridge",
  "microwave",
  "gym",
  "indoor_games",
  "common_lounge",
  "rooftop_terrace",
  "washing_machine",
  "water_cooler",
  "dining_area",
  "study_room",
  "library",
  "swimming_pool",
  "recreation_room",
  "vending_machine"
] as const;

export const PG_AMENITY_LABELS: Record<string, string> = {
  wifi: "High-Speed WiFi",
  hot_water: "Hot Water",
  power_backup: "Power Backup",
  cctv: "CCTV",
  security_guard: "Security Guard",
  lift: "Lift / Elevator",
  fire_safety: "Fire Safety",
  ro_water: "RO Water",
  drinking_water: "Drinking Water",
  inverter_backup: "Inverter Backup",
  ac: "Air Conditioning",
  tv: "TV",
  study_table: "Study Table",
  wardrobe: "Wardrobe",
  safety_locker: "Safety Locker",
  mattress: "Mattress",
  attached_bathroom: "Attached Bathroom",
  geyser: "Geyser",
  fan: "Fan",
  curtains: "Curtains",
  chair: "Chair",
  room_cleaning: "Room Cleaning",
  housekeeping: "Daily Cleaning",
  laundry: "Laundry",
  biometric_access: "Biometric Access",
  mess_food: "Mess / Food",
  cook: "Cook",
  warden: "Warden",
  maintenance_staff: "Maintenance Staff",
  doctor_on_call: "Doctor on Call",
  deep_cleaning: "Deep Cleaning",
  water_supply_247: "24×7 Water Supply",
  parking_2w: "2-Wheeler Parking",
  parking_4w: "4-Wheeler Parking",
  fridge: "Fridge",
  microwave: "Microwave",
  gym: "Gym",
  indoor_games: "Indoor Games",
  common_lounge: "Common Lounge",
  rooftop_terrace: "Rooftop Terrace",
  washing_machine: "Washing Machine",
  water_cooler: "Water Cooler",
  dining_area: "Dining Area",
  study_room: "Study Room",
  library: "Library",
  swimming_pool: "Swimming Pool",
  recreation_room: "Recreation Room",
  vending_machine: "Vending Machine"
};

// One-tap "Typical PG defaults" preset for the wizard.
export const PG_AMENITY_DEFAULTS = {
  core: ["wifi", "hot_water", "power_backup", "cctv", "drinking_water"],
  room: ["mattress", "wardrobe", "study_table", "fan"],
  services: ["housekeeping", "laundry"],
  extras: ["parking_2w"]
};

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
  /**
   * Per-listing public title (what tenants see). Distinct from the shared
   * building/property name (`property.display_name`): one operator's property
   * can carry several listings, each with its own title. Optional for back-compat
   * (voice drafts / older clients) — backend falls back to property.display_name.
   */
  title?: string | null;
  /** AI-generated, SEO-optimized, operator-editable body copy. Persisted to listings.description_en. */
  description?: string | null;
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
    has_balcony?: boolean;
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
  // Lead monetization (Slice 3) — mirrors the owner-side LeadVm access
  // lifecycle so PgLeadsBoard can reuse the shared owner unlock/call-click
  // controls instead of the legacy dev-reveal seam. Populated from the SAME
  // getOwnerLeads row LeadsSliceAdapter already fetches — no new query.
  access_state: "free" | "locked" | "unlocked" | "expired";
  call_deadline_at: string | null;
  called_at: string | null;
  called_by: string | null;
  tenant_name: string;
  tenant_phone?: string | null;
  /** Sharing type the tenant asked about when expressing interest (null = "Any"). */
  preferred_sharing?: string | null;
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
  /** 'restricted' when an admin override is masking this operator's analytics. */
  analytics_status: PgAnalyticsStatus;
  listing_health: PgDashboardListingHealth[];
  leads_inbox: PgDashboardLead[];
  portfolio: PgPortfolioSummary;
  trend_30d: TrendPoint[]; // aggregated across listings, 30 points oldest→newest
  search_insights: PgSearchInsights;
}

// ── Admin analytics masking (non-destructive, operator-facing only) ──────────
// Granularity (V1): per-LISTING or operator-GLOBAL. An operator owns one
// pg_property containing many pg_listings, so masking targets individual
// listings; a global cut hides every listing for the operator.
export type PgAnalyticsStatus = "live" | "restricted";

export type PgOverrideScope = "global" | "listing";

export interface PgAnalyticsOverride {
  id: string;
  operator_id: string;
  listing_id: string | null; // null = operator-global kill
  active: boolean;
  reason: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// Resolved override state used by the operator dashboard read-path.
export interface PgActiveOverrides {
  global: boolean;
  listing_ids: string[]; // active per-listing cuts
}

// ── Admin PG listing management view models ──────────────────────────────────
export interface PgAdminListingListItem {
  listing_id: string;
  title: string | null;
  status: string; // pg_listings.status: draft | pending_review | active | rejected | paused | archived
  pg_property_id: string | null;
  property_name: string | null;
  city_slug: string | null;
  locality_slug: string | null;
  owner_id: string;
  owner_name: string | null;
  owner_phone_masked: string | null;
  leads_7d: number;
  analytics_cut: boolean; // global OR this-listing override active
  // --- Verified-PGs additions ---
  /**
   * Public verification truth, read from `listings.verification_status` (the
   * column search/map/homes all read), falling back to the pg_listings head
   * when the projection row is missing. See Decision D1.
   * One of: unverified | pending | verified | failed.
   */
  verification_status: string;
  cover_photo_url: string | null;
  starting_rent_paise: number | null; // cheapest room rent; NOT NULL in schema, nullable here for in-memory mode
  gender_policy: string | null; // boys | girls | coed
  /** Postgres timestamptz rendered via ::text (e.g. "2026-07-10 00:00:00+00") — NOT strict ISO-8601. `formatDate` parses it. */
  updated_at: string;
  /** `/en/pg/{city}/{id}`; null when not shareable (status !== 'active' or no city). */
  public_path: string | null;
}

export type PgAdminVerificationFilter = "verified" | "all";
/** Mirrors listing_status, minus 'rejected' (not surfaced in this tab). See Decision D2. */
export type PgAdminListingStatusFilter =
  | "active"
  | "paused"
  | "pending_review"
  | "draft"
  | "archived"
  | "all";
export type PgAdminListingSort = "leads" | "updated" | "rent_desc" | "rent_asc";

export interface PgAdminListingsParams {
  verification: PgAdminVerificationFilter;
  status: PgAdminListingStatusFilter;
  city?: string;
  q?: string;
  sort: PgAdminListingSort;
  page: number;
  page_size: 25 | 50 | 100;
}

export interface PgAdminListingsResponse {
  items: PgAdminListingListItem[];
  total: number;
  page: number;
  page_size: 25 | 50 | 100;
  filters: {
    verification: PgAdminVerificationFilter;
    status: PgAdminListingStatusFilter;
    city: string | null;
    q: string | null;
    sort: PgAdminListingSort;
  };
  /** Facet counts. Honors verification + status + q; deliberately ignores `city` so the dropdown can switch cities. */
  available_cities: Array<{ slug: string; name: string; count: number }>;
  /** Inventory scope tiles. Honors q + city; deliberately ignores `status` and the `verification` toggle — always reports verified counts within the searched scope. */
  summary: { verified: number; active: number; cities: number };
}

export interface PgAdminPropertyOwner {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  property_count: number;
  verification_status: string | null;
}

export interface PgAdminListingDetail {
  listing: { id: string; title: string | null; status: string };
  property: PgProperty | null; // container; geo/locality edits target this
  city_slug: string | null;
  locality_slug: string | null;
  owner: PgAdminPropertyOwner;
  overrides: { global: boolean; listing: boolean };
}

export interface PgAdminListingAnalytics {
  listing_id: string;
  range_days: number;
  appearances: number;
  clicks: number;
  views: number;
  leads: number;
  ctr: number;
  interest_rate: number;
  conversion: number;
  composite_score: number | null;
  trend: TrendPoint[];
}

export interface PgAdminPropertyPatch {
  display_name?: string;
  status?: PgPropertyStatus;
  internal_code?: string | null;
  city_slug?: string;
  locality_slug?: string | null;
  lat?: number | null;
  lng?: number | null;
  total_floors?: number | null;
}

// ── Admin full listing detail (review & edit console) ────────────────────────
// Rich read model backing the Details/Rooms/Photos/Location tabs. One fetch,
// shared across tabs. Source: pg_listings + pg_properties + pg_details +
// pg_room_types + listing_photos.
export interface PgAdminListingPgDetails {
  total_beds: number | null;
  gender_policy: "boys" | "girls" | "coed" | null;
  tenant_type: "students" | "working" | "any" | null;
  security_deposit_paise: number | null;
  deposit_refundable_pct: number | null;
  notice_period_days: number | null;
  lock_in_months: number | null;
  electricity_mode: "flat" | "submetered" | "split_equally" | null;
  maintenance_paise: number | null;
  rent_due_day: number | null;
  price_negotiable: boolean;
  payment_modes: Array<"upi" | "bank_transfer" | "cash">;
  meals: Record<string, unknown> | null;
  meal_charges_paise: number | null;
  amenities: Record<string, unknown>;
  house_rules: Record<string, unknown>;
  nearby: Record<string, unknown> | null;
}

export interface PgAdminListingRoom {
  sharing: string;
  ac: boolean;
  bathroom_kind: string | null;
  furnishing: string | null;
  monthly_rent_paise: number;
  vacancy_count: number;
  available_from: string | null;
}

export interface PgAdminListingPhoto {
  id: string;
  blob_path: string;
  is_cover: boolean;
  sort_order: number;
  moderation_status: string;
}

export interface PgAdminListingFull {
  listing: { id: string; title: string | null; status: string; created_at: string | null };
  property: {
    id: string;
    display_name: string | null;
    status: string;
    city_slug: string | null;
    locality_slug: string | null;
    lat: number | null;
    lng: number | null;
    total_floors: number | null;
    internal_code: string | null;
  } | null;
  pg_details: PgAdminListingPgDetails;
  room_types: PgAdminListingRoom[];
  photos: PgAdminListingPhoto[];
}

// Partial patch for the Details tab — only provided keys change.
export interface PgAdminDetailsPatch {
  /** Per-listing public title (distinct from the building/property name). */
  title?: string;
  total_beds?: number;
  gender_policy?: "boys" | "girls" | "coed" | null;
  tenant_type?: "students" | "working" | "any" | null;
  security_deposit_paise?: number;
  deposit_refundable_pct?: number;
  notice_period_days?: number | null;
  lock_in_months?: number | null;
  electricity_mode?: "flat" | "submetered" | "split_equally" | null;
  maintenance_paise?: number | null;
  rent_due_day?: number | null;
  price_negotiable?: boolean;
  payment_modes?: Array<"upi" | "bank_transfer" | "cash">;
  meals?: Record<string, unknown> | null;
  meal_charges_paise?: number | null;
  amenities?: Record<string, unknown>;
  house_rules?: Record<string, unknown>;
  nearby?: Record<string, unknown> | null;
}

// Full room-set replacement for the Rooms tab.
export interface PgAdminRoomInput {
  sharing: string;
  ac: boolean;
  bathroom_kind?: string;
  furnishing?: string;
  monthly_rent_paise: number;
  vacancy_count: number;
  available_from?: string | null;
}

// ── Expanded admin PG overview ───────────────────────────────────────────────
export interface PgAdminOverview {
  range_days: number;
  supply: {
    properties_by_status: { active: number; paused: number; archived: number };
    total_beds: number;
    vacant_beds: number;
    vacancy_rate: number;
    avg_starting_rent_paise: number | null;
    gender_mix: { boys: number; girls: number; coed: number };
  };
  distribution: Array<{ city: string; locality: string | null; count: number }>;
  operators: { total: number; without_live_listing: number };
  demand: {
    top_queries: Array<{ query: string; count: number }>;
    zero_result_queries: Array<{ query: string; count: number }>;
  };
}
