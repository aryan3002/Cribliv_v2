import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  PgManageRequest,
  PgManageRequestState,
  PgManageRequestStatus
} from "@cribliv/shared-types";
import { DatabaseService } from "../../../common/database.service";

type RequestRow = Omit<PgManageRequest, "created_at" | "updated_at"> & {
  created_at: Date | string;
  updated_at: Date | string;
};

type PropertyState = {
  manage_enabled: boolean;
  layout_status: string | null;
};

export type PgManageRequestAdminItem = PgManageRequest & {
  listing_title: string;
  operator_name: string | null;
  operator_phone: string | null;
};

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toManageRequest(row: RequestRow): PgManageRequest {
  return {
    id: row.id,
    listing_id: row.listing_id,
    pg_property_id: row.pg_property_id,
    operator_user_id: row.operator_user_id,
    status: row.status as PgManageRequestStatus,
    requested_reason: row.requested_reason,
    decided_by: row.decided_by,
    decided_at: row.decided_at,
    decision_notes: row.decision_notes,
    payment_order_id: row.payment_order_id,
    metadata: row.metadata ?? {},
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at)
  };
}

function decisionAuditState(request: RequestRow, property?: PropertyState) {
  return {
    request_id: request.id,
    listing_id: request.listing_id,
    pg_property_id: request.pg_property_id,
    status: request.status,
    manage_enabled: property?.manage_enabled ?? null,
    layout_status: property?.layout_status ?? null
  };
}

