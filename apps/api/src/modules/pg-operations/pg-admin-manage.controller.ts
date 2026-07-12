import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import type { UserContext } from "../../common/types";
import { PgManageRequestService } from "./services/pg-manage-request.service";

@Controller("admin/pg/manage-requests")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class PgAdminManageController {
  constructor(@Inject(PgManageRequestService) private readonly requests: PgManageRequestService) {}

  @Get()
  async list(@Query("status") status?: string) {
    return ok({ items: await this.requests.listForAdmin(status) });
  }

  @Post(":requestId/approve")
  async approve(
    @AuthUser() user: UserContext,
    @Param("requestId") requestId: string,
    @Body() body: { notes?: string }
  ) {
    return ok(await this.requests.approve(user.id, requestId, body.notes));
  }

  @Post(":requestId/reject")
  async reject(
    @AuthUser() user: UserContext,
    @Param("requestId") requestId: string,
    @Body() body: { notes?: string }
  ) {
    return ok(await this.requests.reject(user.id, requestId, body.notes));
  }
}
