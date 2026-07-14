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
  PgMaintenanceCategory,
  PgMaintenanceCommonArea,
  PgMaintenanceCompletePhotoInput,
  PgMaintenanceCreateInput,
  PgMaintenanceEventType,
  PgMaintenanceEventVisibility,
  PgMaintenanceInternalNoteResponse,
  PgMaintenanceLocationKind,
  PgMaintenanceLocationSnapshot,
  PgMaintenanceAnalytics,
  PgMaintenancePriority,
  PgMaintenancePriorityOverrideInput,
  PgMaintenancePrioritySource,
  PgMaintenanceQueueFilters,
  PgMaintenanceQueuePage,
  PgMaintenanceRequest,
  PgMaintenanceResolutionInput,
  PgMaintenanceSlaHours,
  PgMaintenanceStatus,
  PgMaintenanceSummary,
  PgMaintenancePresignFileInput,
  PgMaintenancePresignResponse,
  PgMaintenanceTimelineEvent
} from "@cribliv/shared-types";

import { DatabaseService } from "../../../common/database.service";
import { transaction } from "../../../common/transaction";
import type { Role } from "../../../common/types";
import { AzureBlobPhotoStorageService } from "../../owner/azure-blob-photo-storage.service";

type MaintenanceRow = {
  id: string;
  pg_property_id: string;
  assignment_id: string | null;
  created_by_user_id: string | null;
  category: string;
  category_slug: string;
  category_label_snapshot: string;
  description: string;
  photo_paths: unknown;
  status: PgMaintenanceStatus;
  priority: PgMaintenancePriority;
  priority_source: PgMaintenancePrioritySource;
  priority_overridden_by: string | null;
  priority_overridden_at: Date | string | null;
  priority_override_reason: string | null;
  sla_hours: number | string;
  sla_due_at: Date | string;
  is_overdue: boolean;
  closed_at: Date | string | null;
  resolved_at: Date | string | null;
  resolution_note: string | null;
  resolution_source: string | null;
  fix_photo_paths: unknown;
  resolution_cost_paise: number | string | null;
  chargeable_damage: boolean;
  auto_close_after: Date | string | null;
  location_kind: PgMaintenanceLocationKind;
  location_room_id: string | null;
  location_bed_id: string | null;
  location_floor: number | null;
  common_area: PgMaintenanceCommonArea | null;
  location_detail: string | null;
  location_snapshot: unknown;
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

type CategoryRow = {
  slug: string;
  display_name: string;
  default_priority: PgMaintenancePriority;
  active: boolean;
  sort_order: number;
};

type ResidenceLocationRow = {
  property_name: string;
  total_floors: number | null;
  room_id: string | null;
  room_number: string | null;
  room_label: string | null;
  floor: number | null;
  bed_id: string | null;
  bed_label: string | null;
};

type ValidatedLocation = {
  kind: PgMaintenanceLocationKind;
  roomId: string | null;
  bedId: string | null;
  floor: number | null;
  commonArea: PgMaintenanceCommonArea | null;
  detail: string | null;
  snapshot: PgMaintenanceLocationSnapshot;
};

type MaintenanceCreatePayload = Partial<PgMaintenanceCreateInput> & {
  category_slug?: unknown;
  location?: unknown;
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

type TimelineEventRow = {
  id: string;
  request_id: string;
  event_type: PgMaintenanceEventType;
  visibility: PgMaintenanceEventVisibility;
  actor_user_id: string | null;
  actor_role: PgMaintenanceTimelineEvent["actor_role"];
  from_status: PgMaintenanceStatus | null;
  to_status: PgMaintenanceStatus | null;
  payload: unknown;
  created_at: Date | string;
};

type ResidenceAssignmentRow = {
  assignment_id: string;
  property_id: string;
};

type MaintenanceResidenceScope = "current" | "history" | "all";

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PG_MAINTENANCE_LOCATION_KINDS: readonly PgMaintenanceLocationKind[] = [
  "bed",
  "room",
  "floor",
  "common_area",
  "property_wide",
  "other"
];

const PG_MAINTENANCE_COMMON_AREAS: readonly PgMaintenanceCommonArea[] = [
  "kitchen",
  "common_bathroom",
  "lift",
  "stairs",
  "corridor",
  "terrace",
  "laundry",
  "parking",
  "reception",
  "mess_food_area",
  "water_tank_motor",
  "wifi_router",
  "security_cctv",
  "other"
];

const PG_MAINTENANCE_PRIORITIES: readonly PgMaintenancePriority[] = [
  "emergency",
  "high",
  "normal",
  "low"
];

const MAINTENANCE_REQUEST_SELECT = `
  r.id::text, r.pg_property_id::text, r.assignment_id::text, r.created_by_user_id::text,
  r.category, r.category_slug, r.category_label_snapshot, r.description, r.photo_paths,
  r.status::text, r.priority::text AS priority, r.priority_source,
  r.priority_overridden_by::text, r.priority_overridden_at, r.priority_override_reason,
  r.sla_hours, r.sla_due_at,
  (r.sla_due_at < now() AND r.status::text NOT IN ('closed', 'cancelled')) AS is_overdue,
  r.closed_at, r.resolved_at, r.resolution_note, r.resolution_source,
  r.fix_photo_paths, r.resolution_cost_paise, r.chargeable_damage, r.auto_close_after,
  r.location_kind::text AS location_kind, r.room_id::text AS location_room_id,
  r.bed_id::text AS location_bed_id, r.floor AS location_floor,
  r.common_area::text AS common_area, r.location_detail, r.location_snapshot,
  r.created_at, r.updated_at,
  p.display_name AS property_name,
  rm.room_number, rm.display_label AS room_label,
  b.bed_label,
  a.occupant_name AS tenant_name, a.occupant_phone_e164 AS tenant_phone_e164
`;

const MAINTENANCE_REQUEST_JOINS = `
  FROM pg_maintenance_requests r
  LEFT JOIN pg_properties p ON p.id = r.pg_property_id
  LEFT JOIN pg_bed_assignments a ON a.id = r.assignment_id
  LEFT JOIN pg_beds b ON b.id = r.bed_id
  LEFT JOIN pg_rooms rm ON rm.id = r.room_id
`;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toCategory(row: CategoryRow): PgMaintenanceCategory {
  return {
    slug: row.slug,
    display_name: row.display_name,
    default_priority: row.default_priority,
    active: row.active,
    sort_order: Number(row.sort_order)
  };
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

function toTimelineEvent(row: TimelineEventRow): PgMaintenanceTimelineEvent {
  return {
    id: row.id,
    request_id: row.request_id,
    event_type: row.event_type,
    visibility: row.visibility,
    actor_user_id: row.actor_user_id,
    actor_role: row.actor_role,
    from_status: row.from_status,
    to_status: row.to_status,
    payload: isRecord(row.payload) ? row.payload : {},
    created_at: toIso(row.created_at)
  };
}

function toLocation(row: MaintenanceRow): PgMaintenanceRequest["location"] {
  if (!row.location_bed_id && !row.location_room_id && !row.assignment_id) return null;
  return {
    property_id: row.pg_property_id,
    property_name: row.property_name ?? null,
    room_id: row.location_room_id,
    room_number: row.room_number ?? null,
    room_label: row.room_label ?? null,
    floor: row.location_floor,
    bed_id: row.location_bed_id,
    bed_label: row.bed_label ?? null,
    tenant_name: row.tenant_name ?? null,
    tenant_phone_e164: row.tenant_phone_e164 ?? null
  };
}

function toLocationSnapshot(row: MaintenanceRow): PgMaintenanceLocationSnapshot {
  const snapshot = isRecord(row.location_snapshot) ? row.location_snapshot : {};
  return {
    kind: row.location_kind,
    property_name: nullableString(snapshot.property_name) ?? row.property_name ?? null,
    room_number: nullableString(snapshot.room_number) ?? row.room_number ?? null,
    room_label: nullableString(snapshot.room_label) ?? row.room_label ?? null,
    floor: nullableNumber(snapshot.floor) ?? row.location_floor,
    bed_label: nullableString(snapshot.bed_label) ?? row.bed_label ?? null,
    common_area: row.common_area,
    detail: nullableString(snapshot.detail) ?? row.location_detail
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
    category_slug: row.category_slug,
    category_label_snapshot: row.category_label_snapshot,
    priority_source: row.priority_source,
    priority_overridden_by: row.priority_overridden_by,
    priority_overridden_at: toIsoNullable(row.priority_overridden_at),
    priority_override_reason: row.priority_override_reason,
    sla_hours: Number(row.sla_hours) as PgMaintenanceSlaHours,
    sla_due_at: toIso(row.sla_due_at),
    is_overdue: row.is_overdue,
    closed_at: toIsoNullable(row.closed_at),
    resolved_at: toIsoNullable(row.resolved_at),
    resolution_note: row.resolution_note,
    resolution_source: row.resolution_source,
    fix_photo_paths: stringArray(row.fix_photo_paths),
    fix_photo_urls: stringArray(row.fix_photo_paths).map((path) => toPhotoUrl(path, photoBaseUrl)),
    resolution_cost_paise:
      row.resolution_cost_paise === null ? null : Number(row.resolution_cost_paise),
    chargeable_damage: row.chargeable_damage,
    auto_close_after: toIsoNullable(row.auto_close_after),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    comments,
    location: toLocation(row),
    location_snapshot: toLocationSnapshot(row)
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

function cleanUuid(value: unknown, requiredCode: string, invalidCode: string): string {
  const cleaned = cleanRequired(value, requiredCode);
  if (!UUID_PATTERN.test(cleaned)) throw new BadRequestException({ code: invalidCode });
  return cleaned;
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

  private cleanQueueLimit(value: unknown): number {
    if (value === undefined || value === null || value === "") return 30;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException({ code: "invalid_maintenance_limit" });
    }
    return Math.min(parsed, 100);
  }

  private cleanQueueBoolean(value: unknown): boolean {
    if (value === true || value === "true") return true;
    if (value === false || value === "false" || value === undefined || value === null) {
      return false;
    }
    throw new BadRequestException({ code: "invalid_maintenance_boolean" });
  }

  private cleanQueueFloor(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed))
      throw new BadRequestException({ code: "invalid_maintenance_floor" });
    return parsed;
  }

  private encodeQueueCursor(sort: "sla_due" | "newest", row: MaintenanceRow): string {
    const payload =
      sort === "newest"
        ? { sort, created_at: toIso(row.created_at), id: row.id }
        : {
            sort,
            sla_due_at: toIso(row.sla_due_at),
            created_at: toIso(row.created_at),
            id: row.id
          };
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  }

  private decodeQueueCursor(
    value: unknown,
    sort: "sla_due" | "newest"
  ): { createdAt: string; id: string; slaDueAt?: string } | null {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string")
      throw new BadRequestException({ code: "invalid_maintenance_cursor" });
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
        string,
        unknown
      >;
      if (parsed.sort !== sort || typeof parsed.id !== "string") {
        throw new Error("cursor sort mismatch");
      }
      if (typeof parsed.created_at !== "string") throw new Error("cursor timestamp missing");
      if (sort === "newest") return { createdAt: parsed.created_at, id: parsed.id };
      if (typeof parsed.sla_due_at !== "string") throw new Error("cursor timestamp missing");
      return { createdAt: parsed.created_at, slaDueAt: parsed.sla_due_at, id: parsed.id };
    } catch {
      throw new BadRequestException({ code: "invalid_maintenance_cursor" });
    }
  }

  private validateInternalNote(input: unknown): { body: string; attachments: string[] } {
    if (input !== undefined && !isRecord(input)) {
      throw new BadRequestException({ code: "invalid_internal_note" });
    }
    const payload = input ?? {};
    const body = cleanOptional(payload.body, "invalid_internal_note_body") ?? "";
    const attachments = this.validateStringArray(
      payload.attachments,
      "invalid_maintenance_attachments"
    );
    if (!body && attachments.length === 0) {
      throw new BadRequestException({ code: "maintenance_internal_note_required" });
    }
    if (attachments.length > MAX_MAINTENANCE_PHOTOS) {
      throw new BadRequestException({
        code: "too_many_maintenance_attachments",
        message: `Maximum ${MAX_MAINTENANCE_PHOTOS} attachments per comment`
      });
    }
    return { body, attachments };
  }

  private validateResolutionInput(input: unknown): {
    note: string;
    fixPhotoPaths: string[];
    costPaise: number | null;
    chargeableDamage: boolean;
  } {
    if (input !== undefined && !isRecord(input)) {
      throw new BadRequestException({ code: "invalid_maintenance_resolution" });
    }
    const payload = (input ?? {}) as Partial<PgMaintenanceResolutionInput>;
    const note = cleanRequired(payload.note, "maintenance_resolution_note_required");
    const fixPhotoPaths = this.validateStringArray(
      payload.fix_photo_paths,
      "invalid_maintenance_photos"
    );
    if (fixPhotoPaths.length > MAX_MAINTENANCE_PHOTOS) {
      throw new BadRequestException({
        code: "too_many_maintenance_photos",
        message: `Maximum ${MAX_MAINTENANCE_PHOTOS} photos per request`
      });
    }
    if (typeof payload.chargeable_damage !== "boolean") {
      throw new BadRequestException({ code: "maintenance_chargeable_damage_required" });
    }
    const costPaise =
      payload.cost_paise === undefined || payload.cost_paise === null
        ? null
        : Number(payload.cost_paise);
    if (
      costPaise !== null &&
      (!Number.isInteger(costPaise) || costPaise < 0 || !Number.isSafeInteger(costPaise))
    ) {
      throw new BadRequestException({ code: "invalid_maintenance_cost" });
    }
    return {
      note,
      fixPhotoPaths,
      costPaise,
      chargeableDamage: payload.chargeable_damage
    };
  }

  private assertMaintenanceBlobPath(propertyId: string, requestId: string, path: string): void {
    const prefix = `pg-maintenance/${propertyId}/${requestId}/`;
    if (path !== path.replace(/^\/+/, "") || !path.startsWith(prefix)) {
      throw new BadRequestException({ code: "invalid_maintenance_photos" });
    }
  }

  private async residenceAssignmentsForMaintenance(
    userId: string,
    scope: MaintenanceResidenceScope
  ): Promise<ResidenceAssignmentRow[]> {
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
        WHERE (
          $2::text IN ('current', 'all')
          AND a.status IN (
            'reserved',
            'active',
            'notice_served',
            'move_out_requested',
            'move_out_pending_confirmation'
          )
        ) OR (
          $2::text IN ('history', 'all')
          AND a.status = 'moved_out'
          AND a.move_out_date >= CURRENT_DATE - INTERVAL '6 months'
        )
        ORDER BY CASE a.status::text
                   WHEN 'active' THEN 1
                   WHEN 'notice_served' THEN 2
                   WHEN 'move_out_requested' THEN 3
                   WHEN 'move_out_pending_confirmation' THEN 4
                   WHEN 'reserved' THEN 5
                   WHEN 'moved_out' THEN 6
                   ELSE 7
                 END,
                 a.updated_at DESC,
                 a.id`,
      [userId, scope]
    );
    return result.rows;
  }

  private async currentResidenceAssignment(userId: string): Promise<ResidenceAssignmentRow> {
    const row = (await this.residenceAssignmentsForMaintenance(userId, "current"))[0];
    if (!row) {
      throw new NotFoundException({
        code: "residence_not_found",
        message: "No active PG residence found"
      });
    }
    return row;
  }

  private priorityHours(priority: PgMaintenancePriority): PgMaintenanceSlaHours {
    return priority === "emergency"
      ? 4
      : priority === "high"
        ? 24
        : priority === "normal"
          ? 72
          : 168;
  }

  private async categoryBySlug(slug: unknown): Promise<PgMaintenanceCategory> {
    const cleaned = cleanRequired(slug, "maintenance_category_required");
    const result = await this.db.query<CategoryRow>(
      `SELECT slug, display_name, default_priority::text AS default_priority, active, sort_order
         FROM pg_maintenance_categories
        WHERE slug = $1 AND active = true
        LIMIT 1`,
      [cleaned]
    );
    if (!result.rows[0]) {
      throw new BadRequestException({ code: "invalid_maintenance_category" });
    }
    return toCategory(result.rows[0]);
  }

  private async categoryForCreate(payload: MaintenanceCreatePayload): Promise<{
    category: PgMaintenanceCategory;
    legacyCategory: string;
  }> {
    if (payload.category_slug !== undefined) {
      const category = await this.categoryBySlug(payload.category_slug);
      return { category, legacyCategory: category.display_name };
    }

    const legacyCategory = cleanRequired(payload.category, "maintenance_category_required");
    const normalized = legacyCategory
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const result = await this.db.query<CategoryRow>(
      `SELECT slug, display_name, default_priority::text AS default_priority, active, sort_order
         FROM pg_maintenance_categories
        WHERE slug = $1 AND active = true
        LIMIT 1`,
      [normalized]
    );
    return {
      category: result.rows[0] ? toCategory(result.rows[0]) : await this.categoryBySlug("other"),
      legacyCategory
    };
  }

  private async validateLocationInput(
    propertyId: string,
    residence: ResidenceAssignmentRow,
    input: unknown
  ): Promise<ValidatedLocation> {
    const residenceLocation = await this.db.query<ResidenceLocationRow>(
      `SELECT p.display_name AS property_name, p.total_floors,
              rm.id::text AS room_id, rm.room_number, rm.display_label AS room_label, rm.floor,
              b.id::text AS bed_id, b.bed_label
         FROM pg_properties p
         JOIN pg_bed_assignments a ON a.id = $2::uuid AND a.pg_property_id = p.id
         LEFT JOIN pg_beds b ON b.id = a.bed_id
         LEFT JOIN pg_rooms rm ON rm.id = b.room_id
        WHERE p.id = $1::uuid
        LIMIT 1`,
      [propertyId, residence.assignment_id]
    );
    const base = residenceLocation.rows[0];
    if (!base) {
      throw new BadRequestException({ code: "invalid_maintenance_location" });
    }

    const snapshot = (
      kind: PgMaintenanceLocationKind,
      room: Pick<ResidenceLocationRow, "room_number" | "room_label" | "floor">,
      bedLabel: string | null,
      commonArea: PgMaintenanceCommonArea | null,
      detail: string | null
    ): PgMaintenanceLocationSnapshot => ({
      kind,
      property_name: base.property_name,
      room_number: room.room_number,
      room_label: room.room_label,
      floor: room.floor,
      bed_label: bedLabel,
      common_area: commonArea,
      detail
    });

    if (input === undefined) {
      if (base.bed_id) {
        return {
          kind: "bed",
          roomId: base.room_id,
          bedId: base.bed_id,
          floor: base.floor,
          commonArea: null,
          detail: null,
          snapshot: snapshot("bed", base, base.bed_label, null, null)
        };
      }
      return {
        kind: "property_wide",
        roomId: null,
        bedId: null,
        floor: null,
        commonArea: null,
        detail: null,
        snapshot: snapshot(
          "property_wide",
          { room_number: null, room_label: null, floor: null },
          null,
          null,
          null
        )
      };
    }

    if (
      !isRecord(input) ||
      !PG_MAINTENANCE_LOCATION_KINDS.includes(input.kind as PgMaintenanceLocationKind)
    ) {
      throw new BadRequestException({ code: "invalid_maintenance_location" });
    }
    const kind = input.kind as PgMaintenanceLocationKind;

    if (kind === "bed") {
      const bedId = cleanUuid(
        input.bed_id,
        "maintenance_bed_id_required",
        "invalid_maintenance_bed"
      );
      const result = await this.db.query<ResidenceLocationRow>(
        `SELECT p.display_name AS property_name, p.total_floors,
                rm.id::text AS room_id, rm.room_number, rm.display_label AS room_label, rm.floor,
                b.id::text AS bed_id, b.bed_label
           FROM pg_beds b
           JOIN pg_rooms rm ON rm.id = b.room_id
           JOIN pg_properties p ON p.id = rm.pg_property_id
          WHERE b.id = $1::uuid AND p.id = $2::uuid
          LIMIT 1`,
        [bedId, propertyId]
      );
      const bed = result.rows[0];
      if (!bed) throw new BadRequestException({ code: "invalid_maintenance_bed" });
      return {
        kind,
        roomId: bed.room_id,
        bedId: bed.bed_id,
        floor: bed.floor,
        commonArea: null,
        detail: null,
        snapshot: snapshot(kind, bed, bed.bed_label, null, null)
      };
    }

    if (kind === "room") {
      const roomId = cleanUuid(
        input.room_id,
        "maintenance_room_id_required",
        "invalid_maintenance_room"
      );
      const result = await this.db.query<ResidenceLocationRow>(
        `SELECT p.display_name AS property_name, p.total_floors,
                rm.id::text AS room_id, rm.room_number, rm.display_label AS room_label, rm.floor,
                NULL::text AS bed_id, NULL::text AS bed_label
           FROM pg_rooms rm
           JOIN pg_properties p ON p.id = rm.pg_property_id
          WHERE rm.id = $1::uuid AND p.id = $2::uuid
          LIMIT 1`,
        [roomId, propertyId]
      );
      const room = result.rows[0];
      if (!room) throw new BadRequestException({ code: "invalid_maintenance_room" });
      return {
        kind,
        roomId: room.room_id,
        bedId: null,
        floor: room.floor,
        commonArea: null,
        detail: null,
        snapshot: snapshot(kind, room, null, null, null)
      };
    }

    if (kind === "floor") {
      const floor = input.floor;
      if (
        typeof floor !== "number" ||
        !Number.isInteger(floor) ||
        floor < 0 ||
        (base.total_floors !== null && floor > base.total_floors)
      ) {
        throw new BadRequestException({ code: "invalid_maintenance_floor" });
      }
      return {
        kind,
        roomId: null,
        bedId: null,
        floor,
        commonArea: null,
        detail: null,
        snapshot: snapshot(kind, { room_number: null, room_label: null, floor }, null, null, null)
      };
    }

    if (kind === "common_area") {
      if (!PG_MAINTENANCE_COMMON_AREAS.includes(input.common_area as PgMaintenanceCommonArea)) {
        throw new BadRequestException({ code: "invalid_maintenance_common_area" });
      }
      const commonArea = input.common_area as PgMaintenanceCommonArea;
      return {
        kind,
        roomId: null,
        bedId: null,
        floor: null,
        commonArea,
        detail: null,
        snapshot: snapshot(
          kind,
          { room_number: null, room_label: null, floor: null },
          null,
          commonArea,
          null
        )
      };
    }

    const detail =
      kind === "other" ? cleanRequired(input.detail, "maintenance_location_detail_required") : null;
    return {
      kind,
      roomId: null,
      bedId: null,
      floor: null,
      commonArea: null,
      detail,
      snapshot: snapshot(
        kind,
        { room_number: null, room_label: null, floor: null },
        null,
        null,
        detail
      )
    };
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
      `SELECT ${MAINTENANCE_REQUEST_SELECT}
         ${MAINTENANCE_REQUEST_JOINS}
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
    const residences = await this.residenceAssignmentsForMaintenance(userId, "current");
    if (residences.length === 0) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
    const result = await this.db.query<{ id: string }>(
      `SELECT r.id::text
         FROM pg_maintenance_requests r
        WHERE r.id = $1::uuid
          AND r.assignment_id = ANY($2::uuid[])
        LIMIT 1`,
      [requestId, residences.map((residence) => residence.assignment_id)]
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

  private async timelineForRequest(
    requestId: string,
    visibility: "public" | "all"
  ): Promise<PgMaintenanceTimelineEvent[]> {
    const result = await this.db.query<TimelineEventRow>(
      `SELECT id::text, request_id::text, event_type::text AS event_type,
              visibility::text AS visibility, actor_user_id::text, actor_role,
              from_status::text AS from_status, to_status::text AS to_status,
              payload, created_at
         FROM pg_maintenance_events
        WHERE request_id = $1::uuid
          AND ($2::boolean OR visibility = 'public')
        ORDER BY created_at ASC, id ASC`,
      [requestId, visibility === "all"]
    );
    return result.rows.map(toTimelineEvent);
  }

  async create(
    callerUserId: string,
    _propertyId: string,
    _assignmentId: string,
    input: Partial<PgMaintenanceCreateInput> | undefined
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const payload = (input ?? {}) as MaintenanceCreatePayload;
    const description = cleanRequired(payload.description, "maintenance_description_required");
    const photoPaths = this.validateStringArray(payload.photo_paths, "invalid_maintenance_photos");
    if (photoPaths.length > 0) {
      throw new BadRequestException({ code: "maintenance_photos_not_supported" });
    }
    const residence = await this.currentResidenceAssignment(callerUserId);
    const { category, legacyCategory } = await this.categoryForCreate(payload);
    const location = await this.validateLocationInput(
      residence.property_id,
      residence,
      payload.location
    );
    const slaHours = this.priorityHours(category.default_priority);

    const result = await this.db.query<{ id: string }>(
      `INSERT INTO pg_maintenance_requests
         (pg_property_id, assignment_id, created_by_user_id, category, category_slug,
          category_label_snapshot, description, photo_paths, priority, priority_source,
          sla_hours, sla_due_at, location_kind, room_id, bed_id, floor, common_area,
          location_detail, location_snapshot)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8::jsonb,
               $9::pg_maintenance_priority, 'category_default', $10,
               now() + make_interval(hours => $11::integer), $12::pg_maintenance_location_kind,
               $13::uuid, $14::uuid, $15, $16::pg_maintenance_common_area, $17, $18::jsonb)
       RETURNING id::text`,
      [
        residence.property_id,
        residence.assignment_id,
        callerUserId,
        legacyCategory,
        category.slug,
        category.display_name,
        description,
        JSON.stringify(photoPaths),
        category.default_priority,
        slaHours,
        slaHours,
        location.kind,
        location.roomId,
        location.bedId,
        location.floor,
        location.commonArea,
        location.detail,
        JSON.stringify(location.snapshot)
      ]
    );
    const requests = await this.withComments([await this.requestForAccess(result.rows[0].id)]);
    return requests[0];
  }

  async listForProperty(operatorId: string, propertyId: string): Promise<PgMaintenanceRequest[]>;
  async listForProperty(
    operatorId: string,
    propertyId: string,
    filters: PgMaintenanceQueueFilters
  ): Promise<PgMaintenanceQueuePage>;
  async listForProperty(
    operatorId: string,
    propertyId: string,
    filters?: PgMaintenanceQueueFilters
  ): Promise<PgMaintenanceRequest[] | PgMaintenanceQueuePage> {
    if (!this.db.isEnabled()) {
      return filters === undefined ? [] : { rows: [], next_cursor: null };
    }
    if (filters === undefined) {
      await this.assertManagedOwnership(operatorId, propertyId);
      const result = await this.db.query<MaintenanceRow>(
        `SELECT ${MAINTENANCE_REQUEST_SELECT}
           ${MAINTENANCE_REQUEST_JOINS}
          WHERE r.pg_property_id = $1::uuid
          ORDER BY r.created_at DESC, r.id DESC`,
        [propertyId]
      );
      return this.withComments(result.rows);
    }

    const status = filters.status;
    if (status !== undefined && status !== "all" && !isPgMaintenanceStatus(status)) {
      throw new BadRequestException({ code: "invalid_maintenance_status" });
    }
    if (
      filters.priority !== undefined &&
      !PG_MAINTENANCE_PRIORITIES.includes(filters.priority as PgMaintenancePriority)
    ) {
      throw new BadRequestException({ code: "invalid_maintenance_priority" });
    }
    if (
      filters.location_kind !== undefined &&
      !PG_MAINTENANCE_LOCATION_KINDS.includes(filters.location_kind as PgMaintenanceLocationKind)
    ) {
      throw new BadRequestException({ code: "invalid_maintenance_location_kind" });
    }
    if (
      filters.common_area !== undefined &&
      !PG_MAINTENANCE_COMMON_AREAS.includes(filters.common_area as PgMaintenanceCommonArea)
    ) {
      throw new BadRequestException({ code: "invalid_maintenance_common_area" });
    }
    if (
      filters.sla_state !== undefined &&
      !["overdue", "due_today", "on_track"].includes(filters.sla_state)
    ) {
      throw new BadRequestException({ code: "invalid_maintenance_sla_state" });
    }
    const sort = filters.sort === "newest" ? "newest" : "sla_due";
    if (filters.sort !== undefined && !["sla_due", "newest"].includes(filters.sort)) {
      throw new BadRequestException({ code: "invalid_maintenance_sort" });
    }
    const limit = this.cleanQueueLimit(filters.limit);
    const floor = this.cleanQueueFloor(filters.floor);
    const includeClosed = this.cleanQueueBoolean(filters.include_closed);
    const cursor = this.decodeQueueCursor(filters.cursor, sort);

    await this.assertManagedOwnership(operatorId, propertyId);

    const values: unknown[] = [propertyId];
    const where = ["r.pg_property_id = $1::uuid"];
    const add = (condition: string, value: unknown) => {
      values.push(value);
      where.push(condition.replace("?", `$${values.length}`));
    };

    if (!includeClosed) where.push("r.status::text NOT IN ('closed', 'cancelled')");
    if (status !== undefined && status !== "all") add("r.status::text = ?", status);
    if (filters.priority !== undefined) add("r.priority::text = ?", filters.priority);
    if (filters.category_slug) add("r.category_slug = ?", filters.category_slug);
    if (filters.location_kind !== undefined)
      add("r.location_kind::text = ?", filters.location_kind);
    if (filters.common_area !== undefined) add("r.common_area::text = ?", filters.common_area);
    if (floor !== undefined) add("r.floor = ?", floor);
    if (filters.tenant_query) {
      const tenantQuery = `%${filters.tenant_query.trim()}%`;
      add("(a.occupant_name ILIKE ? OR a.occupant_phone_e164 ILIKE ?)", tenantQuery);
      values.push(tenantQuery);
      where[where.length - 1] = where[where.length - 1].replace("?", `$${values.length}`);
    }
    if (filters.sla_state === "overdue") {
      where.push("r.sla_due_at < now() AND r.status::text NOT IN ('closed', 'cancelled')");
    } else if (filters.sla_state === "due_today") {
      where.push(
        "r.sla_due_at >= now() AND r.sla_due_at < date_trunc('day', now()) + INTERVAL '1 day'"
      );
    } else if (filters.sla_state === "on_track") {
      where.push("r.sla_due_at >= date_trunc('day', now()) + INTERVAL '1 day'");
    }

    if (cursor) {
      if (sort === "newest") {
        values.push(cursor.createdAt, cursor.id);
        where.push(
          `(r.created_at, r.id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`
        );
      } else {
        values.push(cursor.slaDueAt, cursor.createdAt, cursor.id);
        where.push(
          `(r.sla_due_at > $${values.length - 2}::timestamptz
            OR (
              r.sla_due_at = $${values.length - 2}::timestamptz
              AND (
                r.created_at < $${values.length - 1}::timestamptz
                OR (
                  r.created_at = $${values.length - 1}::timestamptz
                  AND r.id > $${values.length}::uuid
                )
              )
            ))`
        );
      }
    }

    values.push(limit);
    const order =
      sort === "newest"
        ? "r.created_at DESC, r.id DESC"
        : "r.sla_due_at ASC NULLS LAST, r.created_at DESC, r.id ASC";
    const result = await this.db.query<MaintenanceRow>(
      `SELECT ${MAINTENANCE_REQUEST_SELECT}
         ${MAINTENANCE_REQUEST_JOINS}
        WHERE ${where.join("\n          AND ")}
        ORDER BY ${order}
        LIMIT $${values.length}`,
      values
    );
    return {
      rows: result.rows.map((row) => toRequest(row, [], this.photoBaseUrl())),
      next_cursor:
        result.rows.length === limit && result.rows.length > 0
          ? this.encodeQueueCursor(sort, result.rows[result.rows.length - 1])
          : null
    };
  }

  async listForBed(
    operatorId: string,
    propertyId: string,
    bedId: string
  ): Promise<PgMaintenanceRequest[]> {
    if (!this.db.isEnabled()) return [];
    await this.assertManagedOwnership(operatorId, propertyId);
    const result = await this.db.query<MaintenanceRow>(
      `SELECT ${MAINTENANCE_REQUEST_SELECT}
         ${MAINTENANCE_REQUEST_JOINS}
        WHERE r.pg_property_id = $1::uuid
          AND a.pg_property_id = $1::uuid
          AND r.bed_id = $2::uuid
        ORDER BY r.created_at DESC, r.id DESC`,
      [propertyId, bedId]
    );
    return this.withComments(result.rows);
  }

  async listForResidence(
    tenantUserId: string,
    scope: MaintenanceResidenceScope = "current"
  ): Promise<PgMaintenanceRequest[]> {
    if (!this.db.isEnabled()) return [];
    if (!(["current", "history", "all"] as const).includes(scope)) {
      throw new BadRequestException({ code: "invalid_maintenance_scope" });
    }
    const residences = await this.residenceAssignmentsForMaintenance(tenantUserId, scope);
    if (residences.length === 0) return [];
    const result = await this.db.query<MaintenanceRow>(
      `SELECT ${MAINTENANCE_REQUEST_SELECT}
         ${MAINTENANCE_REQUEST_JOINS}
        WHERE r.assignment_id = ANY($1::uuid[])
        ORDER BY r.created_at DESC, r.id DESC`,
      [residences.map((residence) => residence.assignment_id)]
    );
    return this.withComments(result.rows);
  }

  async getForTenant(tenantUserId: string, requestId: string): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const request = await this.requestForAccess(requestId);
    const residences = await this.residenceAssignmentsForMaintenance(tenantUserId, "all");
    if (
      request.assignment_id === null ||
      !residences.some((residence) => residence.assignment_id === request.assignment_id)
    ) {
      throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
    }
    const result = (await this.withComments([request]))[0];
    return {
      ...result,
      timeline: await this.timelineForRequest(requestId, "public")
    };
  }

  async getForOperator(
    operatorId: string,
    propertyId: string,
    requestId: string
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    await this.assertManagedOwnership(operatorId, propertyId);
    const request = await this.requestForAccess(requestId);
    if (request.pg_property_id !== propertyId) {
      throw new NotFoundException({
        code: "maintenance_request_not_found",
        message: "Maintenance request not found"
      });
    }
    const result = (await this.withComments([request]))[0];
    return {
      ...result,
      timeline: await this.timelineForRequest(requestId, "all")
    };
  }

  async timelineForOperator(
    operatorId: string,
    propertyId: string,
    requestId: string
  ): Promise<PgMaintenanceTimelineEvent[]> {
    if (!this.db.isEnabled()) throw this.unavailable();
    await this.assertManagedOwnership(operatorId, propertyId);
    const request = await this.requestForAccess(requestId);
    if (request.pg_property_id !== propertyId) {
      throw new NotFoundException({
        code: "maintenance_request_not_found",
        message: "Maintenance request not found"
      });
    }
    return this.timelineForRequest(requestId, "all");
  }

  async overridePriority(
    operatorId: string,
    propertyId: string,
    requestId: string,
    input: Partial<PgMaintenancePriorityOverrideInput> | undefined
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const priority = cleanRequired(input?.priority, "maintenance_priority_required");
    if (!PG_MAINTENANCE_PRIORITIES.includes(priority as PgMaintenancePriority)) {
      throw new BadRequestException({ code: "invalid_maintenance_priority" });
    }
    const reason = cleanRequired(input?.reason, "maintenance_priority_reason_required");
    const newPriority = priority as PgMaintenancePriority;
    const slaHours = this.priorityHours(newPriority);

    await transaction(this.db, async (client) => {
      const existing = await client.query<MaintenanceRow>(
        `SELECT ${MAINTENANCE_REQUEST_SELECT}
           ${MAINTENANCE_REQUEST_JOINS}
          WHERE r.id = $1::uuid
          FOR UPDATE OF r`,
        [requestId]
      );
      const request = existing.rows[0];
      if (!request || request.pg_property_id !== propertyId) {
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
        [propertyId, operatorId]
      );
      if (!ownership.rows[0]) {
        throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
      }

      await client.query(
        `UPDATE pg_maintenance_requests
            SET priority = $2::pg_maintenance_priority,
                sla_hours = $3::integer,
                sla_due_at = created_at + make_interval(hours => $3::integer),
                priority_source = 'operator_override',
                priority_overridden_by = $4::uuid,
                priority_overridden_at = clock_timestamp(),
                priority_override_reason = $5,
                updated_at = now()
          WHERE id = $1::uuid`,
        [requestId, newPriority, slaHours, operatorId, reason]
      );
      await client.query(
        `INSERT INTO pg_maintenance_events
           (request_id, event_type, visibility, actor_user_id, actor_role, payload, created_at)
         VALUES ($1::uuid, 'priority_overridden', 'public', $2::uuid, 'pg_operator',
                 $3::jsonb, clock_timestamp())`,
        [
          requestId,
          operatorId,
          JSON.stringify({
            from_priority: request.priority,
            to_priority: newPriority,
            reason,
            sla_hours: slaHours
          })
        ]
      );
    });

    return this.getForOperator(operatorId, propertyId, requestId);
  }

  async addInternalNote(
    operatorId: string,
    propertyId: string,
    requestId: string,
    input: unknown
  ): Promise<PgMaintenanceInternalNoteResponse> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const { body, attachments } = this.validateInternalNote(input);
    await this.assertManagedOwnership(operatorId, propertyId);
    const request = await this.requestForAccess(requestId);
    if (request.pg_property_id !== propertyId) {
      throw new NotFoundException({
        code: "maintenance_request_not_found",
        message: "Maintenance request not found"
      });
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

    const result = await this.db.query<TimelineEventRow>(
      `INSERT INTO pg_maintenance_events
         (request_id, event_type, visibility, actor_user_id, actor_role, payload, created_at)
       VALUES ($1::uuid, 'internal_note_added', 'operator_internal', $2::uuid, 'pg_operator',
               $3::jsonb, clock_timestamp())
       RETURNING id::text, request_id::text, event_type::text AS event_type,
                 visibility::text AS visibility, actor_user_id::text, actor_role,
                 from_status::text AS from_status, to_status::text AS to_status,
                 payload, created_at`,
      [requestId, operatorId, JSON.stringify({ body, attachments })]
    );
    const event = toTimelineEvent(result.rows[0]);
    return {
      id: event.id,
      request_id: event.request_id,
      author_user_id: event.actor_user_id,
      author_role: "pg_operator",
      visibility: "operator_internal",
      body,
      attachments,
      attachment_urls: attachments.map((path) => toPhotoUrl(path, this.photoBaseUrl())),
      created_at: event.created_at
    };
  }

  async reopenByTenant(
    callerUserId: string,
    requestId: string,
    input: unknown
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    if (input !== undefined && !isRecord(input)) {
      throw new BadRequestException({ code: "invalid_maintenance_reopen" });
    }
    const payload = input ?? {};
    const commentBody = cleanOptional(payload.body, "invalid_maintenance_comment") ?? "";
    const attachments = this.validateStringArray(
      payload.attachments,
      "invalid_maintenance_attachments"
    );
    if (attachments.length > MAX_MAINTENANCE_PHOTOS) {
      throw new BadRequestException({
        code: "too_many_maintenance_attachments",
        message: `Maximum ${MAX_MAINTENANCE_PHOTOS} attachments per comment`
      });
    }

    await transaction(this.db, async (client) => {
      const existing = await client.query<MaintenanceRow>(
        `SELECT ${MAINTENANCE_REQUEST_SELECT}
           ${MAINTENANCE_REQUEST_JOINS}
          WHERE r.id = $1::uuid
          FOR UPDATE OF r`,
        [requestId]
      );
      const request = existing.rows[0];
      if (!request) {
        throw new NotFoundException({
          code: "maintenance_request_not_found",
          message: "Maintenance request not found"
        });
      }

      const access = await client.query<{ id: string }>(
        `WITH caller AS (
           SELECT id, phone_e164
             FROM users
            WHERE id = $1::uuid
         )
         SELECT a.id::text
           FROM caller
           JOIN pg_bed_assignments a
             ON (
               a.tenant_user_id = caller.id
               OR (a.tenant_user_id IS NULL AND a.occupant_phone_e164 = caller.phone_e164)
             )
          WHERE a.id = $2::uuid
            AND a.status IN (
              'reserved',
              'active',
              'notice_served',
              'move_out_requested',
              'move_out_pending_confirmation'
            )
          LIMIT 1`,
        [callerUserId, request.assignment_id]
      );
      if (!access.rows[0]) {
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

      const updated = await client.query<{ id: string }>(
        `UPDATE pg_maintenance_requests
            SET status = 'in_progress',
                auto_close_after = NULL,
                reopened_at = now(),
                last_tenant_activity_at = now(),
                updated_at = now()
          WHERE id = $1::uuid
            AND status = 'resolved'
            AND auto_close_after > now()
          RETURNING id::text`,
        [requestId]
      );
      if (!updated.rows[0]) {
        throw new ConflictException({ code: "maintenance_reopen_not_allowed" });
      }

      await client.query(
        `INSERT INTO pg_maintenance_events
           (request_id, event_type, visibility, actor_user_id, actor_role,
            from_status, to_status, payload, created_at)
         VALUES ($1::uuid, 'reopened', 'public', $2::uuid, 'tenant',
                 'resolved', 'in_progress', '{}'::jsonb, clock_timestamp())`,
        [requestId, callerUserId]
      );

      if (commentBody || attachments.length > 0) {
        const comment = await client.query<{ id: string }>(
          `INSERT INTO pg_maintenance_comments
             (request_id, author_user_id, author_role, body, attachments)
           VALUES ($1::uuid, $2::uuid, 'tenant', $3, $4::jsonb)
           RETURNING id::text`,
          [requestId, callerUserId, commentBody, JSON.stringify(attachments)]
        );
        await client.query(
          `INSERT INTO pg_maintenance_events
             (request_id, event_type, visibility, actor_user_id, actor_role, payload, created_at)
           VALUES ($1::uuid, 'comment_added', 'public', $2::uuid, 'tenant', $3::jsonb, clock_timestamp())`,
          [requestId, callerUserId, JSON.stringify({ comment_id: comment.rows[0].id })]
        );
      }
    });

    return (await this.withComments([await this.requestForAccess(requestId)]))[0];
  }

  async resolve(
    operatorId: string,
    propertyId: string,
    requestId: string,
    input: unknown
  ): Promise<PgMaintenanceRequest> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const payload = this.validateResolutionInput(input);

    const updatedRequestId = await transaction(this.db, async (client) => {
      const existing = await client.query<MaintenanceRow>(
        `SELECT ${MAINTENANCE_REQUEST_SELECT}
           ${MAINTENANCE_REQUEST_JOINS}
          WHERE r.id = $1::uuid
          FOR UPDATE OF r`,
        [requestId]
      );
      const request = existing.rows[0];
      if (!request || request.pg_property_id !== propertyId) {
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
        [propertyId, operatorId]
      );
      if (!ownership.rows[0]) {
        throw new ForbiddenException({ code: "forbidden", message: "Forbidden" });
      }
      if (!["in_progress", "waiting_on_tenant"].includes(request.status)) {
        throw new ConflictException({
          code: "invalid_maintenance_transition",
          from_status: request.status,
          to_status: "resolved"
        });
      }

      for (const path of payload.fixPhotoPaths) {
        this.assertMaintenanceBlobPath(propertyId, requestId, path);
        await this.requirePhotoStorage().validateMaintenanceUploadedBlob(
          propertyId,
          requestId,
          path
        );
      }

      const updated = await client.query<{ id: string }>(
        `UPDATE pg_maintenance_requests
            SET status = 'resolved',
                resolved_at = now(),
                resolved_by_user_id = $2::uuid,
                resolution_note = $3,
                resolution_source = 'operator',
                fix_photo_paths = $4::jsonb,
                resolution_cost_paise = $5::bigint,
                chargeable_damage = $6::boolean,
                auto_close_after = now() + INTERVAL '72 hours',
                last_operator_activity_at = now(),
                updated_at = now()
          WHERE id = $1::uuid
            AND status = $7::pg_maintenance_status
          RETURNING id::text`,
        [
          requestId,
          operatorId,
          payload.note,
          JSON.stringify(payload.fixPhotoPaths),
          payload.costPaise,
          payload.chargeableDamage,
          request.status
        ]
      );
      if (!updated.rows[0]) {
        throw new ConflictException({
          code: "invalid_maintenance_transition",
          from_status: request.status,
          to_status: "resolved"
        });
      }

      await client.query(
        `INSERT INTO pg_maintenance_events
           (request_id, event_type, visibility, actor_user_id, actor_role, payload, created_at)
         VALUES ($1::uuid, 'resolution_recorded', 'public', $2::uuid, 'pg_operator',
                 $3::jsonb, clock_timestamp())`,
        [
          requestId,
          operatorId,
          JSON.stringify({
            note: payload.note,
            fix_photo_paths: payload.fixPhotoPaths,
            cost_paise: payload.costPaise,
            chargeable_damage: payload.chargeableDamage
          })
        ]
      );
      await client.query(
        `INSERT INTO pg_maintenance_events
           (request_id, event_type, visibility, actor_user_id, actor_role,
            from_status, to_status, payload, created_at)
         VALUES ($1::uuid, 'status_changed', 'public', $2::uuid, 'pg_operator',
                 $3::pg_maintenance_status, 'resolved', '{}'::jsonb, clock_timestamp())`,
        [requestId, operatorId, request.status]
      );

      return updated.rows[0].id;
    });

    return this.getForOperator(operatorId, propertyId, updatedRequestId);
  }

  async analyticsForProperty(
    operatorId: string,
    propertyId: string
  ): Promise<PgMaintenanceAnalytics> {
    if (!this.db.isEnabled()) {
      return {
        open: 0,
        overdue: 0,
        due_today: 0,
        waiting_on_tenant: 0,
        resolved_pending_close: 0,
        closed_this_month: 0,
        by_category: []
      };
    }
    await this.assertManagedOwnership(operatorId, propertyId);
    const scalar = await this.db.query<{
      open: number | string;
      overdue: number | string;
      due_today: number | string;
      waiting_on_tenant: number | string;
      resolved_pending_close: number | string;
      closed_this_month: number | string;
    }>(
      `SELECT
          COUNT(*) FILTER (WHERE status::text IN ('open', 'in_progress')) AS open,
          COUNT(*) FILTER (
            WHERE status::text IN ('open', 'in_progress', 'waiting_on_tenant')
              AND sla_due_at < now()
          ) AS overdue,
          COUNT(*) FILTER (
            WHERE status::text IN ('open', 'in_progress')
              AND sla_due_at >= now()
              AND sla_due_at < date_trunc('day', now()) + INTERVAL '1 day'
          ) AS due_today,
          COUNT(*) FILTER (WHERE status = 'waiting_on_tenant') AS waiting_on_tenant,
          COUNT(*) FILTER (
            WHERE status = 'resolved'
              AND auto_close_after IS NOT NULL
              AND auto_close_after > now()
          ) AS resolved_pending_close,
          COUNT(*) FILTER (
            WHERE status = 'closed'
              AND closed_at >= date_trunc('month', now())
              AND closed_at < date_trunc('month', now()) + INTERVAL '1 month'
          ) AS closed_this_month
         FROM pg_maintenance_requests
        WHERE pg_property_id = $1::uuid`,
      [propertyId]
    );
    const byCategory = await this.db.query<{
      category_slug: string;
      display_name: string;
      count: number | string;
    }>(
      `SELECT r.category_slug, r.category_label_snapshot AS display_name, COUNT(*) AS count
         FROM pg_maintenance_requests r
        WHERE r.pg_property_id = $1::uuid
          AND r.status::text IN ('open', 'in_progress')
        GROUP BY r.category_slug, r.category_label_snapshot
        ORDER BY count DESC, r.category_label_snapshot ASC`,
      [propertyId]
    );
    const row = scalar.rows[0];
    return {
      open: Number(row?.open ?? 0),
      overdue: Number(row?.overdue ?? 0),
      due_today: Number(row?.due_today ?? 0),
      waiting_on_tenant: Number(row?.waiting_on_tenant ?? 0),
      resolved_pending_close: Number(row?.resolved_pending_close ?? 0),
      closed_this_month: Number(row?.closed_this_month ?? 0),
      by_category: byCategory.rows.map((category) => ({
        category_slug: category.category_slug,
        display_name: category.display_name,
        count: Number(category.count)
      }))
    };
  }

  async summaryForBed(
    operatorId: string,
    propertyId: string,
    bedId: string
  ): Promise<PgMaintenanceSummary> {
    if (!this.db.isEnabled()) return { open_items: 0, overdue_items: 0 };
    await this.assertManagedOwnership(operatorId, propertyId);
    const result = await this.db.query<{
      open_items: number | string;
      overdue_items: number | string;
    }>(
      `SELECT COUNT(*) FILTER (WHERE r.status = ANY($3::pg_maintenance_status[])) AS open_items,
              COUNT(*) FILTER (
                WHERE r.status = ANY($3::pg_maintenance_status[])
                  AND r.sla_due_at < now()
              ) AS overdue_items
         FROM pg_maintenance_requests r
         JOIN pg_bed_assignments a ON a.id = r.assignment_id
        WHERE r.pg_property_id = $1::uuid
          AND a.pg_property_id = $1::uuid
          AND a.bed_id = $2::uuid`,
      [propertyId, bedId, OPEN_MAINTENANCE_STATUSES]
    );
    return {
      open_items: Number(result.rows[0]?.open_items ?? 0),
      overdue_items: Number(result.rows[0]?.overdue_items ?? 0)
    };
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
    const updatedRequestId = await transaction(this.db, async (client) => {
      const existing = await client.query<MaintenanceRow>(
        `SELECT ${MAINTENANCE_REQUEST_SELECT}
           ${MAINTENANCE_REQUEST_JOINS}
          WHERE r.id = $1::uuid
          FOR UPDATE OF r`,
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
      return result.rows[0].id;
    });
    const requests = await this.withComments([await this.requestForAccess(updatedRequestId)]);
    return requests[0];
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

    await transaction(this.db, async (client) => {
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
    });
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
