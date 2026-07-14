import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import type {
  PgMaintenanceCommentInput,
  PgMaintenanceCompletePhotoInput,
  PgMaintenanceInternalNoteInput,
  PgMaintenancePriorityOverrideInput,
  PgMaintenanceQueueFilters,
  PgMaintenancePresignFileInput
} from "@cribliv/shared-types";

import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";
import { IdempotencyService, PASSTHROUGH_IDEMPOTENCY } from "../../common/idempotency.service";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import type { UserContext } from "../../common/types";
import { PgMaintenanceService } from "./services/pg-maintenance.service";

@Controller("pg-operator/properties")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgMaintenanceController {
  constructor(
    @Inject(PgMaintenanceService) private readonly maintenance: PgMaintenanceService,
    @Optional() @Inject(IdempotencyService) private readonly idem: IdempotencyService | undefined
  ) {}

  @Get(":propertyId/maintenance")
  async listForProperty(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query() query: PgMaintenanceQueueFilters
  ) {
    return ok(await this.maintenance.listForProperty(user.id, propertyId, query));
  }

  @Get(":propertyId/maintenance/:id")
  async getForOperator(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") requestId: string
  ) {
    return ok(await this.maintenance.getForOperator(user.id, propertyId, requestId));
  }

  @Get(":propertyId/maintenance/:id/timeline")
  async timelineForOperator(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") requestId: string
  ) {
    return ok(await this.maintenance.timelineForOperator(user.id, propertyId, requestId));
  }

  @Get(":propertyId/beds/:bedId/maintenance")
  async listForBed(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("bedId") bedId: string
  ) {
    return ok(await this.maintenance.listForBed(user.id, propertyId, bedId));
  }

  @Patch(":propertyId/maintenance/:id")
  async updateStatus(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") requestId: string,
    @Body() body: { status?: unknown } | undefined
  ) {
    return ok(await this.maintenance.updateStatus(user.id, requestId, body?.status, propertyId));
  }

  @Post(":propertyId/maintenance/:id/comments")
  async addComment(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") requestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: Partial<PgMaintenanceCommentInput> | undefined
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-operator:properties:${propertyId}:maintenance:${requestId}:comments`,
        key,
        () =>
          this.maintenance.addComment(user.id, requestId, body?.body, body?.attachments, propertyId)
      )
    );
  }

  @Post(":propertyId/maintenance/:id/priority")
  async overridePriority(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") requestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: Partial<PgMaintenancePriorityOverrideInput> | undefined
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-operator:properties:${propertyId}:maintenance:${requestId}:priority`,
        key,
        () => this.maintenance.overridePriority(user.id, propertyId, requestId, body)
      )
    );
  }

  @Post(":propertyId/maintenance/:id/internal-notes")
  async addInternalNote(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") requestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: Partial<PgMaintenanceInternalNoteInput> | undefined
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-operator:properties:${propertyId}:maintenance:${requestId}:internal-notes`,
        key,
        () => this.maintenance.addInternalNote(user.id, propertyId, requestId, body)
      )
    );
  }

  @Post(":propertyId/maintenance/:id/photos/presign")
  async presignPhotos(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") requestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { files?: PgMaintenancePresignFileInput[] } | undefined
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-operator:properties:${propertyId}:maintenance:${requestId}:photos:presign`,
        key,
        () => this.maintenance.presignPhotos(user.id, requestId, body?.files, propertyId)
      )
    );
  }

  @Post(":propertyId/maintenance/:id/photos/complete")
  async completePhotos(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") requestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { photos?: PgMaintenanceCompletePhotoInput[] } | undefined
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-operator:properties:${propertyId}:maintenance:${requestId}:photos:complete`,
        key,
        () => this.maintenance.completeRequestPhotos(user.id, requestId, body?.photos, propertyId)
      )
    );
  }
}
