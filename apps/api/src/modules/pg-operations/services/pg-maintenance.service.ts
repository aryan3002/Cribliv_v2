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
  PgMaintenanceComment,
  PgMaintenanceCompletePhotoInput,
  PgMaintenanceCreateInput,
  PgMaintenanceRequest,
  PgMaintenanceStatus,
  PgMaintenanceSummary,
  PgMaintenancePresignFileInput,
  PgMaintenancePresignResponse
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import type { Role } from "../../../common/types";
import { AzureBlobPhotoStorageService } from "../../owner/azure-blob-photo-storage.service";

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
  property_name?: string | null;
  room_id?: string | null;
  room_number?: string | null;
  room_label?: string | null;
  floor?: number | null;
  bed_id?: string | null;
  bed_label?: string | null;
  tenant_name?: string | null;
  tenant_phone_e164?: string | null;
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

const MAX_MAINTENANCE_PHOTOS = 6;

export const PG_MAINTENANCE_STATUSES = Object.keys(
  STATUS_TRANSITIONS
) as readonly PgMaintenanceStatus[];

export function isPgMaintenanceStatus(value: unknown): value is PgMaintenanceStatus {
  return (
    typeof value === "string" && (PG_MAINTENANCE_STATUSES as readonly string[]).includes(value)
  );
}

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

function toPhotoUrl(path: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.replace(/^\/+/, "");
  return baseUrl ? `${baseUrl}/${normalized}` : normalized;
}

function toComment(row: CommentRow, photoBaseUrl = ""): PgMaintenanceComment {
  const attachments = stringArray(row.attachments);
  return {
    id: row.id,
    request_id: row.request_id,
    author_user_id: row.author_user_id,
    author_role: row.author_role,
    body: row.body,
    attachments,
    attachment_urls: attachments.map((path) => toPhotoUrl(path, photoBaseUrl)),
    created_at: toIso(row.created_at)
  };
}

function toLocation(row: MaintenanceRow): PgMaintenanceRequest["location"] {
  if (!row.bed_id && !row.room_id && !row.assignment_id) return null;
  return {
    property_id: row.pg_property_id,
    property_name: row.property_name ?? null,
    room_id: row.room_id ?? null,
    room_number: row.room_number ?? null,
    room_label: row.room_label ?? null,
    floor: row.floor ?? null,
    bed_id: row.bed_id ?? null,
    bed_label: row.bed_label ?? null,
    tenant_name: row.tenant_name ?? null,
    tenant_phone_e164: row.tenant_phone_e164 ?? null
  };
}

function toRequest(
  row: MaintenanceRow,
  comments: PgMaintenanceComment[] = [],
  photoBaseUrl = ""
): PgMaintenanceRequest {
  const photoPaths = stringArray(row.photo_paths);
  return {
    id: row.id,
    pg_property_id: row.pg_property_id,
    assignment_id: row.assignment_id,
    created_by_user_id: row.created_by_user_id,
    category: row.category,
    description: row.description,
    photo_paths: photoPaths,
    photo_urls: photoPaths.map((path) => toPhotoUrl(path, photoBaseUrl)),
    status: row.status,
    priority: row.priority,
    closed_at: toIsoNullable(row.closed_at),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    comments,
    location: toLocation(row)
  };
}

function cleanRequired(value: unknown, code: string): string {
  if (typeof value !== "string") throw new BadRequestException({ code });
  const cleaned = value.trim();
  if (!cleaned) throw new BadRequestException({ code });
  return cleaned;
}

function cleanOptional(value: unknown, code: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException({ code });
  const cleaned = value.trim();
  return cleaned || null;
}

