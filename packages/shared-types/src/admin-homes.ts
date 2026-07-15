import type {
  LeadAccessState,
  LeadStatus,
  ListingStatus,
  VerificationResult,
  VerificationType
} from "./types";

export type AdminHomeStatusFilter = "active" | "paused" | "archived" | "all";
export type AdminHomeSort = "leads" | "views" | "conversion" | "updated" | "rent_desc" | "rent_asc";
export type AdminHomeActivityKind = "listing" | "admin" | "verification" | "lead";

export interface AdminHomesListParams {
  status: AdminHomeStatusFilter;
  city?: string;
  q?: string;
  sort: AdminHomeSort;
  page: number;
  page_size: 25 | 50 | 100;
}

export interface AdminHomeListItem {
  id: string;
  title: string;
  city_slug: string | null;
  city_name: string | null;
  locality_name: string | null;
  monthly_rent: number;
  owner_id: string;
  owner_name: string | null;
  owner_phone_masked: string | null;
  status: Extract<ListingStatus, "active" | "paused" | "archived">;
  cover_photo_url: string | null;
  views_30d: number;
  leads_30d: number;
  open_leads: number;
  conversion_rate: number;
  updated_at: string;
  public_path: string;
}

export interface AdminHomesListResponse {
  items: AdminHomeListItem[];
  total: number;
  page: number;
  page_size: 25 | 50 | 100;
  filters: {
    status: AdminHomeStatusFilter;
    city: string | null;
    q: string | null;
    sort: AdminHomeSort;
  };
  available_cities: Array<{ slug: string; name: string; count: number }>;
  summary: {
    active_homes: number;
    views_30d: number;
    leads_30d: number;
    needs_attention: number;
  };
}

export interface AdminHomePhoto {
  id: string | null;
  url: string | null;
  is_cover: boolean;
  sort_order: number;
  moderation_status: string;
}

export interface AdminHomeVerificationAttempt {
  attempt_id: string;
  kind: VerificationType;
  result: VerificationResult;
  liveness_score: number | null;
  address_match_score: number | null;
  threshold: number;
  provider: string | null;
  provider_result_code: string | null;
  review_reason: string | null;
  artifact_available: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AdminHomeRecentLead {
  lead_id: string;
  seeker_name: string;
  access_state: LeadAccessState;
  status: LeadStatus;
  called_at: string | null;
  called_by: "owner" | "team" | null;
  response_deadline_at: string | null;
  refund_state: "pending" | "responded" | "refunded";
  created_at: string;
}

export interface AdminHomeActivityItem {
  id: string;
  at: string;
  kind: AdminHomeActivityKind;
  label: string;
  detail: string | null;
  actor_id: string | null;
}

export interface AdminHomeDetail {
  listing: {
    id: string;
    title_en: string | null;
    title_hi: string | null;
    description_en: string | null;
    description_hi: string | null;
    status: Extract<ListingStatus, "active" | "paused" | "archived">;
    verification_status: "verified";
    monthly_rent: number;
    security_deposit: number | null;
    available_from: string | null;
    furnishing: string | null;
    bhk: number | null;
    bathrooms: number | null;
    area_sqft: number | null;
    preferred_tenant: string | null;
    whatsapp_available: boolean;
    amenities: string[];
    rules: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    last_owner_activity_at: string | null;
  };
  location: {
    address_line1: string | null;
    landmark: string | null;
    pincode: string | null;
    lat: number | null;
    lng: number | null;
    masked_address: string | null;
    locality_name: string | null;
    city_slug: string | null;
    city_name: string | null;
  } | null;
  photos: AdminHomePhoto[];
  owner: {
    id: string;
    name: string | null;
    phone: string | null;
    whatsapp_opt_in: boolean;
    preferred_language: string | null;
    role: string;
    is_blocked: boolean;
    member_since: string | null;
    last_login_at: string | null;
    active_homes: number;
    paused_homes: number;
    archived_homes: number;
    report_count: number;
    lead_health: {
      health_score: number | null;
      health_grade: "A" | "B" | "C" | "D" | "F" | null;
      leads_30d: number;
      called_rate_30d: number;
      refund_rate_30d: number;
      median_response_minutes_30d: number | null;
    };
  };
  metrics_30d: {
    views: number;
    leads: number;
    open_leads: number;
    conversion_rate: number;
  };
  lead_summary: {
    by_status: Record<LeadStatus, number>;
    by_access_state: Record<LeadAccessState, number>;
    called: number;
    uncalled: number;
    refunded: number;
    open: number;
    median_response_minutes: number | null;
  };
  recent_leads: AdminHomeRecentLead[];
  verification_status: "verified";
  verified_at: string | null;
  verification_attempts: AdminHomeVerificationAttempt[];
  activity: AdminHomeActivityItem[];
  public_path: string;
}
