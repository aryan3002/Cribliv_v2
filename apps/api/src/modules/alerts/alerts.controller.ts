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
    @AuthUser() user: { id: string },
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
        userId: user.id,
        citySlug: body.city_slug,
        localityId: body.locality_id,
        bhk: body.bhk,
        maxRent: body.max_rent,
        listingType: body.listing_type
      })
    );
  }

  @Get("saved-searches")
  async list(@AuthUser() user: { id: string }) {
    return ok(await this.alertsService.getSavedSearches(user.id));
  }

  @Delete("saved-searches/:id")
  async remove(@AuthUser() user: { id: string }, @Param("id") searchId: string) {
    await this.alertsService.deleteSavedSearch(user.id, searchId);
    return ok({ deleted: true });
  }
}
