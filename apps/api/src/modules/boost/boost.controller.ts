import { Body, Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { BoostService } from "./boost.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";

@Controller()
export class BoostController {
  constructor(@Inject(BoostService) private readonly boostService: BoostService) {}

  @Get("owner/boost/plans")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("owner", "pg_operator")
  async getPlans() {
    return ok(this.boostService.getPlans());
  }

  @Post("owner/listings/:id/boost")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("owner", "pg_operator")
  async createBoostOrder(
    @AuthUser() user: { sub: string },
    @Param("id") listingId: string,
    @Body() body: { plan_id: string }
  ) {
    return ok(await this.boostService.createBoostOrder(user.sub, listingId, body.plan_id));
  }

  @Get("owner/listings/:id/boost")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("owner", "pg_operator")
  async getBoostStatus(@Param("id") listingId: string) {
    return ok(await this.boostService.getActiveBoost(listingId));
  }
}
