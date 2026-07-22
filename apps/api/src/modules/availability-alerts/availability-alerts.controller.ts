import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AvailabilityAlertsService } from "./availability-alerts.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";

@Controller()
export class AvailabilityAlertsController {
  constructor(
    @Inject(AvailabilityAlertsService)
    private readonly availabilityAlertsService: AvailabilityAlertsService
  ) {}

  // Guests reach this after OTP verification (they hold an `acc_` session token,
  // same as any other role) — AuthGuard alone is sufficient, no RolesGuard.
  @Post("listings/:listing_id/availability-alerts")
  @UseGuards(AuthGuard)
  async join(
    @AuthUser() user: { id: string },
    @Param("listing_id") listingId: string,
    @Body() body: { locale?: string }
  ) {
    return ok(await this.availabilityAlertsService.join(user.id, listingId, body?.locale ?? null));
  }

  @Delete("listings/:listing_id/availability-alerts")
  @UseGuards(AuthGuard)
  async leave(@AuthUser() user: { id: string }, @Param("listing_id") listingId: string) {
    return ok(await this.availabilityAlertsService.leave(user.id, listingId));
  }

  @Get("tenant/availability-alerts")
  @UseGuards(AuthGuard)
  async listForUser(@AuthUser() user: { id: string }) {
    return ok({ items: await this.availabilityAlertsService.listForUser(user.id) });
  }
}