@Injectable()
export class PgManageRequestService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private requireDatabase(): void {
    if (!this.db.isEnabled()) {
      throw new ServiceUnavailableException({
        code: "operations_requires_db",
        message: "PG operations require a database"
      });
    }
  }

  async create(operatorId: string, listingId: string, reason?: string): Promise<PgManageRequest> {
    this.requireDatabase();

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const listing = await client.query<{
        operator_user_id: string;
        pg_property_id: string | null;
      }>(
        `SELECT operator_user_id::text, pg_property_id::text
           FROM pg_listings
          WHERE id = $1::uuid
          LIMIT 1
          FOR UPDATE`,
        [listingId]
      );
      const listingRow = listing.rows[0];
      if (!listingRow || listingRow.operator_user_id !== operatorId) {
        throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
      }
      if (!listingRow.pg_property_id) {
        throw new ConflictException({ code: "manage_request_property_required" });
      }

      const approved = await client.query<{ id: string }>(
        `SELECT id::text
           FROM pg_manage_requests
          WHERE listing_id = $1::uuid
            AND status = 'approved'
          LIMIT 1`,
        [listingId]
      );
      if (approved.rows[0]) {
        throw new ConflictException({ code: "manage_request_exists" });
      }

      const inserted = await client.query<RequestRow>(
        `INSERT INTO pg_manage_requests
           (listing_id, pg_property_id, operator_user_id, status, requested_reason)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'pending', $4)
         RETURNING *`,
        [listingId, listingRow.pg_property_id, operatorId, reason?.trim() || null]
      );
      await client.query("COMMIT");
      return toManageRequest(inserted.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException({ code: "manage_request_exists" });
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async getState(operatorId: string, listingId: string): Promise<PgManageRequestState> {
    if (!this.db.isEnabled()) return { status: "none" };

    const result = await this.db.query<RequestRow & { layout_status: string | null }>(
      `SELECT r.*, p.layout_status
         FROM pg_manage_requests r
         JOIN pg_listings l ON l.id = r.listing_id
         LEFT JOIN pg_properties p ON p.id = r.pg_property_id
        WHERE r.listing_id = $1::uuid
          AND l.operator_user_id = $2::uuid
        ORDER BY (r.status = 'approved') DESC, r.created_at DESC
        LIMIT 1`,
      [listingId, operatorId]
    );
    const row = result.rows[0];
    if (!row) return { status: "none" };

    return {
      status: row.status as PgManageRequestStatus,
      request: toManageRequest(row),
      managed_property_id: row.pg_property_id ?? undefined,
      layout_status: row.layout_status ?? undefined
    };
  }

  async listForAdmin(status?: string): Promise<PgManageRequestAdminItem[]> {
    if (!this.db.isEnabled()) return [];

    const result = await this.db.query<
      RequestRow & {
        listing_title: string;
        operator_name: string | null;
        operator_phone: string | null;
      }
    >(
      `SELECT r.*, l.title AS listing_title, u.full_name AS operator_name, u.phone_e164 AS operator_phone
         FROM pg_manage_requests r
         JOIN pg_listings l ON l.id = r.listing_id
         JOIN users u ON u.id = r.operator_user_id
        WHERE ($1::text IS NULL OR r.status::text = $1)
        ORDER BY r.created_at DESC`,
      [status ?? null]
    );
    return result.rows.map((row) => ({
      ...toManageRequest(row),
      listing_title: row.listing_title,
      operator_name: row.operator_name,
      operator_phone: row.operator_phone
    }));
  }

  private async auditDecision(
    client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
    adminId: string,
    request: RequestRow,
    action: "approve" | "reject",
    reason: string | null,
    before: unknown,
    after: unknown
  ): Promise<void> {
    await client.query(
      `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, reason, before_state, after_state)
       VALUES ($1::uuid, 'listing'::admin_target_type, $2::uuid, $3::admin_action_type, $4, $5::jsonb, $6::jsonb)`,
      [adminId, request.listing_id, action, reason, JSON.stringify(before), JSON.stringify(after)]
    );
  }

  // PAYMENT HOOK (Phase 6): create pg_manage_payment_orders row here and gate approval on webhook 'paid'

  async approve(adminId: string, requestId: string, notes?: string): Promise<PgManageRequest> {
    this.requireDatabase();

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const existing = await client.query<RequestRow>(
        `SELECT r.*
           FROM pg_manage_requests r
           JOIN pg_listings l ON l.id = r.listing_id
          WHERE r.id = $1::uuid
          FOR UPDATE OF r, l`,
        [requestId]
      );
      const request = existing.rows[0];
      if (!request) {
        throw new NotFoundException({
          code: "manage_request_not_found",
          message: "Manage request not found"
        });
      }
      if (request.status === "approved") {
        await client.query("COMMIT");
        return toManageRequest(request);
      }
      if (request.status !== "pending") {
        throw new ConflictException({ code: "manage_request_not_pending" });
      }

      const propertyBefore = await client.query<PropertyState>(
        `SELECT manage_enabled, layout_status
           FROM pg_properties
          WHERE id = $1::uuid
          FOR UPDATE`,
        [request.pg_property_id]
      );
      if (!propertyBefore.rows[0]) {
        throw new ConflictException({ code: "manage_request_property_not_found" });
      }

      const approved = await client.query<RequestRow>(
        `UPDATE pg_manage_requests
            SET status = 'approved', decided_by = $2::uuid, decided_at = now(), decision_notes = $3
          WHERE id = $1::uuid
          RETURNING *`,
        [requestId, adminId, notes?.trim() || null]
      );
      const propertyUpdated = await client.query<PropertyState>(
        `UPDATE pg_properties
            SET manage_enabled = true, layout_status = 'needs_setup', managed_activated_at = now()
          WHERE id = $1::uuid
          RETURNING manage_enabled, layout_status`,
        [request.pg_property_id]
      );
      if (propertyUpdated.rowCount !== 1) {
        throw new ConflictException({ code: "manage_request_property_not_found" });
      }
      const decisionNotes = notes?.trim() || null;
      await this.auditDecision(
        client,
        adminId,
        request,
        "approve",
        decisionNotes,
        decisionAuditState(request, propertyBefore.rows[0]),
        decisionAuditState(approved.rows[0], propertyUpdated.rows[0])
      );
      await client.query("COMMIT");
      return toManageRequest(approved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async reject(adminId: string, requestId: string, notes?: string): Promise<PgManageRequest> {
    this.requireDatabase();

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const existing = await client.query<RequestRow>(
        `SELECT * FROM pg_manage_requests WHERE id = $1::uuid FOR UPDATE`,
        [requestId]
      );
      const request = existing.rows[0];
      if (!request) {
        throw new NotFoundException({
          code: "manage_request_not_found",
          message: "Manage request not found"
        });
      }
      if (request.status !== "pending") {
        throw new ConflictException({ code: "manage_request_not_pending" });
      }

      const rejected = await client.query<RequestRow>(
        `UPDATE pg_manage_requests
            SET status = 'rejected', decided_by = $2::uuid, decided_at = now(), decision_notes = $3
          WHERE id = $1::uuid
          RETURNING *`,
        [requestId, adminId, notes?.trim() || null]
      );
      const decisionNotes = notes?.trim() || null;
      await this.auditDecision(
        client,
        adminId,
        request,
        "reject",
        decisionNotes,
        decisionAuditState(request),
        decisionAuditState(rejected.rows[0])
      );
      await client.query("COMMIT");
      return toManageRequest(rejected.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
