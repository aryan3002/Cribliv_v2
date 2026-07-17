import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  PgBed,
  PgBedStatus,
  PgManagedPropertyDetail,
  PgManagedPropertySummary,
  PgManagedRoomType,
  PgOccupancyFloorRollup,
  PgOccupancySummary,
  PgOccupancyUpcomingMove
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";

export interface PgOccupancyFilters {
  floor?: number;
  status?: PgBedStatus;
  available_from?: string;
}

type PropertySummaryRow = Omit<
  PgManagedPropertySummary,
  "room_count" | "bed_count" | "available_bed_count"
> & {
  room_count: string | number;
  bed_count: string | number;
  available_bed_count: string | number;
};

type CountsRow = {
  total_beds: number | string;
  vacant_beds: number | string;
  reserved_beds: number | string;
  occupied_beds: number | string;
  blocked_beds: number | string;
  inactive_beds: number | string;
  occupancy_percent: number | string;
};

type RoomTypeRow = Omit<PgManagedRoomType, "monthly_rent_paise"> & {
  monthly_rent_paise: number | string;
};

type BedRow = {
  id: string;
  room_id: string;
  bed_label: string;
  status: PgBedStatus;
  available_from: Date | string | null;
  sort_order: number | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const BED_STATUSES: PgBedStatus[] = ["vacant", "reserved", "occupied", "blocked", "inactive"];
const MANUAL_BED_STATUSES: PgBedStatus[] = ["blocked", "vacant", "inactive"];

function count(value: number | string): number {
  return Number(value);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (!(value instanceof Date)) return value;
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toBed(row: BedRow): PgBed {
  return {
    id: row.id,
    room_id: row.room_id,
    bed_label: row.bed_label,
    status: row.status,
    available_from: toDate(row.available_from),
    sort_order: row.sort_order,
    metadata: row.metadata ?? {},
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
}

function emptySummary(propertyId: string): PgOccupancySummary {
  return {
    property_id: propertyId,
    total_beds: 0,
    vacant_beds: 0,
    reserved_beds: 0,
    occupied_beds: 0,
    blocked_beds: 0,
    inactive_beds: 0,
    occupancy_percent: 0,
    by_status: { vacant: 0, reserved: 0, occupied: 0, blocked: 0, inactive: 0 },
    by_floor: [],
    upcoming_move_ins: [],
    upcoming_move_outs: [],
    available_from: []
  };
}

@Injectable()
export class PgOccupancyService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: "operations_requires_db",
      message: "PG operations require a database"
    });
  }

  private async assertManagedOwnership(operatorId: string, propertyId: string): Promise<void> {
    const result = await this.db.query<{ id: string }>(
      `SELECT id::text
         FROM pg_properties
        WHERE id = $1::uuid
          AND operator_id = $2::uuid
          AND manage_enabled = true
        LIMIT 1`,
      [propertyId, operatorId]
    );
    if (!result.rows[0]) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
  }

  private toProperty(row: PropertySummaryRow): PgManagedPropertySummary {
    return {
      ...row,
      room_count: count(row.room_count),
      bed_count: count(row.bed_count),
      available_bed_count: count(row.available_bed_count)
    };
  }

  private async queryProperties(operatorId: string, propertyId?: string) {
    return this.db.query<PropertySummaryRow>(
      `SELECT p.id::text, p.operator_id::text, p.display_name, p.internal_code,
              p.city_id, p.locality_id, p.total_floors, p.status::text,
              p.manage_enabled, p.layout_status,
              count(DISTINCT r.id) FILTER (WHERE r.status = 'active') AS room_count,
              count(DISTINCT b.id) FILTER (WHERE b.status <> 'inactive') AS bed_count,
              count(DISTINCT b.id) FILTER (WHERE b.status = 'vacant') AS available_bed_count
         FROM pg_properties p
         LEFT JOIN pg_rooms r ON r.pg_property_id = p.id
         LEFT JOIN pg_beds b ON b.room_id = r.id
        WHERE p.operator_id = $1::uuid
          AND p.manage_enabled = true
          AND ($2::uuid IS NULL OR p.id = $2::uuid)
        GROUP BY p.id
        ORDER BY p.created_at ASC`,
      [operatorId, propertyId ?? null]
    );
  }

  async listManagedProperties(operatorId: string): Promise<PgManagedPropertySummary[]> {
    if (!this.db.isEnabled()) return [];
    const result = await this.queryProperties(operatorId);
    return result.rows.map((row) => this.toProperty(row));
  }

  async getManagedProperty(
    operatorId: string,
    propertyId: string
  ): Promise<PgManagedPropertyDetail | null> {
    if (!this.db.isEnabled()) return null;
    await this.assertManagedOwnership(operatorId, propertyId);
    const result = await this.queryProperties(operatorId, propertyId);
    if (!result.rows[0]) return null;

    const roomTypes = await this.db.query<RoomTypeRow>(
      `SELECT rt.id::text, rt.sharing::text, rt.ac, rt.bathroom_kind::text,
              rt.furnishing::text, rt.monthly_rent_paise
         FROM pg_room_types rt
         JOIN pg_listings l ON l.id = rt.listing_id
        WHERE l.pg_property_id = $1::uuid
          AND l.operator_user_id = $2::uuid
        ORDER BY rt.monthly_rent_paise DESC, rt.id ASC`,
      [propertyId, operatorId]
    );

    return {
      ...this.toProperty(result.rows[0]),
      room_types: roomTypes.rows.map((roomType) => ({
        ...roomType,
        monthly_rent_paise: count(roomType.monthly_rent_paise)
      }))
    };
  }

  private validateFilters(filters: PgOccupancyFilters): void {
    if (filters.floor != null && !Number.isInteger(filters.floor)) {
      throw new BadRequestException({ code: "invalid_floor" });
    }
    if (filters.status != null && !BED_STATUSES.includes(filters.status)) {
      throw new BadRequestException({ code: "invalid_bed_status" });
    }
  }

  async summary(
    operatorId: string,
    propertyId: string,
    filters: PgOccupancyFilters = {}
  ): Promise<PgOccupancySummary> {
    if (!this.db.isEnabled()) return emptySummary(propertyId);
    await this.assertManagedOwnership(operatorId, propertyId);
    this.validateFilters(filters);

    const params = [
      propertyId,
      filters.floor ?? null,
      filters.status ?? null,
      filters.available_from ?? null
    ];
    const predicate = `r.pg_property_id = $1::uuid
      AND ($2::smallint IS NULL OR r.floor = $2::smallint)
      AND ($3::text IS NULL OR b.status::text = $3::text)
      AND ($4::date IS NULL OR b.available_from IS NULL OR b.available_from <= $4::date)`;
    const totals = await this.db.query<CountsRow>(
      `SELECT count(*)::int AS total_beds,
              count(*) FILTER (WHERE b.status = 'vacant')::int AS vacant_beds,
              count(*) FILTER (WHERE b.status = 'reserved')::int AS reserved_beds,
              count(*) FILTER (WHERE b.status = 'occupied')::int AS occupied_beds,
              count(*) FILTER (WHERE b.status = 'blocked')::int AS blocked_beds,
              count(*) FILTER (WHERE b.status = 'inactive')::int AS inactive_beds,
              COALESCE(round(
                100.0 * count(*) FILTER (WHERE b.status = 'occupied') /
                NULLIF(count(*) FILTER (WHERE b.status <> 'inactive'), 0)
              ), 0)::int AS occupancy_percent
         FROM pg_beds b
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE ${predicate}`,
      params
    );
    const byFloor = await this.db.query<CountsRow & { floor: number | null }>(
      `SELECT r.floor,
              count(*)::int AS total_beds,
              count(*) FILTER (WHERE b.status = 'vacant')::int AS vacant_beds,
              count(*) FILTER (WHERE b.status = 'reserved')::int AS reserved_beds,
              count(*) FILTER (WHERE b.status = 'occupied')::int AS occupied_beds,
              count(*) FILTER (WHERE b.status = 'blocked')::int AS blocked_beds,
              count(*) FILTER (WHERE b.status = 'inactive')::int AS inactive_beds,
              COALESCE(round(
                100.0 * count(*) FILTER (WHERE b.status = 'occupied') /
                NULLIF(count(*) FILTER (WHERE b.status <> 'inactive'), 0)
              ), 0)::int AS occupancy_percent
         FROM pg_beds b
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE ${predicate}
        GROUP BY r.floor
        ORDER BY r.floor ASC NULLS LAST`,
      params
    );
    const availability = await this.db.query<{
      available_from: Date | string | null;
      bed_count: number | string;
    }>(
      `SELECT b.available_from, count(*)::int AS bed_count
         FROM pg_beds b
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE ${predicate}
          AND b.status = 'vacant'
        GROUP BY b.available_from
        ORDER BY b.available_from ASC NULLS FIRST`,
      params
    );

    const moveParams = [propertyId, filters.floor ?? null];
    const moveIns = await this.db.query<{
      bed_id: string;
      room_id: string;
      room_number: string;
      bed_label: string;
      date: Date | string;
      occupant_name: string | null;
    }>(
      `SELECT b.id::text AS bed_id, r.id::text AS room_id, r.room_number, b.bed_label,
              a.expected_move_in_date AS date, a.occupant_name
         FROM pg_bed_assignments a
         JOIN pg_beds b ON b.id = a.bed_id
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE a.pg_property_id = $1::uuid
          AND r.pg_property_id = $1::uuid
          AND ($2::smallint IS NULL OR r.floor = $2::smallint)
          AND a.status = 'reserved'
          AND a.expected_move_in_date >= CURRENT_DATE
        ORDER BY a.expected_move_in_date, r.room_number, b.bed_label`,
      moveParams
    );
    const moveOuts = await this.db.query<{
      bed_id: string;
      room_id: string;
      room_number: string;
      bed_label: string;
      date: Date | string;
      occupant_name: string | null;
    }>(
      `SELECT b.id::text AS bed_id, r.id::text AS room_id, r.room_number, b.bed_label,
              COALESCE(a.move_out_date, a.notice_end_date) AS date, a.occupant_name
         FROM pg_bed_assignments a
         JOIN pg_beds b ON b.id = a.bed_id
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE a.pg_property_id = $1::uuid
          AND r.pg_property_id = $1::uuid
          AND ($2::smallint IS NULL OR r.floor = $2::smallint)
          AND a.status IN ('active','notice_served','move_out_requested','move_out_pending_confirmation')
          AND COALESCE(a.move_out_date, a.notice_end_date) >= CURRENT_DATE
        ORDER BY date, r.room_number, b.bed_label`,
      moveParams
    );

    const row = totals.rows[0];
    const floorRows: PgOccupancyFloorRollup[] = byFloor.rows.map((floor) => ({
      floor: floor.floor,
      total_beds: count(floor.total_beds),
      vacant_beds: count(floor.vacant_beds),
      reserved_beds: count(floor.reserved_beds),
      occupied_beds: count(floor.occupied_beds),
      blocked_beds: count(floor.blocked_beds),
      inactive_beds: count(floor.inactive_beds),
      occupancy_percent: count(floor.occupancy_percent)
    }));
    const mapMove = (move: (typeof moveIns.rows)[number]): PgOccupancyUpcomingMove => ({
      ...move,
      date: toDate(move.date)!
    });
    const summary = emptySummary(propertyId);
    summary.total_beds = count(row.total_beds);
    summary.vacant_beds = count(row.vacant_beds);
    summary.reserved_beds = count(row.reserved_beds);
    summary.occupied_beds = count(row.occupied_beds);
    summary.blocked_beds = count(row.blocked_beds);
    summary.inactive_beds = count(row.inactive_beds);
    summary.occupancy_percent = count(row.occupancy_percent);
    summary.by_status = {
      vacant: summary.vacant_beds,
      reserved: summary.reserved_beds,
      occupied: summary.occupied_beds,
      blocked: summary.blocked_beds,
      inactive: summary.inactive_beds
    };
    summary.by_floor = floorRows;
    summary.available_from = availability.rows.map((item) => ({
      available_from: toDate(item.available_from),
      bed_count: count(item.bed_count)
    }));
    summary.upcoming_move_ins = moveIns.rows.map(mapMove);
    summary.upcoming_move_outs = moveOuts.rows.map(mapMove);
    return summary;
  }

  async updateBedStatus(
    operatorId: string,
    propertyId: string,
    bedId: string,
    status: PgBedStatus
  ): Promise<PgBed> {
    if (!this.db.isEnabled()) throw this.unavailable();
    await this.assertManagedOwnership(operatorId, propertyId);
    if (!MANUAL_BED_STATUSES.includes(status)) {
      throw new BadRequestException({ code: "invalid_bed_status" });
    }

    const result = await this.db.query<BedRow>(
      `UPDATE pg_beds b
          SET status = $3::pg_bed_status
         FROM pg_rooms r
        WHERE b.id = $2::uuid
          AND b.room_id = r.id
          AND r.pg_property_id = $1::uuid
          AND b.status NOT IN ('reserved'::pg_bed_status, 'occupied'::pg_bed_status)
      RETURNING b.id::text, b.room_id::text, b.bed_label, b.status::text,
                b.available_from, b.sort_order, b.metadata, b.created_at, b.updated_at`,
      [propertyId, bedId, status]
    );
    if (!result.rows[0]) {
      const current = await this.db.query<{ status: PgBedStatus }>(
        `SELECT b.status::text
           FROM pg_beds b
           JOIN pg_rooms r ON r.id = b.room_id
          WHERE b.id = $2::uuid
            AND r.pg_property_id = $1::uuid`,
        [propertyId, bedId]
      );
      if (!current.rows[0]) {
        throw new NotFoundException({ code: "bed_not_found", message: "Bed not found" });
      }
      throw new BadRequestException({
        code: "invalid_bed_status_transition",
        message: `Cannot manually change a ${current.rows[0].status} bed`
      });
    }
    return toBed(result.rows[0]);
  }

  async relistBed(operatorId: string, propertyId: string, bedId: string): Promise<PgBed> {
    if (!this.db.isEnabled()) throw this.unavailable();
    await this.assertManagedOwnership(operatorId, propertyId);

    // Relist only frees a bed whose availability the operator controls (vacant refresh or
    // un-block). A reserved/occupied bed holds a live assignment and an inactive bed is retired;
    // those must go through the assignment or layout flows, never this quick action.
    const result = await this.db.query<BedRow>(
      `UPDATE pg_beds b
          SET status = 'vacant'::pg_bed_status, available_from = CURRENT_DATE
         FROM pg_rooms r
        WHERE b.id = $2::uuid
          AND b.room_id = r.id
          AND r.pg_property_id = $1::uuid
          AND b.status NOT IN (
            'reserved'::pg_bed_status, 'occupied'::pg_bed_status, 'inactive'::pg_bed_status
          )
      RETURNING b.id::text, b.room_id::text, b.bed_label, b.status::text,
                b.available_from, b.sort_order, b.metadata, b.created_at, b.updated_at`,
      [propertyId, bedId]
    );
    if (!result.rows[0]) {
      const current = await this.db.query<{ status: PgBedStatus }>(
        `SELECT b.status::text
           FROM pg_beds b
           JOIN pg_rooms r ON r.id = b.room_id
          WHERE b.id = $2::uuid
            AND r.pg_property_id = $1::uuid`,
        [propertyId, bedId]
      );
      if (!current.rows[0]) {
        throw new NotFoundException({ code: "bed_not_found", message: "Bed not found" });
      }
      throw new BadRequestException({
        code: "invalid_bed_status_transition",
        message: `Cannot relist a ${current.rows[0].status} bed`
      });
    }
    return toBed(result.rows[0]);
  }
}
