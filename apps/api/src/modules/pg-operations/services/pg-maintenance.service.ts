import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  PgMaintenanceComment,
  PgMaintenanceCreateInput,
  PgMaintenanceListFilters,
  PgMaintenanceRequest,
  PgMaintenanceStatus,
  PgMaintenanceSummary
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";

type MaintenanceRow = {
  id: string;
  pg_property_id: string;
  assignment_id: string | null;
  created_by_user_id: string | null;
  category: string;
  description: string;
  photo_paths: unknown;
  status: PgMaintenanceStatus;
  priority: string | null;
  closed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type CommentRow = {
  id: string;
  request_id: string;
  author_user_id: string | null;
  author_role: PgMaintenanceComment["author_role"];
  body: string;
  attachments: unknown;
  created_at: Date | string;
};

type ResidenceAssignmentRow = {
  assignment_id: string;
  property_id: string;
};

const OPEN_MAINTENANCE_STATUSES: PgMaintenanceStatus[] = [
  "open",
  "in_progress",
  "waiting_on_tenant"
];

const STATUS_TRANSITIONS: Record<PgMaintenanceStatus, readonly PgMaintenanceStatus[]> = {
  open: ["in_progress", "cancelled"],
  in_progress: ["waiting_on_tenant", "resolved", "cancelled"],
  waiting_on_tenant: ["in_progress"],
  resolved: ["closed"],
  closed: [],
  cancelled: []
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoNullable(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toComment(row: CommentRow): PgMaintenanceComment {
  return {
    id: row.id,
    request_id: row.request_id,
    author_user_id: row.author_user_id,
    author_role: row.author_role,
    body: row.body,
    attachments: stringArray(row.attachments),
    created_at: toIso(row.created_at)
  };
}

function toRequest(
  row: MaintenanceRow,
  comments: PgMaintenanceComment[] = []
): PgMaintenanceRequest {
  return {
    id: row.id,
    pg_property_id: row.pg_property_id,
    assignment_id: row.assignment_id,
    created_by_user_id: row.created_by_user_id,
    category: row.category,
    description: row.description,
    photo_paths: stringArray(row.photo_paths),
    status: row.status,
    priority: row.priority,
    closed_at: toIsoNullable(row.closed_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    comments
  };
}

function cleanRequired(value: string | undefined, code: string): string {
  const cleaned = (value ?? "").trim();
  if (!cleaned) throw new BadRequestException({ code });
  return cleaned;
}

@Injectable()
export class PgMaintenanceService {
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

  private validateStringArray(value: unknown, code: string): string[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new BadRequestException({ code });
    }
    return value.map((item) => item.trim()).filter(Boolean);
  }

  private async currentResidenceAssignment(userId: string): Promise<ResidenceAssignmentRow> {
    const result = await this.db.query<ResidenceAssignmentRow>(
      `WITH caller AS (
         SELECT id, phone_e164
           FROM users
          WHERE id = $1::uuid
       )
       SELECT a.id::text AS assignment_id,
              a.pg_property_id::text AS property_id
         FROM caller
         JOIN pg_bed_assignments a
           ON (
             a.tenant_user_id = caller.id
             OR (a.tenant_user_id IS NULL AND a.occupant_phone_e164 = caller.phone_e164)
           )
        WHERE a.status IN (
          'reserved',
          'active',
          'notice_served',
          'move_out_requested',
          'move_out_pending_confirmation'
        )
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
      [userId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException({
        code: "residence_not_found",
        message: "No active PG residence found"
      });
    }
    return row;
  }

  private async callerRole(userId: string): Promise<Role> {
    const result = await this.db.query<{ role: Role }>(
      `SELECT role::text AS role
         FROM users
        WHERE id = $1::uuid
        LIMIT 1`,
      [userId]
    );
    const role = result.rows[0]?.role;
    if (!role) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
    return role;
  }

  private async requestForAccess(requestId: string): Promise<MaintenanceRow> {
    const result = await this.db.query<MaintenanceRow>(
      `SELECT id::text, pg_property_id::text, assignment_id::text, created_by_user_id::text,
              category, description, photo_paths, status::text, priority,
              closed_at, created_at, updated_at
         FROM pg_maintenance_requests
        WHERE id = $1::uuid
        LIMIT 1`,
      [requestId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException({
        code: "maintenance_request_not_found",
        message: "Maintenance request not found"
      });
    }
    return row;
  }

  private async assertTenantCanAccessRequest(userId: string, requestId: string): Promise<void> {
    const residence = await this.currentResidenceAssignment(userId);
    const result = await this.db.query<{ id: string }>(
      `SELECT r.id::text
         FROM pg_maintenance_requests r
        WHERE r.id = $1::uuid
          AND r.assignment_id = $2::uuid
        LIMIT 1`,
      [requestId, residence.assignment_id]
    );
    if (!result.rows[0]) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
  }

  private async withComments(rows: MaintenanceRow[]): Promise<PgMaintenanceRequest[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const comments = await this.db.query<CommentRow>(
      `SELECT id::text, request_id::text, author_user_id::text, author_role,
              body, attachments, created_at
         FROM pg_maintenance_comments
        WHERE request_id = ANY($1::uuid[])
        ORDER BY created_at ASC, id ASC`,
      [ids]
    );
    const byRequest = new Map<string, PgMaintenanceComment[]>();
    for (const row of comments.rows) {
      const list = byRequest.get(row.request_id) ?? [];
      list.push(toComment(row));
      byRequest.set(row.request_id, list);
    }
    return rows.map((row) => toRequest(row, byRequest.get(row.id) ?? []));
  }

  async create(
    callerUserId: string,
    _propertyId: string,
    _assignmentId: string,
    input: PgMaintenanceCreateInput
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const category = cleanRequired(input.category, "maintenance_category_required");
    const description = cleanRequired(input.description, "maintenance_description_required");
    const photoPaths = this.validateStringArray(input.photo_paths, "invalid_maintenance_photos");
    if (photoPaths.length > 0) {
      throw new BadRequestException({ code: "maintenance_photos_not_supported" });
    }
    const priority = input.priority?.trim() || null;
    const residence = await this.currentResidenceAssignment(callerUserId);

    // TODO(phase-5-photo): add property-scoped maintenance photo presign under pg-maintenance/<propertyId>/.
    const result = await this.db.query<MaintenanceRow>(
      `INSERT INTO pg_maintenance_requests
         (pg_property_id, assignment_id, created_by_user_id, category, description, photo_paths, priority)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7)
       RETURNING id::text, pg_property_id::text, assignment_id::text, created_by_user_id::text,
                 category, description, photo_paths, status::text, priority,
                 closed_at, created_at, updated_at`,
      [
        residence.property_id,
        residence.assignment_id,
        callerUserId,
        category,
        description,
        JSON.stringify(photoPaths),
        priority
      ]
    );
    return toRequest(result.rows[0]);
  }

  async listForProperty(
    operatorId: string,
    propertyId: string,
    filters: PgMaintenanceListFilters = {}
  ): Promise<PgMaintenanceRequest[]> {
    if (!this.db.isEnabled()) return [];
    await this.assertManagedOwnership(operatorId, propertyId);
    const result = await this.db.query<MaintenanceRow>(
      `SELECT id::text, pg_property_id::text, assignment_id::text, created_by_user_id::text,
              category, description, photo_paths, status::text, priority,
              closed_at, created_at, updated_at
         FROM pg_maintenance_requests
        WHERE pg_property_id = $1::uuid
          AND ($2::text IS NULL OR status::text = $2)
        ORDER BY created_at DESC, id DESC`,
      [propertyId, filters.status ?? null]
    );
    return this.withComments(result.rows);
  }

  async listForBed(
    operatorId: string,
    propertyId: string,
    bedId: string
  ): Promise<PgMaintenanceRequest[]> {
    if (!this.db.isEnabled()) return [];
    await this.assertManagedOwnership(operatorId, propertyId);
    const result = await this.db.query<MaintenanceRow>(
      `SELECT r.id::text, r.pg_property_id::text, r.assignment_id::text,
              r.created_by_user_id::text, r.category, r.description, r.photo_paths,
              r.status::text, r.priority, r.closed_at, r.created_at, r.updated_at
         FROM pg_maintenance_requests r
         JOIN pg_bed_assignments a ON a.id = r.assignment_id
        WHERE r.pg_property_id = $1::uuid
          AND a.pg_property_id = $1::uuid
          AND a.bed_id = $2::uuid
        ORDER BY r.created_at DESC, r.id DESC`,
      [propertyId, bedId]
    );
    return this.withComments(result.rows);
  }

  async listForResidence(tenantUserId: string): Promise<PgMaintenanceRequest[]> {
    if (!this.db.isEnabled()) return [];
    const residence = await this.currentResidenceAssignment(tenantUserId);
    const result = await this.db.query<MaintenanceRow>(
      `SELECT r.id::text, r.pg_property_id::text, r.assignment_id::text,
              r.created_by_user_id::text, r.category, r.description, r.photo_paths,
              r.status::text, r.priority, r.closed_at, r.created_at, r.updated_at
         FROM pg_maintenance_requests r
        WHERE r.assignment_id = $1::uuid
        ORDER BY r.created_at DESC, r.id DESC`,
      [residence.assignment_id]
    );
    return this.withComments(result.rows);
  }

  async summaryForBed(
    operatorId: string,
    propertyId: string,
    bedId: string
  ): Promise<PgMaintenanceSummary> {
    if (!this.db.isEnabled()) return { open_items: 0, overdue_items: 0 };
    await this.assertManagedOwnership(operatorId, propertyId);
    const result = await this.db.query<{ open_items: number | string }>(
      `SELECT COUNT(*) FILTER (WHERE r.status = ANY($3::pg_maintenance_status[])) AS open_items
         FROM pg_maintenance_requests r
         JOIN pg_bed_assignments a ON a.id = r.assignment_id
        WHERE r.pg_property_id = $1::uuid
          AND a.pg_property_id = $1::uuid
          AND a.bed_id = $2::uuid`,
      [propertyId, bedId, OPEN_MAINTENANCE_STATUSES]
    );
    return { open_items: Number(result.rows[0]?.open_items ?? 0), overdue_items: 0 };
  }

  async updateStatus(
    operatorId: string,
    requestId: string,
    status: PgMaintenanceStatus,
    expectedPropertyId?: string
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const existing = await client.query<MaintenanceRow>(
        `SELECT id::text, pg_property_id::text, assignment_id::text, created_by_user_id::text,
                category, description, photo_paths, status::text, priority,
                closed_at, created_at, updated_at
           FROM pg_maintenance_requests
          WHERE id = $1::uuid
          FOR UPDATE`,
        [requestId]
      );
      const request = existing.rows[0];
      if (!request) {
        throw new NotFoundException({
          code: "maintenance_request_not_found",
          message: "Maintenance request not found"
        });
      }
      if (expectedPropertyId && request.pg_property_id !== expectedPropertyId) {
        throw new NotFoundException({
          code: "maintenance_request_not_found",
          message: "Maintenance request not found"
        });
      }
      const ownership = await client.query<{ id: string }>(
        `SELECT id::text
           FROM pg_properties
          WHERE id = $1::uuid
            AND operator_id = $2::uuid
            AND manage_enabled = true
          LIMIT 1`,
        [request.pg_property_id, operatorId]
      );
      if (!ownership.rows[0]) {
        throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
      }
      if (!STATUS_TRANSITIONS[request.status].includes(status)) {
        throw new ConflictException({
          code: "invalid_maintenance_transition",
          from_status: request.status,
          to_status: status
        });
      }
      const result = await client.query<MaintenanceRow>(
        `UPDATE pg_maintenance_requests
            SET status = $2::pg_maintenance_status,
                closed_at = CASE WHEN $2::text IN ('closed', 'cancelled') THEN now() ELSE closed_at END
          WHERE id = $1::uuid
            AND status = $3::pg_maintenance_status
          RETURNING id::text, pg_property_id::text, assignment_id::text, created_by_user_id::text,
                    category, description, photo_paths, status::text, priority,
                    closed_at, created_at, updated_at`,
        [requestId, status, request.status]
      );
      if (!result.rows[0]) {
        throw new ConflictException({
          code: "invalid_maintenance_transition",
          from_status: request.status,
          to_status: status
        });
      }
      await client.query("COMMIT");
      return toRequest(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async addComment(
    callerUserId: string,
    requestId: string,
    body: string,
    attachmentsInput?: string[],
    expectedPropertyId?: string
  ): Promise<PgMaintenanceComment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const commentBody = cleanRequired(body, "maintenance_comment_required");
    const attachments = this.validateStringArray(
      attachmentsInput,
      "invalid_maintenance_attachments"
    );
    const role = await this.callerRole(callerUserId);
    const request = await this.requestForAccess(requestId);
    if (expectedPropertyId && request.pg_property_id !== expectedPropertyId) {
      throw new NotFoundException({
        code: "maintenance_request_not_found",
        message: "Maintenance request not found"
      });
    }

    if (role === "pg_operator") {
      await this.assertManagedOwnership(callerUserId, request.pg_property_id);
    } else if (role === "tenant") {
      await this.assertTenantCanAccessRequest(callerUserId, requestId);
    } else if (role !== "admin") {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }

    const result = await this.db.query<CommentRow>(
      `INSERT INTO pg_maintenance_comments
         (request_id, author_user_id, author_role, body, attachments)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
       RETURNING id::text, request_id::text, author_user_id::text, author_role,
                 body, attachments, created_at`,
      [requestId, callerUserId, role, commentBody, JSON.stringify(attachments)]
    );
    return toComment(result.rows[0]);
  }
}
