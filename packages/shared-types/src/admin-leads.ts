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
