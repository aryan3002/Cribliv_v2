import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  PgAssignmentInitiator,
  PgAssignmentEvent,
  PgBed,
  PgBedAssignment,
  PgBedAssignmentListFilters,
  PgBedAssignmentOccupantInput,
  PgBedAssignmentStatus,
  PgOperatorBedDetail,
  PgOperatorBedDetailRoom,
  PgServeNoticeInput
} from "@cribliv/shared-types";
import type { PoolClient } from "pg";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import { NotificationService } from "../../notifications/notification.service";
import { PgMaintenanceService } from "./pg-maintenance.service";

type AssignmentRow = {
  id: string;
  pg_property_id: string;
  bed_id: string;
  tenant_user_id: string | null;
  occupant_name: string;
  occupant_phone_e164: string;
  occupant_gender: string | null;
  emergency_contact: Record<string, unknown> | null;
  status: PgBedAssignmentStatus;
  expected_move_in_date: Date | string | null;
  move_in_date: Date | string | null;
  notice_served_date: Date | string | null;
  notice_end_date: Date | string | null;
  move_out_date: Date | string | null;
  monthly_rent_paise: number | string | null;
  security_deposit_paise: number | string | null;
  operator_notes: string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BedRow = {
  id: string;
  room_id: string;
  bed_label: string;
  status: PgBed["status"];
  available_from: Date | string | null;
  sort_order: number | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type BedDetailRow = {
  property_id: string;
  property_name: string;
  room_id: string;
  room_property_id: string;
  room_type_id: string | null;
  floor: number | null;
  room_number: string;
  display_label: string | null;
  bed_count: number | null;
  room_status: PgOperatorBedDetailRoom["status"];
  room_created_at: Date | string;
  room_updated_at: Date | string;
  bed_id: string;
  bed_room_id: string;
  bed_label: string;
  bed_status: PgBed["status"];
  available_from: Date | string | null;
  sort_order: number | null;
  metadata: Record<string, unknown> | null;
  bed_created_at: Date | string;
  bed_updated_at: Date | string;
};

type AssignmentEventRow = {
  id: string;
  assignment_id: string;
  event_type: string;
  initiator: PgAssignmentInitiator;
  actor_user_id: string | null;
  from_status: PgBedAssignmentStatus | null;
  to_status: PgBedAssignmentStatus;
  payload: Record<string, unknown> | null;
  created_at: Date | string;
};

type LockedAssignmentRow = AssignmentRow & {
  bed_status: string;
  operator_id: string;
  property_name: string;
};

type TransitionResult = {
  assignment: PgBedAssignment;
  operatorId: string;
  propertyName: string;
};

const ACTIVE_ASSIGNMENT_STATUSES = [
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toMoney(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function toAssignment(row: AssignmentRow): PgBedAssignment {
  return {
    id: row.id,
    pg_property_id: row.pg_property_id,
    bed_id: row.bed_id,
    tenant_user_id: row.tenant_user_id,
    occupant_name: row.occupant_name,
    occupant_phone_e164: row.occupant_phone_e164,
    occupant_gender: row.occupant_gender,
    emergency_contact: row.emergency_contact,
    status: row.status,
    expected_move_in_date: toDate(row.expected_move_in_date),
    move_in_date: toDate(row.move_in_date),
    notice_served_date: toDate(row.notice_served_date),
    notice_end_date: toDate(row.notice_end_date),
    move_out_date: toDate(row.move_out_date),
    monthly_rent_paise: toMoney(row.monthly_rent_paise),
    security_deposit_paise: toMoney(row.security_deposit_paise),
    operator_notes: row.operator_notes,
    created_by: row.created_by,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at)
  };
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

function toAssignmentEvent(row: AssignmentEventRow): PgAssignmentEvent {
  return {
    id: row.id,
    assignment_id: row.assignment_id,
    event_type: row.event_type,
    initiator: row.initiator,
    actor_user_id: row.actor_user_id,
    from_status: row.from_status,
    to_status: row.to_status,
    payload: row.payload ?? {},
    created_at: toIso(row.created_at)
  };
}

@Injectable()
export class PgBedAssignmentService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(NotificationService) private readonly notifications: NotificationService,
    @Optional() @Inject(PgMaintenanceService) private readonly maintenance?: PgMaintenanceService
  ) {}

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      code: "operations_requires_db",
      message: "PG operations require a database"
    });
  }

  private async assertManagedOwnership(
    operatorId: string,
    propertyId: string,
    client?: PoolClient
  ): Promise<void> {
    const sql = `SELECT id
                   FROM pg_properties
                  WHERE id = $1::uuid
                    AND operator_id = $2::uuid
                    AND manage_enabled = true
                  LIMIT 1${client ? " FOR UPDATE" : ""}`;
    const result = client
      ? await client.query<{ id: string }>(sql, [propertyId, operatorId])
      : await this.db.query<{ id: string }>(sql, [propertyId, operatorId]);
    if (!result.rows[0]) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
  }

  private validateOccupant(input: PgBedAssignmentOccupantInput): void {
    if (!input.occupant_name?.trim()) {
      throw new BadRequestException({ code: "occupant_name_required" });
    }
    if (!/^\+[1-9]\d{7,14}$/.test(input.occupant_phone_e164 ?? "")) {
      throw new BadRequestException({ code: "invalid_occupant_phone" });
    }
  }

  private assertTransition(
    current: PgBedAssignmentStatus,
    allowed: readonly PgBedAssignmentStatus[],
    target: PgBedAssignmentStatus
  ): void {
    if (!allowed.includes(current)) {
      throw new ConflictException({
        code: "invalid_assignment_transition",
        from_status: current,
        to_status: target
      });
    }
  }

  private async writeEvent(
    client: PoolClient,
    assignmentId: string,
    eventType: string,
    initiator: PgAssignmentInitiator,
    actorUserId: string,
    fromStatus: PgBedAssignmentStatus | null,
    toStatus: PgBedAssignmentStatus,
    payload: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `INSERT INTO pg_assignment_events
         (assignment_id, event_type, initiator, actor_user_id, from_status, to_status, payload)
       VALUES ($1::uuid, $2, $3::pg_assignment_initiator, $4::uuid, $5, $6, $7::jsonb)`,
      [
        assignmentId,
        eventType,
        initiator,
        actorUserId,
        fromStatus,
        toStatus,
        JSON.stringify(payload)
      ]
    );
  }

  private notify(input: Parameters<NotificationService["send"]>[0]): void {
    try {
      void this.notifications.send(input).catch(() => undefined);
    } catch {
      // Notifications are deliberately outside the state transaction and best-effort only.
    }
  }

  private async lockBed(client: PoolClient, propertyId: string, bedId: string) {
    const result = await client.query<{ id: string; status: string }>(
      `SELECT b.id::text, b.status::text
         FROM pg_beds b
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE b.id = $2::uuid
          AND r.pg_property_id = $1::uuid
        FOR UPDATE OF b`,
      [propertyId, bedId]
    );
    if (!result.rows[0]) {
      throw new NotFoundException({ code: "bed_not_found", message: "Bed not found" });
    }
    return result.rows[0];
  }

  private async lockOperatorAssignment(
    client: PoolClient,
    propertyId: string,
    assignmentId: string
  ): Promise<LockedAssignmentRow> {
    const result = await client.query<LockedAssignmentRow>(
      `SELECT a.id::text, a.pg_property_id::text, a.bed_id::text,
              a.tenant_user_id::text, a.occupant_name, a.occupant_phone_e164,
              a.occupant_gender, a.emergency_contact, a.status::text,
              a.expected_move_in_date, a.move_in_date, a.notice_served_date,
              a.notice_end_date, a.move_out_date, a.monthly_rent_paise,
              a.security_deposit_paise, a.operator_notes, a.created_by::text,
              a.created_at, a.updated_at, b.status::text AS bed_status,
              p.operator_id::text, p.display_name AS property_name
         FROM pg_bed_assignments a
         JOIN pg_properties p ON p.id = a.pg_property_id
         JOIN pg_beds b ON b.id = a.bed_id
         JOIN pg_rooms r ON r.id = b.room_id
        WHERE a.id = $2::uuid
          AND a.pg_property_id = $1::uuid
          AND r.pg_property_id = $1::uuid
        FOR UPDATE OF a, b`,
      [propertyId, assignmentId]
    );
    if (!result.rows[0]) {
      throw new NotFoundException({
        code: "assignment_not_found",
        message: "Assignment not found"
      });
    }
    return result.rows[0];
  }

  private async lockTenantAssignment(
    client: PoolClient,
    tenantId: string,
    assignmentId: string
  ): Promise<LockedAssignmentRow> {
    const result = await client.query<LockedAssignmentRow>(
      `SELECT a.id::text, a.pg_property_id::text, a.bed_id::text,
              a.tenant_user_id::text, a.occupant_name, a.occupant_phone_e164,
              a.occupant_gender, a.emergency_contact, a.status::text,
              a.expected_move_in_date, a.move_in_date, a.notice_served_date,
              a.notice_end_date, a.move_out_date, a.monthly_rent_paise,
              a.security_deposit_paise, a.operator_notes, a.created_by::text,
              a.created_at, a.updated_at, b.status::text AS bed_status,
              p.operator_id::text, p.display_name AS property_name
         FROM pg_bed_assignments a
         JOIN pg_properties p ON p.id = a.pg_property_id
         JOIN pg_beds b ON b.id = a.bed_id
         JOIN users caller ON caller.id = $1::uuid
        WHERE a.id = $2::uuid
          AND (
            a.tenant_user_id = $1::uuid
            OR (a.tenant_user_id IS NULL AND a.occupant_phone_e164 = caller.phone_e164)
          )
        FOR UPDATE OF a, b`,
      [tenantId, assignmentId]
    );
    if (!result.rows[0]) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
    const row = result.rows[0];
    if (row.tenant_user_id === null) {
      await client.query(
        `UPDATE pg_bed_assignments
            SET tenant_user_id = $1::uuid
          WHERE id = $2::uuid
            AND tenant_user_id IS NULL`,
        [tenantId, assignmentId]
      );
      row.tenant_user_id = tenantId;
    }
    return row;
  }

  async reserve(
    operatorId: string,
    propertyId: string,
    bedId: string,
    occupant: PgBedAssignmentOccupantInput
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();

    return transaction(
      this.db,
      async (client) => {
        await this.assertManagedOwnership(operatorId, propertyId, client);
        this.validateOccupant(occupant);
        const bed = await this.lockBed(client, propertyId, bedId);
        if (bed.status !== "vacant") {
          throw new ConflictException({ code: "bed_not_vacant" });
        }

        const linkedUser = await client.query<{ id: string }>(
          `SELECT id::text FROM users WHERE phone_e164 = $1 LIMIT 1`,
          [occupant.occupant_phone_e164]
        );
        const tenantUserId = linkedUser.rows[0]?.id ?? null;
        const inserted = await client.query<AssignmentRow>(
          `INSERT INTO pg_bed_assignments
           (pg_property_id, bed_id, tenant_user_id, occupant_name, occupant_phone_e164, occupant_gender,
            emergency_contact, status, expected_move_in_date, monthly_rent_paise,
            security_deposit_paise, operator_notes, created_by)
         VALUES
           ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, 'reserved', $8::date,
            $9::bigint, $10::bigint, $11, $12::uuid)
         RETURNING *`,
          [
            propertyId,
            bedId,
            tenantUserId,
            occupant.occupant_name.trim(),
            occupant.occupant_phone_e164,
            occupant.occupant_gender?.trim() || null,
            occupant.emergency_contact ? JSON.stringify(occupant.emergency_contact) : null,
            occupant.expected_move_in_date ?? null,
            occupant.monthly_rent_paise ?? null,
            occupant.security_deposit_paise ?? null,
            occupant.operator_notes?.trim() || null,
            operatorId
          ]
        );
        await client.query(
          `UPDATE pg_beds
            SET status = 'reserved'::pg_bed_status, available_from = NULL
          WHERE id = $1::uuid`,
          [bedId]
        );
        await this.writeEvent(
          client,
          inserted.rows[0].id,
          "reserved",
          "operator",
          operatorId,
          null,
          "reserved",
          {
            bed_id: bedId,
            expected_move_in_date: occupant.expected_move_in_date ?? null,
            tenant_user_id: tenantUserId
          }
        );
        return toAssignment(inserted.rows[0]);
      },
      { uniqueViolationCode: "bed_or_tenant_occupied" }
    );
  }

  async moveIn(
    operatorId: string,
    propertyId: string,
    bedId: string,
    occupant: PgBedAssignmentOccupantInput
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();

    return transaction(
      this.db,
      async (client) => {
        await this.assertManagedOwnership(operatorId, propertyId, client);
        this.validateOccupant(occupant);
        const bed = await this.lockBed(client, propertyId, bedId);
        if (bed.status !== "vacant" && bed.status !== "reserved") {
          throw new ConflictException({ code: "bed_not_vacant" });
        }

        const current = await client.query<AssignmentRow>(
          `SELECT *
           FROM pg_bed_assignments
          WHERE bed_id = $1::uuid
            AND status = ANY($2::pg_assignment_status[])
          LIMIT 1
          FOR UPDATE`,
          [bedId, [...ACTIVE_ASSIGNMENT_STATUSES]]
        );
        const existing = current.rows[0];
        if (bed.status === "reserved" && existing?.status !== "reserved") {
          throw new ConflictException({ code: "invalid_assignment_transition" });
        }
        if (bed.status === "vacant" && existing) {
          throw new ConflictException({ code: "bed_or_tenant_occupied" });
        }

        const linkedUser = await client.query<{ id: string }>(
          `SELECT id::text FROM users WHERE phone_e164 = $1 LIMIT 1`,
          [occupant.occupant_phone_e164]
        );
        const tenantUserId = linkedUser.rows[0]?.id ?? null;
        let assignment: AssignmentRow;
        if (existing) {
          const updated = await client.query<AssignmentRow>(
            `UPDATE pg_bed_assignments
              SET tenant_user_id = $2::uuid,
                  occupant_name = $3,
                  occupant_phone_e164 = $4,
                  occupant_gender = $5,
                  emergency_contact = $6::jsonb,
                  status = 'active',
                  expected_move_in_date = COALESCE($7::date, expected_move_in_date),
                  move_in_date = COALESCE($8::date, CURRENT_DATE),
                  monthly_rent_paise = $9::bigint,
                  security_deposit_paise = $10::bigint,
                  operator_notes = $11
            WHERE id = $1::uuid
            RETURNING *`,
            [
              existing.id,
              tenantUserId,
              occupant.occupant_name.trim(),
              occupant.occupant_phone_e164,
              occupant.occupant_gender?.trim() || null,
              occupant.emergency_contact ? JSON.stringify(occupant.emergency_contact) : null,
              occupant.expected_move_in_date ?? null,
              occupant.move_in_date ?? null,
              occupant.monthly_rent_paise ?? null,
              occupant.security_deposit_paise ?? null,
              occupant.operator_notes?.trim() || null
            ]
          );
          assignment = updated.rows[0];
        } else {
          const inserted = await client.query<AssignmentRow>(
            `INSERT INTO pg_bed_assignments
             (pg_property_id, bed_id, tenant_user_id, occupant_name, occupant_phone_e164,
              occupant_gender, emergency_contact, status, expected_move_in_date, move_in_date,
              monthly_rent_paise, security_deposit_paise, operator_notes, created_by)
           VALUES
             ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::jsonb, 'active', $8::date,
              COALESCE($9::date, CURRENT_DATE), $10::bigint, $11::bigint, $12, $13::uuid)
           RETURNING *`,
            [
              propertyId,
              bedId,
              tenantUserId,
              occupant.occupant_name.trim(),
              occupant.occupant_phone_e164,
              occupant.occupant_gender?.trim() || null,
              occupant.emergency_contact ? JSON.stringify(occupant.emergency_contact) : null,
              occupant.expected_move_in_date ?? null,
              occupant.move_in_date ?? null,
              occupant.monthly_rent_paise ?? null,
              occupant.security_deposit_paise ?? null,
              occupant.operator_notes?.trim() || null,
              operatorId
            ]
          );
          assignment = inserted.rows[0];
        }

        await client.query(
          `UPDATE pg_beds
            SET status = 'occupied'::pg_bed_status, available_from = NULL
          WHERE id = $1::uuid`,
          [bedId]
        );
        await this.writeEvent(
          client,
          assignment.id,
          "moved_in",
          "operator",
          operatorId,
          existing?.status ?? null,
          "active",
          { bed_id: bedId, tenant_user_id: tenantUserId }
        );
        return toAssignment(assignment);
      },
      { uniqueViolationCode: "bed_or_tenant_occupied" }
    );
  }

  async list(
    operatorId: string,
    propertyId: string,
    filters: PgBedAssignmentListFilters = {}
  ): Promise<PgBedAssignment[]> {
    if (!this.db.isEnabled()) return [];
    await this.assertManagedOwnership(operatorId, propertyId);
    const result = await this.db.query<AssignmentRow>(
      `SELECT *
         FROM pg_bed_assignments
        WHERE pg_property_id = $1::uuid
          AND ($2::text IS NULL OR status::text = $2)
          AND ($3::uuid IS NULL OR bed_id = $3::uuid)
          AND ($4::uuid IS NULL OR tenant_user_id = $4::uuid)
        ORDER BY created_at DESC, id`,
      [propertyId, filters.status ?? null, filters.bed_id ?? null, filters.tenant_user_id ?? null]
    );
    return result.rows.map(toAssignment);
  }

  private async operatorTransition(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    allowed: readonly PgBedAssignmentStatus[],
    target: PgBedAssignmentStatus,
    eventType: string,
    bedStatus: "occupied" | "vacant"
  ): Promise<TransitionResult> {
    return transaction(
      this.db,
      async (client) => {
        await this.assertManagedOwnership(operatorId, propertyId, client);
        const current = await this.lockOperatorAssignment(client, propertyId, assignmentId);
        this.assertTransition(current.status, allowed, target);

        const updated = await client.query<AssignmentRow>(
          `UPDATE pg_bed_assignments
            SET status = $2::pg_assignment_status,
                move_out_date = CASE WHEN $2 = 'moved_out' THEN CURRENT_DATE ELSE move_out_date END
          WHERE id = $1::uuid
          RETURNING *`,
          [assignmentId, target]
        );
        await client.query(
          `UPDATE pg_beds
            SET status = $2::pg_bed_status,
                available_from = CASE WHEN $2 = 'vacant' THEN CURRENT_DATE ELSE NULL END
          WHERE id = $1::uuid`,
          [current.bed_id, bedStatus]
        );
        await this.writeEvent(
          client,
          assignmentId,
          eventType,
          "operator",
          operatorId,
          current.status,
          target,
          { bed_id: current.bed_id }
        );
        return {
          assignment: toAssignment(updated.rows[0]),
          operatorId: current.operator_id,
          propertyName: current.property_name
        };
      },
      { uniqueViolationCode: "bed_or_tenant_occupied" }
    );
  }

  async operatorMoveOutRequest(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.operatorTransition(
      operatorId,
      propertyId,
      assignmentId,
      ["active", "notice_served", "move_out_requested"],
      "move_out_pending_confirmation",
      "operator_move_out_requested",
      "occupied"
    );
    if (result.assignment.tenant_user_id) {
      this.notify({
        type: "tenant.pg_move_out_requested",
        recipientUserId: result.assignment.tenant_user_id,
        payload: {
          assignment_id: assignmentId,
          occupant_name: result.assignment.occupant_name,
          property_id: propertyId,
          property_name: result.propertyName
        }
      });
    }
    return result.assignment;
  }

  async confirmMoveOut(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.operatorTransition(
      operatorId,
      propertyId,
      assignmentId,
      ["move_out_pending_confirmation"],
      "moved_out",
      "move_out_confirmed",
      "vacant"
    );
    return result.assignment;
  }

  async operatorDirectMoveOut(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.operatorTransition(
      operatorId,
      propertyId,
      assignmentId,
      ["active", "notice_served", "move_out_requested", "move_out_pending_confirmation"],
      "moved_out",
      "operator_direct_move_out",
      "vacant"
    );
    return result.assignment;
  }

  async cancelMoveOut(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.operatorTransition(
      operatorId,
      propertyId,
      assignmentId,
      ["move_out_pending_confirmation"],
      "active",
      "move_out_cancelled",
      "occupied"
    );
    return result.assignment;
  }

  async getBedDetail(
    operatorId: string,
    propertyId: string,
    bedId: string
  ): Promise<PgOperatorBedDetail> {
    if (!this.db.isEnabled()) throw this.unavailable();
    await this.assertManagedOwnership(operatorId, propertyId);

    const bedResult = await this.db.query<BedDetailRow>(
      `SELECT p.id::text AS property_id,
              p.display_name AS property_name,
              r.id::text AS room_id,
              r.pg_property_id::text AS room_property_id,
              r.room_type_id::text,
              r.floor,
              r.room_number,
              r.display_label,
              r.bed_count,
              r.status::text AS room_status,
              r.created_at AS room_created_at,
              r.updated_at AS room_updated_at,
              b.id::text AS bed_id,
              b.room_id::text AS bed_room_id,
              b.bed_label,
              b.status::text AS bed_status,
              b.available_from,
              b.sort_order,
              b.metadata,
              b.created_at AS bed_created_at,
              b.updated_at AS bed_updated_at
         FROM pg_beds b
         JOIN pg_rooms r ON r.id = b.room_id
         JOIN pg_properties p ON p.id = r.pg_property_id
        WHERE p.id = $1::uuid
          AND b.id = $2::uuid
        LIMIT 1`,
      [propertyId, bedId]
    );
    const row = bedResult.rows[0];
    if (!row) {
      throw new NotFoundException({ code: "bed_not_found", message: "Bed not found" });
    }

    const assignmentResult = await this.db.query<AssignmentRow>(
      `SELECT *
         FROM pg_bed_assignments
        WHERE pg_property_id = $1::uuid
          AND bed_id = $2::uuid
          AND status = ANY($3::pg_assignment_status[])
        ORDER BY updated_at DESC, created_at DESC
        LIMIT 1`,
      [propertyId, bedId, [...ACTIVE_ASSIGNMENT_STATUSES]]
    );

    const eventResult = await this.db.query<AssignmentEventRow>(
      `SELECT e.id::text,
              e.assignment_id::text,
              e.event_type,
              e.initiator::text,
              e.actor_user_id::text,
              e.from_status,
              e.to_status,
              e.payload,
              e.created_at
         FROM pg_assignment_events e
         JOIN pg_bed_assignments a ON a.id = e.assignment_id
        WHERE a.pg_property_id = $1::uuid
          AND a.bed_id = $2::uuid
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 20`,
      [propertyId, bedId]
    );

    const maintenanceSummary = this.maintenance
      ? await this.maintenance.summaryForBed(operatorId, propertyId, bedId)
      : { open_items: 0, overdue_items: 0 };

    return {
      property_id: row.property_id,
      property_name: row.property_name,
      room: {
        id: row.room_id,
        pg_property_id: row.room_property_id,
        room_type_id: row.room_type_id,
        floor: row.floor,
        room_number: row.room_number,
        display_label: row.display_label,
        bed_count: Number(row.bed_count ?? 0),
        status: row.room_status,
        created_at: toIso(row.room_created_at),
        updated_at: toIso(row.room_updated_at)
      },
      bed: toBed({
        id: row.bed_id,
        room_id: row.bed_room_id,
        bed_label: row.bed_label,
        status: row.bed_status,
        available_from: row.available_from,
        sort_order: row.sort_order,
        metadata: row.metadata,
        created_at: row.bed_created_at,
        updated_at: row.bed_updated_at
      }),
      assignment: assignmentResult.rows[0] ? toAssignment(assignmentResult.rows[0]) : null,
      events: eventResult.rows.map(toAssignmentEvent),
      maintenance_summary: maintenanceSummary
    };
  }

  async cancelReservation(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.operatorTransition(
      operatorId,
      propertyId,
      assignmentId,
      ["reserved"],
      "cancelled",
      "reservation_cancelled",
      "vacant"
    );
    return result.assignment;
  }

  async serveNotice(
    tenantId: string,
    assignmentId: string,
    input: PgServeNoticeInput
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.notice_end_date)) {
      throw new BadRequestException({ code: "invalid_notice_end_date" });
    }

    const result = await transaction<TransitionResult>(
      this.db,
      async (client) => {
        const current = await this.lockTenantAssignment(client, tenantId, assignmentId);
        this.assertTransition(current.status, ["active"], "notice_served");
        const updated = await client.query<AssignmentRow>(
          `UPDATE pg_bed_assignments
            SET status = 'notice_served',
                notice_served_date = CURRENT_DATE,
                notice_end_date = $2::date
          WHERE id = $1::uuid
          RETURNING *`,
          [assignmentId, input.notice_end_date]
        );
        await client.query(
          `UPDATE pg_beds
            SET status = 'occupied'::pg_bed_status, available_from = NULL
          WHERE id = $1::uuid`,
          [current.bed_id]
        );
        await this.writeEvent(
          client,
          assignmentId,
          "notice_served",
          "tenant",
          tenantId,
          current.status,
          "notice_served",
          { bed_id: current.bed_id, notice_end_date: input.notice_end_date }
        );
        return {
          assignment: toAssignment(updated.rows[0]),
          operatorId: current.operator_id,
          propertyName: current.property_name
        };
      },
      { uniqueViolationCode: "bed_or_tenant_occupied" }
    );
    this.notify({
      type: "operator.pg_notice_served",
      recipientUserId: result.operatorId,
      payload: {
        assignment_id: assignmentId,
        occupant_name: result.assignment.occupant_name,
        notice_end_date: result.assignment.notice_end_date,
        property_id: result.assignment.pg_property_id
      }
    });
    return result.assignment;
  }

  private async tenantTransition(
    tenantId: string,
    assignmentId: string,
    allowed: readonly PgBedAssignmentStatus[],
    target: PgBedAssignmentStatus,
    eventType: string,
    bedStatus: "occupied" | "vacant"
  ): Promise<TransitionResult> {
    return transaction(
      this.db,
      async (client) => {
        const current = await this.lockTenantAssignment(client, tenantId, assignmentId);
        this.assertTransition(current.status, allowed, target);
        const updated = await client.query<AssignmentRow>(
          `UPDATE pg_bed_assignments
            SET status = $2::pg_assignment_status,
                move_out_date = CASE WHEN $2 = 'moved_out' THEN CURRENT_DATE ELSE move_out_date END
          WHERE id = $1::uuid
          RETURNING *`,
          [assignmentId, target]
        );
        await client.query(
          `UPDATE pg_beds
            SET status = $2::pg_bed_status,
                available_from = CASE WHEN $2 = 'vacant' THEN CURRENT_DATE ELSE NULL END
          WHERE id = $1::uuid`,
          [current.bed_id, bedStatus]
        );
        await this.writeEvent(
          client,
          assignmentId,
          eventType,
          "tenant",
          tenantId,
          current.status,
          target,
          { bed_id: current.bed_id }
        );
        return {
          assignment: toAssignment(updated.rows[0]),
          operatorId: current.operator_id,
          propertyName: current.property_name
        };
      },
      { uniqueViolationCode: "bed_or_tenant_occupied" }
    );
  }

  async tenantMoveOutRequest(tenantId: string, assignmentId: string): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.tenantTransition(
      tenantId,
      assignmentId,
      ["active"],
      "move_out_requested",
      "tenant_move_out_requested",
      "occupied"
    );
    this.notify({
      type: "operator.pg_move_out_requested",
      recipientUserId: result.operatorId,
      payload: {
        assignment_id: assignmentId,
        occupant_name: result.assignment.occupant_name,
        property_id: result.assignment.pg_property_id
      }
    });
    return result.assignment;
  }

  async acceptOperatorMoveOut(tenantId: string, assignmentId: string): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.tenantTransition(
      tenantId,
      assignmentId,
      ["move_out_pending_confirmation"],
      "moved_out",
      "operator_move_out_accepted",
      "vacant"
    );
    return result.assignment;
  }

  async rejectOperatorMoveOut(tenantId: string, assignmentId: string): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.tenantTransition(
      tenantId,
      assignmentId,
      ["move_out_pending_confirmation"],
      "active",
      "operator_move_out_rejected",
      "occupied"
    );
    return result.assignment;
  }
}
