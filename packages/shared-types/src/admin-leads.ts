import type { LeadStatus, LeadAccessState, LeadCalledBy } from "./types";

/** Preset filters for the admin live-lead board. */
export type AdminLeadBoardFilter =
  | "needs_call"
  | "expiring_6h"
  | "called"
  | "expired_today"
  | "refunded_today"
  | "all";

/** Where the refund promise stands for a lead's linked callback. */
export type AdminLeadRefundState = "pending" | "responded" | "refunded";

export interface AdminLeadBoardOwner {
  user_id: string;
  name: string;
  phone_masked: string;
  role: "owner" | "pg_operator";
  health_score: number | null;
  health_grade: "A" | "B" | "C" | "D" | "F" | null;
}

export interface AdminLeadBoardSeeker {
  user_id: string;
  name: string;
  phone_e164: string; // admin sees the full seeker number
}

export interface AdminLeadBoardRow {
  lead_id: string;
  listing_id: string;
  listing_title: string;
  city: string | null;
  owner: AdminLeadBoardOwner;
  seeker: AdminLeadBoardSeeker;
  access_state: LeadAccessState;
  status: LeadStatus;
  called_at: string | null;
  called_by: LeadCalledBy | null;
  response_deadline_at: string | null; // the refund timer
  seconds_remaining: number | null; // server-computed; client ticks down
  refund_state: AdminLeadRefundState;
  source: string | null;
  created_at: string;
}

export interface AdminLeadCounters {
  in_flight: number;
  uncalled: number;
  expiring_6h: number;
  expired_today: number;
  refunded_today: number;
}

export interface AdminLeadBoardResponse {
  rows: AdminLeadBoardRow[];
  total: number;
  generated_at: string;
  counters: AdminLeadCounters;
}

export interface AdminLeadTimelineEvent {
  at: string;
  source: "lead" | "contact" | "admin";
  kind: string;
  actor: string | null;
  detail: string | null;
}

export interface AdminLeadTimelineResponse {
  lead_id: string;
  events: AdminLeadTimelineEvent[];
}

export interface AdminLeadFunnel {
  callbacks_requested: number;
  leads_created: number;
  leads_unlocked: number;
  leads_called: number;
  deals_done: number;
  leads_refunded: number;
  leads_disputed: number;
}

export interface AdminLeadEngagementFunnel {
  searches: number;
  listing_views: number;
  signups: number;
  callbacks_requested: number;
  calls_made: number;
}

export interface AdminLeadRates {
  median_response_minutes: number | null;
  called_within_24h_rate: number;
  team_rescue_rate: number;
  refund_rate: number;
  dispute_rate: number;
}

export interface AdminLeadTrendPoint {
  day: string;
  callbacks: number;
  unlocked: number;
  called: number;
  refunded: number;
}

export interface AdminLeadOwnerRollupRow {
  owner_user_id: string;
  name: string;
  role: "owner" | "pg_operator";
  leads: number;
  called: number;
  called_rate: number;
  median_response_minutes: number | null;
  refund_rate: number;
  health_score: number | null;
  health_grade: "A" | "B" | "C" | "D" | "F" | null;
}

export interface AdminLeadAnalytics {
  range: string;
  generated_at: string;
  funnel: AdminLeadFunnel;
  engagement: AdminLeadEngagementFunnel;
  rates: AdminLeadRates;
  trend: AdminLeadTrendPoint[];
  by_owner: AdminLeadOwnerRollupRow[];
}

export interface AdminLeadOwnerFunnel {
  new: number;
  contacted: number;
  visit_scheduled: number;
  deal_done: number;
  lost: number;
  total: number;
}

export interface AdminLeadOwnerDetail {
  owner_user_id: string;
  name: string;
  role: "owner" | "pg_operator";
  phone_masked: string;
  health_score: number | null;
  health_grade: "A" | "B" | "C" | "D" | "F" | null;
  funnel: AdminLeadOwnerFunnel;
  rates: AdminLeadRates;
  in_flight: AdminLeadBoardRow[];
}
