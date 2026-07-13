import type { PgBathroomKind, PgFurnishing, PgPropertyStatus, PgSharingKind } from "./pg-operator";

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
