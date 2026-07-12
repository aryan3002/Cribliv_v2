import { Body, Controller, Get, Headers, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import type { UserContext } from "../../common/types";
import { PgManageRequestService } from "./services/pg-manage-request.service";

@Controller("pg-operator/listings")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgManageRequestController {
  constructor(@Inject(PgManageRequestService) private readonly requests: PgManageRequestService) {}

  @Post(":listingId/manage-request")
  async create(
    @AuthUser() user: UserContext,
    @Param("listingId") listingId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: { reason?: string }
  ) {
    requireIdempotencyKey(idempotencyKey);
    return ok(await this.requests.create(user.id, listingId, body.reason));
  }

  @Get(":listingId/manage-request")
  async getState(@AuthUser() user: UserContext, @Param("listingId") listingId: string) {
    return ok(await this.requests.getState(user.id, listingId));
  }
}
