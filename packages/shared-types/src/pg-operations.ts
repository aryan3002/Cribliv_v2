import type {
  PgBathroomKind,
  PgFurnishing,
  PgHouseRules,
  PgMeals,
  PgPropertyStatus,
  PgSharingKind
} from "./pg-operator";

export type PgManageRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type PgBedStatus = "vacant" | "reserved" | "occupied" | "blocked" | "inactive";
export type PgRoomStatus = "active" | "inactive";
export type PgLayoutStatus = "needs_setup" | "ready";

export interface PgManageRequest {
  id: string;
  listing_id: string;
  pg_property_id: string | null;
  operator_user_id: string;
  status: PgManageRequestStatus;
  requested_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_notes: string | null;
  payment_order_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PgManageRequestState {
  status: "none" | PgManageRequestStatus;
  request?: PgManageRequest;
  managed_property_id?: string;
  layout_status?: string;
}

export interface PgManagedPropertySummary {
  id: string;
  operator_id: string;
  display_name: string;
  internal_code: string | null;
  city_id: number;
  locality_id: number | null;
  total_floors: number | null;
  status: PgPropertyStatus;
  manage_enabled: boolean;
  layout_status: PgLayoutStatus;
  room_count: number;
  bed_count: number;
  available_bed_count: number;
}

export interface PgManagedRoomType {
  id: string;
  sharing: PgSharingKind;
  ac: boolean;
  bathroom_kind: PgBathroomKind;
  furnishing: PgFurnishing;
  monthly_rent_paise: number;
}

export interface PgManagedPropertyDetail extends PgManagedPropertySummary {
  room_types: PgManagedRoomType[];
}

export interface PgBed {
  id: string;
  room_id: string;
  bed_label: string;
  status: PgBedStatus;
  available_from: string | null;
  sort_order: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PgRoom {
  id: string;
  pg_property_id: string;
  room_type_id: string | null;
  floor: number | null;
  room_number: string;
  display_label: string | null;
  bed_count: number;
  status: PgRoomStatus;
  beds: PgBed[];
  created_at: string;
  updated_at: string;
}

export interface PgLayoutRoomInput {
  id?: string;
  room_type_id?: string | null;
  floor?: number | null;
  room_number: string;
  display_label?: string | null;
  bed_count: number;
  beds: PgLayoutBedInput[];
}

export interface PgLayoutBedInput {
  id?: string;
  bed_label: string;
  status?: PgBedStatus;
  available_from?: string | null;
  sort_order?: number | null;
  metadata?: Record<string, unknown>;
}

export interface PgLayoutRoomCountInput {
  room_type_id: string;
  count: number;
  floor?: number | null;
  /** Required for dorm room types when the type does not carry a bed count. */
  bed_count?: number;
}

export interface PgLayoutDraft {
  property_id: string;
  room_counts: PgLayoutRoomCountInput[];
  rooms: PgLayoutRoomInput[];
}

export interface PgLayoutPutInput {
  rooms: PgLayoutRoomInput[];
}

export type PgBedAssignmentStatus =
  | "reserved"
  | "active"
  | "notice_served"
  | "move_out_requested"
  | "move_out_pending_confirmation"
  | "moved_out"
  | "cancelled";

export type PgAssignmentInitiator = "operator" | "tenant" | "system";

export interface PgBedAssignmentOccupantInput {
  occupant_name: string;
  occupant_phone_e164: string;
  occupant_gender?: string | null;
  emergency_contact?: Record<string, unknown> | null;
  expected_move_in_date?: string | null;
  move_in_date?: string | null;
  monthly_rent_paise?: number | null;
  security_deposit_paise?: number | null;
  operator_notes?: string | null;
}

export interface PgBedAssignmentListFilters {
  status?: PgBedAssignmentStatus;
  bed_id?: string;
  tenant_user_id?: string;
}

export interface PgServeNoticeInput {
  notice_end_date: string;
}

export interface PgBedAssignment {
  id: string;
  pg_property_id: string;
  bed_id: string;
  tenant_user_id: string | null;
  occupant_name: string;
  occupant_phone_e164: string;
  occupant_gender: string | null;
  emergency_contact: Record<string, unknown> | null;
  status: PgBedAssignmentStatus;
  expected_move_in_date: string | null;
  move_in_date: string | null;
  notice_served_date: string | null;
  notice_end_date: string | null;
  move_out_date: string | null;
  monthly_rent_paise: number | null;
  security_deposit_paise: number | null;
  operator_notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PgAssignmentEvent {
  id: string;
  assignment_id: string;
  event_type: string;
  initiator: PgAssignmentInitiator;
  actor_user_id: string | null;
  from_status: PgBedAssignmentStatus | null;
  to_status: PgBedAssignmentStatus;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PgOperatorBedDetailRoom {
  id: string;
  pg_property_id: string;
  room_type_id: string | null;
  floor: number | null;
  room_number: string;
  display_label: string | null;
  bed_count: number;
  status: PgRoomStatus;
  created_at: string;
  updated_at: string;
}

export interface PgOperatorBedDetail {
  property_id: string;
  property_name: string;
  room: PgOperatorBedDetailRoom;
  bed: PgBed;
  assignment: PgBedAssignment | null;
  events: PgAssignmentEvent[];
  maintenance_summary: {
    open_items: number;
    overdue_items: number;
  };
}

export type PgMaintenanceStatus =
  | "open"
  | "in_progress"
  | "waiting_on_tenant"
  | "resolved"
  | "closed"
  | "cancelled";

export type PgMaintenancePriority = "emergency" | "high" | "normal" | "low";

export type PgMaintenanceSlaHours = 4 | 24 | 72 | 168;

export type PgMaintenancePrioritySlaHours = {
  emergency: 4;
  high: 24;
  normal: 72;
  low: 168;
};

export type PgMaintenancePrioritySource = "category_default" | "operator_override" | "backfill";

export type PgMaintenanceLocationKind =
  | "bed"
  | "room"
  | "floor"
  | "common_area"
  | "property_wide"
  | "other";

export type PgMaintenanceCommonArea =
  | "kitchen"
  | "common_bathroom"
  | "lift"
  | "stairs"
  | "corridor"
  | "terrace"
  | "laundry"
  | "parking"
  | "reception"
  | "mess_food_area"
  | "water_tank_motor"
  | "wifi_router"
  | "security_cctv"
  | "other";

export type PgMaintenanceEventType =
  | "created"
  | "status_changed"
  | "priority_set"
  | "priority_overridden"
  | "comment_added"
  | "internal_note_added"
  | "photo_added"
  | "resolution_recorded"
  | "reopened"
  | "auto_closed"
  | "cancelled";

export type PgMaintenanceEventVisibility = "public" | "operator_internal";

export interface PgMaintenanceCategory {
  slug: string;
  display_name: string;
  default_priority: PgMaintenancePriority;
  active: boolean;
  sort_order: number;
}

export interface PgMaintenanceLocationInput {
  kind: PgMaintenanceLocationKind;
  room_id?: string;
  bed_id?: string;
  floor?: number;
  common_area?: PgMaintenanceCommonArea;
  detail?: string;
}

export interface PgMaintenanceLocationSnapshot {
  kind: PgMaintenanceLocationKind;
  property_name: string | null;
  room_number: string | null;
  room_label: string | null;
  floor: number | null;
  bed_label: string | null;
  common_area: PgMaintenanceCommonArea | null;
  detail: string | null;
}

export interface PgMaintenanceTimelineEvent {
  id: string;
  request_id: string;
  event_type: PgMaintenanceEventType;
  visibility: PgMaintenanceEventVisibility;
  actor_user_id: string | null;
  actor_role: "tenant" | "pg_operator" | "admin" | "system";
  from_status: PgMaintenanceStatus | null;
  to_status: PgMaintenanceStatus | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface PgMaintenanceResolutionInput {
  note: string;
  fix_photo_paths?: string[];
  cost_paise?: number | null;
  chargeable_damage: boolean;
}

export interface PgMaintenanceInternalNoteInput {
  body: string;
  attachments?: string[];
}

export interface PgMaintenanceInternalNoteResponse {
  id: string;
  request_id: string;
  author_user_id: string | null;
  author_role: "pg_operator" | "admin";
  visibility: "operator_internal";
  body: string;
  attachments: string[];
  attachment_urls: string[];
  created_at: string;
}

export interface PgMaintenancePriorityOverrideInput {
  priority: PgMaintenancePriority;
  reason: string;
}

export interface PgMaintenanceQueueFilters {
  status?: PgMaintenanceStatus | "all";
  priority?: PgMaintenancePriority;
  sla_state?: "overdue" | "due_today" | "on_track";
  category_slug?: string;
  location_kind?: PgMaintenanceLocationKind;
  common_area?: PgMaintenanceCommonArea;
  floor?: number;
  room_id?: string;
  bed_id?: string;
  tenant_query?: string;
  chargeable_damage?: boolean;
  include_closed?: boolean;
  date_from?: string;
  date_to?: string;
  view?: "list" | "kanban";
  sort?: "sla_due" | "newest";
  limit?: number;
  cursor?: string;
}

export interface PgMaintenanceComment {
  id: string;
  request_id: string;
  author_user_id: string | null;
  author_role: "tenant" | "pg_operator" | "admin";
  body: string;
  attachments: string[];
  attachment_urls: string[];
  created_at: string;
}

export interface PgMaintenanceLocation {
  property_id: string;
  property_name: string | null;
  room_id: string | null;
  room_number: string | null;
  room_label: string | null;
  floor: number | null;
  bed_id: string | null;
  bed_label: string | null;
  tenant_name: string | null;
  tenant_phone_e164: string | null;
}

export interface PgMaintenanceRequest {
  id: string;
  pg_property_id: string;
  assignment_id: string | null;
  created_by_user_id: string | null;
  category: string;
  category_slug: string;
  category_label_snapshot: string;
  description: string;
  photo_paths: string[];
  photo_urls: string[];
  status: PgMaintenanceStatus;
  priority: PgMaintenancePriority;
  priority_source: PgMaintenancePrioritySource;
  priority_overridden_by: string | null;
  priority_overridden_at: string | null;
  priority_override_reason: string | null;
  sla_hours: PgMaintenanceSlaHours;
  sla_due_at: string;
  is_overdue: boolean;
  closed_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  resolution_source: string | null;
  fix_photo_paths: string[];
  fix_photo_urls: string[];
  resolution_cost_paise: number | null;
  chargeable_damage: boolean;
  auto_close_after: string | null;
  created_at: string;
  updated_at: string;
  comments: PgMaintenanceComment[];
  location: PgMaintenanceLocation | null;
  location_snapshot: PgMaintenanceLocationSnapshot;
  timeline?: PgMaintenanceTimelineEvent[];
}

export interface PgMaintenanceQueuePage {
  rows: PgMaintenanceRequest[];
  next_cursor: string | null;
}

export interface PgMaintenanceAnalytics {
  open: number;
  overdue: number;
  due_today: number;
  waiting_on_tenant: number;
  resolved_pending_close: number;
  closed_this_month: number;
  by_category: Array<{ category_slug: string; display_name: string; count: number }>;
}

export interface PgMaintenanceSummary {
  open_items: number;
  overdue_items: number;
}

export interface PgMaintenanceCreateInput {
  category: string;
  description: string;
  photo_paths?: string[];
  priority?: PgMaintenancePriority | null;
}

export interface PgMaintenanceCommentInput {
  body: string;
  attachments?: string[];
}

export interface PgMaintenanceListFilters {
  status?: PgMaintenanceStatus;
}

export interface PgMaintenancePresignFileInput {
  client_upload_id: string;
  content_type: string;
  size_bytes: number;
}

export interface PgMaintenancePresignUpload {
  client_upload_id: string;
  upload_url: string;
  blob_path: string;
  expires_at: string;
}

export interface PgMaintenancePresignResponse {
  uploads: PgMaintenancePresignUpload[];
}

export interface PgMaintenanceCompletePhotoInput {
  client_upload_id: string;
  blob_path: string;
}

export interface PgOccupancyFloorRollup {
  floor: number | null;
  total_beds: number;
  vacant_beds: number;
  reserved_beds: number;
  occupied_beds: number;
  blocked_beds: number;
  inactive_beds: number;
  occupancy_percent: number;
}

export interface PgOccupancyAvailabilitySummary {
  available_from: string | null;
  bed_count: number;
}

export interface PgOccupancyUpcomingMove {
  bed_id: string;
  room_id: string;
  room_number: string;
  bed_label: string;
  date: string;
  occupant_name: string | null;
}

export interface PgOccupancySummary {
  property_id: string;
  total_beds: number;
  vacant_beds: number;
  reserved_beds: number;
  occupied_beds: number;
  blocked_beds: number;
  inactive_beds: number;
  occupancy_percent: number;
  by_status: Record<PgBedStatus, number>;
  by_floor: PgOccupancyFloorRollup[];
  upcoming_move_ins: PgOccupancyUpcomingMove[];
  upcoming_move_outs: PgOccupancyUpcomingMove[];
  available_from: PgOccupancyAvailabilitySummary[];
}

export interface PgTenantResidenceOperatorContact {
  user_id: string;
  name: string | null;
  phone_e164: string | null;
}

export interface PgTenantResidence {
  assignment_id: string;
  property_id: string;
  property_name: string;
  room_id: string;
  room_number: string;
  bed_id: string;
  bed_label: string;
  sharing: PgSharingKind | null;
  monthly_rent_paise: number | null;
  security_deposit_paise: number | null;
  notice_period_days: number | null;
  lock_in_months: number | null;
  expected_move_in_date: string | null;
  move_in_date: string | null;
  food_plan: PgMeals | null;
  operator_contact: PgTenantResidenceOperatorContact;
  house_rules: PgHouseRules | Record<string, unknown>;
  assignment_status: PgBedAssignmentStatus;
  notice_served_date: string | null;
  notice_end_date: string | null;
  notice_days_remaining: number | null;
  operator_move_out_request_id: string | null;
}
