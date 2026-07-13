import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import type { PgServeNoticeInput } from "@cribliv/shared-types";

import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import type { UserContext } from "../../common/types";
import { PgResidenceService } from "./services/pg-residence.service";

@Controller("tenant/pg-residence")
@UseGuards(AuthGuard, RolesGuard)
@Roles("tenant")
export class PgResidenceController {
  constructor(@Inject(PgResidenceService) private readonly residence: PgResidenceService) {}

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
}
