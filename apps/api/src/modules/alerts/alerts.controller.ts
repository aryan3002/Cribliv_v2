import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AlertsService } from "./alerts.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";

@Controller("tenant")
@UseGuards(AuthGuard, RolesGuard)
@Roles("tenant")
export class AlertsController {
  constructor(@Inject(AlertsService) private readonly alertsService: AlertsService) {}

  @Post("saved-searches")
  async create(
    @AuthUser() user: { sub: string },
    @Body()
    body: {
      city_slug: string;
      locality_id?: number;
      bhk?: number;
      max_rent?: number;
      listing_type?: string;
    }
  ) {
    return ok(
      await this.alertsService.saveSavedSearch({
        userId: user.sub,
        citySlug: body.city_slug,
        localityId: body.locality_id,
        bhk: body.bhk,
        maxRent: body.max_rent,
        listingType: body.listing_type
      })
    );
  }

  @Get("saved-searches")
  async list(@AuthUser() user: { sub: string }) {
    return ok(await this.alertsService.getSavedSearches(user.sub));
  }

  @Delete("saved-searches/:id")
  async remove(@AuthUser() user: { sub: string }, @Param("id") searchId: string) {
    await this.alertsService.deleteSavedSearch(user.sub, searchId);
    return ok({ deleted: true });
  }
}
