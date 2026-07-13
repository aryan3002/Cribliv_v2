import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { PgBedAssignment, PgServeNoticeInput, PgTenantResidence } from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { PgBedAssignmentService } from "./pg-bed-assignment.service";

type ResidenceRow = {
  assignment_id: string;
  property_id: string;
  property_name: string;
  room_id: string;
  room_number: string;
  bed_id: string;
  bed_label: string;
  sharing: PgTenantResidence["sharing"];
  monthly_rent_paise: number | string | null;
  security_deposit_paise: number | string | null;
  notice_period_days: number | string | null;
  lock_in_months: number | string | null;
  expected_move_in_date: Date | string | null;
  move_in_date: Date | string | null;
  meals: PgTenantResidence["food_plan"];
  operator_user_id: string;
  operator_name: string | null;
  operator_phone_e164: string | null;
  house_rules: PgTenantResidence["house_rules"];
  assignment_status: PgTenantResidence["assignment_status"];
  notice_served_date: Date | string | null;
  notice_end_date: Date | string | null;
  notice_days_remaining: number | string | null;
};

type NoticeInput = Partial<PgServeNoticeInput>;

const RESIDENCE_STATUSES = [
  "reserved",
  "active",
  "notice_served",
  "move_out_requested",
  "move_out_pending_confirmation"
] as const;

