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

export interface PgMaintenanceComment {
  id: string;
  request_id: string;
  author_user_id: string | null;
  author_role: "tenant" | "pg_operator" | "admin";
  body: string;
  attachments: string[];
  created_at: string;
}

export interface PgMaintenanceRequest {
  id: string;
  pg_property_id: string;
  assignment_id: string | null;
  created_by_user_id: string | null;
  category: string;
  description: string;
  photo_paths: string[];
  status: PgMaintenanceStatus;
  priority: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  comments: PgMaintenanceComment[];
}

export interface PgMaintenanceSummary {
  open_items: number;
  overdue_items: number;
}

export interface PgMaintenanceCreateInput {
  category: string;
  description: string;
  photo_paths?: string[];
  priority?: string | null;
}

export interface PgMaintenanceCommentInput {
  body: string;
  attachments?: string[];
}

export interface PgMaintenanceListFilters {
  status?: PgMaintenanceStatus;
  bed_id?: string;
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
