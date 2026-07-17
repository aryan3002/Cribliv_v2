import { Controller, Get, Inject, Param, Query, UseGuards } from "@nestjs/common";
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
}
