import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Optional,
  Param,
  Post,
  UseGuards
} from "@nestjs/common";
import type {
  PgMaintenanceCommentInput,
  PgMaintenanceCreateInput,
  PgServeNoticeInput
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
import { PgResidenceService } from "./services/pg-residence.service";

@Controller("tenant/pg-residence")
@UseGuards(AuthGuard, RolesGuard)
@Roles("tenant")
export class PgResidenceController {
  constructor(
    @Inject(PgResidenceService) private readonly residence: PgResidenceService,
    @Inject(PgMaintenanceService) private readonly maintenance: PgMaintenanceService,
    @Optional() @Inject(IdempotencyService) private readonly idem: IdempotencyService | undefined
  ) {}

  @Get()
  async get(@AuthUser() user: UserContext) {
    return ok(await this.residence.resolve(user.id));
  }

  @Post("notice")
  async serveNotice(@AuthUser() user: UserContext, @Body() body: Partial<PgServeNoticeInput>) {
    return ok(await this.residence.serveNotice(user.id, body));
  }

  @Post("move-out-request")
  async moveOutRequest(@AuthUser() user: UserContext) {
    return ok(await this.residence.tenantMoveOutRequest(user.id));
  }

  @Post("operator-move-out/:requestId/accept")
  async acceptOperatorMoveOut(
    @AuthUser() user: UserContext,
    @Param("requestId") requestId: string
  ) {
    return ok(await this.residence.acceptOperatorMoveOut(user.id, requestId));
  }

  @Post("operator-move-out/:requestId/reject")
  async rejectOperatorMoveOut(
    @AuthUser() user: UserContext,
    @Param("requestId") requestId: string
  ) {
    return ok(await this.residence.rejectOperatorMoveOut(user.id, requestId));
  }

  @Get("maintenance")
  async listMaintenance(@AuthUser() user: UserContext) {
    return ok(await this.maintenance.listForResidence(user.id));
  }

  @Post("maintenance")
  async createMaintenance(
    @AuthUser() user: UserContext,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: Partial<PgMaintenanceCreateInput> | undefined
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        "tenant:pg-residence:maintenance:create",
        key,
        () => this.maintenance.create(user.id, "", "", body)
      )
    );
  }

  @Post("maintenance/:id/comments")
  async addMaintenanceComment(
    @AuthUser() user: UserContext,
    @Param("id") requestId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: Partial<PgMaintenanceCommentInput> | undefined
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `tenant:pg-residence:maintenance:${requestId}:comments`,
        key,
        () => this.maintenance.addComment(user.id, requestId, body?.body, body?.attachments)
      )
    );
  }
}