@Injectable()
export class PgMaintenanceService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Optional()
    @Inject(AzureBlobPhotoStorageService)
    private readonly photoStorage?: AzureBlobPhotoStorageService
  ) {}

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

  private photoBaseUrl(): string {
    return this.photoStorage?.getPhotoPublicBaseUrl() ?? "";
  }

  private requirePhotoStorage(): AzureBlobPhotoStorageService {
    if (!this.photoStorage) {
      throw new BadRequestException({
        code: "photo_storage_not_configured",
        message: "Photo storage is not configured"
      });
    }
    return this.photoStorage;
  }

  private validatePhotoFiles(files: PgMaintenancePresignFileInput[] | undefined) {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException({
        code: "validation_error",
        message: "At least one file is required"
      });
    }
    if (files.length > MAX_MAINTENANCE_PHOTOS) {
      throw new BadRequestException({
        code: "validation_error",
        message: `Maximum ${MAX_MAINTENANCE_PHOTOS} files per request`
      });
    }

    const seen = new Set<string>();
    return files.map((file) => {
      const clientUploadId = cleanRequired(file?.client_upload_id, "client_upload_id_required");
      if (seen.has(clientUploadId)) {
        throw new BadRequestException({
          code: "duplicate_client_upload_id",
          message: `Duplicate client_upload_id: ${clientUploadId}`
        });
      }
      seen.add(clientUploadId);
      const contentType = cleanRequired(file?.content_type, "content_type_required");
      const sizeBytes = Number(file?.size_bytes);
      this.requirePhotoStorage().validatePresignRequest(contentType, sizeBytes);
      return { clientUploadId, contentType, sizeBytes };
    });
  }

  private validateCompletedPhotos(photos: PgMaintenanceCompletePhotoInput[] | undefined) {
    if (!Array.isArray(photos) || photos.length === 0) {
      throw new BadRequestException({
        code: "validation_error",
        message: "At least one photo is required"
      });
    }
    if (photos.length > MAX_MAINTENANCE_PHOTOS) {
      throw new BadRequestException({
        code: "validation_error",
        message: `Maximum ${MAX_MAINTENANCE_PHOTOS} photos per request`
      });
    }

    const seen = new Set<string>();
    return photos.map((photo) => {
      const clientUploadId = cleanRequired(photo?.client_upload_id, "client_upload_id_required");
      if (seen.has(clientUploadId)) {
        throw new BadRequestException({
          code: "duplicate_client_upload_id",
          message: `Duplicate client_upload_id: ${clientUploadId}`
        });
      }
      seen.add(clientUploadId);
      return {
        clientUploadId,
        blobPath: cleanRequired(photo?.blob_path, "blob_path_required")
      };
    });
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
      `SELECT r.id::text, r.pg_property_id::text, r.assignment_id::text, r.created_by_user_id::text,
              r.category, r.description, r.photo_paths, r.status::text, r.priority,
              r.closed_at, r.created_at, r.updated_at,
              p.display_name AS property_name,
              rm.id::text AS room_id, rm.room_number, rm.display_label AS room_label, rm.floor,
              b.id::text AS bed_id, b.bed_label,
              a.occupant_name AS tenant_name, a.occupant_phone_e164 AS tenant_phone_e164
         FROM pg_maintenance_requests r
         LEFT JOIN pg_properties p ON p.id = r.pg_property_id
         LEFT JOIN pg_bed_assignments a ON a.id = r.assignment_id
         LEFT JOIN pg_beds b ON b.id = a.bed_id
         LEFT JOIN pg_rooms rm ON rm.id = b.room_id
        WHERE r.id = $1::uuid
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
    const photoBaseUrl = this.photoBaseUrl();
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
      list.push(toComment(row, photoBaseUrl));
      byRequest.set(row.request_id, list);
    }
    return rows.map((row) => toRequest(row, byRequest.get(row.id) ?? [], photoBaseUrl));
  }

  async create(
    callerUserId: string,
    _propertyId: string,
    _assignmentId: string,
    input: Partial<PgMaintenanceCreateInput> | undefined
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const payload = input ?? {};
    const category = cleanRequired(payload.category, "maintenance_category_required");
    const description = cleanRequired(payload.description, "maintenance_description_required");
    const photoPaths = this.validateStringArray(payload.photo_paths, "invalid_maintenance_photos");
    if (photoPaths.length > 0) {
      throw new BadRequestException({ code: "maintenance_photos_not_supported" });
    }
    const priority = cleanOptional(payload.priority, "invalid_maintenance_priority");
    const residence = await this.currentResidenceAssignment(callerUserId);

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_maintenance_requests
         (pg_property_id, assignment_id, created_by_user_id, category, description, photo_paths, priority)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6::jsonb, $7)
       RETURNING id::text`,
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
    const requests = await this.withComments([await this.requestForAccess(result.rows[0].id)]);
    return requests[0];
  }

  async listForProperty(
    operatorId: string,
    propertyId: string,
    filters: { status?: unknown } = {}
  ): Promise<PgMaintenanceRequest[]> {
    if (!this.db.isEnabled()) return [];
    if (filters.status !== undefined && !isPgMaintenanceStatus(filters.status)) {
      throw new BadRequestException({ code: "invalid_maintenance_status" });
    }
    await this.assertManagedOwnership(operatorId, propertyId);
    const result = await this.db.query<MaintenanceRow>(
      `SELECT r.id::text, r.pg_property_id::text, r.assignment_id::text, r.created_by_user_id::text,
              r.category, r.description, r.photo_paths, r.status::text, r.priority,
              r.closed_at, r.created_at, r.updated_at,
              p.display_name AS property_name,
              rm.id::text AS room_id, rm.room_number, rm.display_label AS room_label, rm.floor,
              b.id::text AS bed_id, b.bed_label,
              a.occupant_name AS tenant_name, a.occupant_phone_e164 AS tenant_phone_e164
         FROM pg_maintenance_requests r
         LEFT JOIN pg_properties p ON p.id = r.pg_property_id
         LEFT JOIN pg_bed_assignments a ON a.id = r.assignment_id
         LEFT JOIN pg_beds b ON b.id = a.bed_id
         LEFT JOIN pg_rooms rm ON rm.id = b.room_id
        WHERE r.pg_property_id = $1::uuid
          AND ($2::text IS NULL OR r.status::text = $2)
        ORDER BY r.created_at DESC, r.id DESC`,
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
              r.status::text, r.priority, r.closed_at, r.created_at, r.updated_at,
              p.display_name AS property_name,
              rm.id::text AS room_id, rm.room_number, rm.display_label AS room_label, rm.floor,
              b.id::text AS bed_id, b.bed_label,
              a.occupant_name AS tenant_name, a.occupant_phone_e164 AS tenant_phone_e164
         FROM pg_maintenance_requests r
         LEFT JOIN pg_properties p ON p.id = r.pg_property_id
         JOIN pg_bed_assignments a ON a.id = r.assignment_id
         LEFT JOIN pg_beds b ON b.id = a.bed_id
         LEFT JOIN pg_rooms rm ON rm.id = b.room_id
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
              r.status::text, r.priority, r.closed_at, r.created_at, r.updated_at,
              p.display_name AS property_name,
              rm.id::text AS room_id, rm.room_number, rm.display_label AS room_label, rm.floor,
              b.id::text AS bed_id, b.bed_label,
              a.occupant_name AS tenant_name, a.occupant_phone_e164 AS tenant_phone_e164
         FROM pg_maintenance_requests r
         LEFT JOIN pg_properties p ON p.id = r.pg_property_id
         LEFT JOIN pg_bed_assignments a ON a.id = r.assignment_id
         LEFT JOIN pg_beds b ON b.id = a.bed_id
         LEFT JOIN pg_rooms rm ON rm.id = b.room_id
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
    status: unknown,
    expectedPropertyId?: string
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    if (!isPgMaintenanceStatus(status)) {
      throw new BadRequestException({ code: "invalid_maintenance_status" });
    }
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
      const requests = await this.withComments([await this.requestForAccess(result.rows[0].id)]);
      return requests[0];
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
    body: unknown,
    attachmentsInput?: unknown,
    expectedPropertyId?: string
  ): Promise<PgMaintenanceComment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const commentBody = cleanOptional(body, "invalid_maintenance_comment") ?? "";
    const attachments = this.validateStringArray(
      attachmentsInput,
      "invalid_maintenance_attachments"
    );
    if (!commentBody && attachments.length === 0) {
      throw new BadRequestException({ code: "maintenance_comment_required" });
    }
    if (attachments.length > MAX_MAINTENANCE_PHOTOS) {
      throw new BadRequestException({
        code: "too_many_maintenance_attachments",
        message: `Maximum ${MAX_MAINTENANCE_PHOTOS} attachments per comment`
      });
    }
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

    if (attachments.length > 0) {
      await Promise.all(
        attachments.map((path) =>
          this.requirePhotoStorage().validateMaintenanceUploadedBlob(
            request.pg_property_id,
            request.id,
            path
          )
        )
      );
    }

    const result = await this.db.query<CommentRow>(
      `INSERT INTO pg_maintenance_comments
         (request_id, author_user_id, author_role, body, attachments)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb)
       RETURNING id::text, request_id::text, author_user_id::text, author_role,
                 body, attachments, created_at`,
      [requestId, callerUserId, role, commentBody, JSON.stringify(attachments)]
    );
    return toComment(result.rows[0], this.photoBaseUrl());
  }

  async presignPhotos(
    callerUserId: string,
    requestId: string,
    files: PgMaintenancePresignFileInput[] | undefined,
    expectedPropertyId?: string
  ): Promise<PgMaintenancePresignResponse> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const storage = this.requirePhotoStorage();
    const request = await this.requestForAccess(requestId);
    await this.assertCallerCanAccessRequest(callerUserId, request, expectedPropertyId);
    const validated = this.validatePhotoFiles(files);

    return {
      uploads: validated.map((file) => {
        const target = storage.createMaintenanceUploadTarget({
          propertyId: request.pg_property_id,
          requestId,
          clientUploadId: file.clientUploadId,
          contentType: file.contentType
        });
        return {
          client_upload_id: file.clientUploadId,
          upload_url: target.uploadUrl,
          blob_path: target.blobPath,
          expires_at: target.expiresAt
        };
      })
    };
  }

  async completeRequestPhotos(
    callerUserId: string,
    requestId: string,
    photos: PgMaintenanceCompletePhotoInput[] | undefined,
    expectedPropertyId?: string
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const request = await this.requestForAccess(requestId);
    await this.assertCallerCanAccessRequest(callerUserId, request, expectedPropertyId);
    const validated = this.validateCompletedPhotos(photos);
    const storage = this.requirePhotoStorage();

    await Promise.all(
      validated.map((photo) =>
        storage.validateMaintenanceUploadedBlob(request.pg_property_id, request.id, photo.blobPath)
      )
    );

    const client = await this.db.getClient();
    try {
      await client.query("BEGIN");
      const current = await client.query<{ photo_paths: unknown }>(
        `SELECT photo_paths
           FROM pg_maintenance_requests
          WHERE id = $1::uuid
          FOR UPDATE`,
        [requestId]
      );
      if (!current.rows[0]) {
        throw new NotFoundException({
          code: "maintenance_request_not_found",
          message: "Maintenance request not found"
        });
      }
      const existing = stringArray(current.rows[0].photo_paths);
      const merged = [...existing];
      for (const photo of validated) {
        if (!merged.includes(photo.blobPath)) merged.push(photo.blobPath);
      }
      if (merged.length > MAX_MAINTENANCE_PHOTOS) {
        throw new BadRequestException({
          code: "too_many_maintenance_photos",
          message: `Maximum ${MAX_MAINTENANCE_PHOTOS} photos per ticket`
        });
      }

      await client.query(
        `UPDATE pg_maintenance_requests
            SET photo_paths = $2::jsonb,
                updated_at = now()
          WHERE id = $1::uuid`,
        [requestId, JSON.stringify(merged)]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    const requests = await this.withComments([await this.requestForAccess(requestId)]);
    return requests[0];
  }

  private async assertCallerCanAccessRequest(
    callerUserId: string,
    request: MaintenanceRow,
    expectedPropertyId?: string
  ): Promise<void> {
    if (expectedPropertyId && request.pg_property_id !== expectedPropertyId) {
      throw new NotFoundException({
        code: "maintenance_request_not_found",
        message: "Maintenance request not found"
      });
    }
    const role = await this.callerRole(callerUserId);
    if (role === "pg_operator") {
      await this.assertManagedOwnership(callerUserId, request.pg_property_id);
    } else if (role === "tenant") {
      await this.assertTenantCanAccessRequest(callerUserId, request.id);
    } else if (role !== "admin") {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
  }
}