function toDate(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

function toNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function toResidence(row: ResidenceRow): PgTenantResidence {
  return {
    assignment_id: row.assignment_id,
    property_id: row.property_id,
    property_name: row.property_name,
    room_id: row.room_id,
    room_number: row.room_number,
    bed_id: row.bed_id,
    bed_label: row.bed_label,
    sharing: row.sharing,
    monthly_rent_paise: toNumber(row.monthly_rent_paise),
    security_deposit_paise: toNumber(row.security_deposit_paise),
    notice_period_days: toNumber(row.notice_period_days),
    lock_in_months: toNumber(row.lock_in_months),
    expected_move_in_date: toDate(row.expected_move_in_date),
    move_in_date: toDate(row.move_in_date),
    food_plan: row.meals,
    operator_contact: {
      user_id: row.operator_user_id,
      name: row.operator_name,
      phone_e164: row.operator_phone_e164
    },
    house_rules: row.house_rules,
    assignment_status: row.assignment_status,
    notice_served_date: toDate(row.notice_served_date),
    notice_end_date: toDate(row.notice_end_date),
    notice_days_remaining: toNumber(row.notice_days_remaining),
    operator_move_out_request_id:
      row.assignment_status === "move_out_pending_confirmation" ? row.assignment_id : null
  };
}

@Injectable()
export class PgResidenceService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PgBedAssignmentService) private readonly assignments: PgBedAssignmentService
  ) {}

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: "operations_requires_db",
      message: "PG operations require a database"
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: "residence_not_found",
      message: "No active PG residence found"
    });
  }

  private async queryResidence(
    userId: string,
    options: { assignmentId?: string; includeTerminal?: boolean } = {}
  ): Promise<PgTenantResidence | null> {
    const statuses = options.includeTerminal
      ? [...RESIDENCE_STATUSES, "moved_out", "cancelled"]
      : [...RESIDENCE_STATUSES];
    const result = await this.db.query<ResidenceRow>(
      `WITH caller AS (
         SELECT id, phone_e164
           FROM users
          WHERE id = $1::uuid
       )
       SELECT a.id::text AS assignment_id,
              a.pg_property_id::text AS property_id,
              p.display_name AS property_name,
              r.id::text AS room_id,
              r.room_number,
              b.id::text AS bed_id,
              b.bed_label,
              rt.sharing::text AS sharing,
              COALESCE(a.monthly_rent_paise, rt.monthly_rent_paise, pl.starting_rent_paise)
                AS monthly_rent_paise,
              COALESCE(a.security_deposit_paise, d.security_deposit_paise)
                AS security_deposit_paise,
              d.notice_period_days,
              d.lock_in_months,
              a.expected_move_in_date,
              a.move_in_date,
              d.meals,
              op.id::text AS operator_user_id,
              op.full_name AS operator_name,
              op.phone_e164 AS operator_phone_e164,
              COALESCE(d.house_rules, '{}'::jsonb) AS house_rules,
              a.status::text AS assignment_status,
              a.notice_served_date,
              a.notice_end_date,
              CASE
                WHEN a.notice_end_date IS NULL THEN NULL
                ELSE (a.notice_end_date - CURRENT_DATE)::int
              END AS notice_days_remaining
         FROM caller
         JOIN pg_bed_assignments a
           ON (
             a.tenant_user_id = caller.id
             OR (a.tenant_user_id IS NULL AND a.occupant_phone_e164 = caller.phone_e164)
           )
         JOIN pg_properties p ON p.id = a.pg_property_id
         JOIN users op ON op.id = p.operator_id
         JOIN pg_beds b ON b.id = a.bed_id
         JOIN pg_rooms r ON r.id = b.room_id AND r.pg_property_id = p.id
         LEFT JOIN pg_room_types rt ON rt.id = r.room_type_id
         LEFT JOIN pg_listings pl ON pl.id = rt.listing_id
         LEFT JOIN pg_details d ON d.listing_id = rt.listing_id
        WHERE a.status = ANY($2::pg_assignment_status[])
          AND ($3::uuid IS NULL OR a.id = $3::uuid)
        ORDER BY CASE a.status::text
                   WHEN 'active' THEN 1
                   WHEN 'notice_served' THEN 2
                   WHEN 'move_out_requested' THEN 3
                   WHEN 'move_out_pending_confirmation' THEN 4
                   WHEN 'reserved' THEN 5
                   ELSE 6
                 END,
                 a.updated_at DESC,
                 a.id
        LIMIT 1`,
      [userId, statuses, options.assignmentId ?? null]
    );
    return result.rows[0] ? toResidence(result.rows[0]) : null;
  }

  async resolve(userId: string): Promise<PgTenantResidence | null> {
    if (!this.db.isEnabled()) return null;
    return this.queryResidence(userId);
  }

  private async currentAssignmentId(userId: string): Promise<string> {
    const residence = await this.resolve(userId);
    if (!residence) throw this.notFound();
    return residence.assignment_id;
  }

  private async afterAssignment(
    userId: string,
    assignment: PgBedAssignment
  ): Promise<PgTenantResidence> {
    const residence = await this.queryResidence(userId, {
      assignmentId: assignment.id,
      includeTerminal: true
    });
    if (!residence) throw this.notFound();
    return residence;
  }

  async serveNotice(userId: string, input: NoticeInput = {}): Promise<PgTenantResidence> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const assignmentId = await this.currentAssignmentId(userId);
    const noticeEndDate = input.notice_end_date ?? (await this.defaultNoticeEndDate(assignmentId));
    const assignment = await this.assignments.serveNotice(userId, assignmentId, {
      notice_end_date: noticeEndDate
    });
    return this.afterAssignment(userId, assignment);
  }

  async tenantMoveOutRequest(userId: string): Promise<PgTenantResidence> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const assignmentId = await this.currentAssignmentId(userId);
    const assignment = await this.assignments.tenantMoveOutRequest(userId, assignmentId);
    return this.afterAssignment(userId, assignment);
  }

  async acceptOperatorMoveOut(userId: string, requestId: string): Promise<PgTenantResidence> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const assignment = await this.assignments.acceptOperatorMoveOut(userId, requestId);
    return this.afterAssignment(userId, assignment);
  }

  async rejectOperatorMoveOut(userId: string, requestId: string): Promise<PgTenantResidence> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const assignment = await this.assignments.rejectOperatorMoveOut(userId, requestId);
    return this.afterAssignment(userId, assignment);
  }

  private async defaultNoticeEndDate(assignmentId: string): Promise<string> {
    const result = await this.db.query<{ notice_end_date: Date | string }>(
      `SELECT (CURRENT_DATE + COALESCE(d.notice_period_days, 30))::date AS notice_end_date
         FROM pg_bed_assignments a
         JOIN pg_rooms r ON r.pg_property_id = a.pg_property_id
         JOIN pg_beds b ON b.id = a.bed_id AND b.room_id = r.id
         LEFT JOIN pg_room_types rt ON rt.id = r.room_type_id
         LEFT JOIN pg_details d ON d.listing_id = rt.listing_id
        WHERE a.id = $1::uuid
        LIMIT 1`,
      [assignmentId]
    );
    return toDate(result.rows[0].notice_end_date) ?? new Date().toISOString().slice(0, 10);
  }
}
