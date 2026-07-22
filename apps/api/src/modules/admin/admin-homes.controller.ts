import { Body, Controller, Get, Inject, Param, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import { sanitizeAdminHomesParams } from "./admin-homes.params";
import { AdminHomesService } from "./admin-homes.service";

@Controller("admin/homes")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminHomesController {
  constructor(@Inject(AdminHomesService) private readonly homes: AdminHomesService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("city") city?: string,
    @Query("q") q?: string,
    @Query("sort") sort?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string
  ) {
    return ok(
      await this.homes.listHomes(
        sanitizeAdminHomesParams({ status, city, q, sort, page, page_size: pageSize })
      )
    );
  }

  @Get(":listing_id")
  async detail(@Param("listing_id") listingId: string) {
    return ok(await this.homes.getHome(listingId));
  }

  // Admin toggle of the `is_available` flag — no owner scoping, audited via
  // admin_actions (action='availability_change'). Independent of `status`.
  @Patch(":listing_id/availability-status")
  async setAvailability(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: { available: boolean; reason?: string }
  ) {
    return ok(
      await this.homes.setAvailability(listingId, body.available, req.user.id, body.reason)
    );
  }

  // Admin-only waitlist leads — includes phone numbers (owners only ever see
  // a count on their own listing view).
  @Get(":listing_id/waitlist")
  async waitlist(@Param("listing_id") listingId: string) {
    return ok({ items: await this.homes.listWaitlist(listingId) });
  }
}
