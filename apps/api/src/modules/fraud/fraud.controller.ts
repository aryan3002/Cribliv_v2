import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { FraudService } from "./fraud.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";

@Controller()
export class FraudController {
  constructor(@Inject(FraudService) private readonly fraudService: FraudService) {}

  /** Tenant reports a listing */
  @Post("listings/:id/report")
  @UseGuards(AuthGuard)
  async reportListing(
    @Param("id") listingId: string,
    @AuthUser() user: { sub: string },
    @Body() body: { reason: string }
  ) {
    return ok(await this.fraudService.reportListing(listingId, user.sub, body.reason));
  }

  /** Admin: view unresolved fraud flags */
  @Get("admin/fraud/flags")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  async getFlags(@Query() query: { flag_type?: string; page?: string }) {
    const page = Math.max(1, Number(query.page) || 1);
    return ok(await this.fraudService.getUnresolvedFlags(query.flag_type, page));
  }

  /** Admin: resolve a fraud flag */
  @Post("admin/fraud/flags/:id/resolve")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  async resolveFlag(@Param("id") flagId: string, @AuthUser() user: { sub: string }) {
    return ok(await this.fraudService.resolveFlag(flagId, user.sub));
  }
}
