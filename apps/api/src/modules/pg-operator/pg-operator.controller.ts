import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";
import type { UserContext } from "../../common/types";
import { ok } from "../../common/response";
import { PgSegmentationService } from "./services/pg-segmentation.service";
import { PgPropertiesService } from "./services/pg-properties.service";
import { PgSegmentRequestDto } from "./dto/pg-segment.dto";

@Controller("pg-operator")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgOperatorController {
  constructor(
    @Inject(PgSegmentationService) private readonly segmentation: PgSegmentationService,
    @Inject(PgPropertiesService) private readonly properties: PgPropertiesService
  ) {}

  @Get("me")
  async me(@AuthUser() user: UserContext) {
    const properties = await this.properties.listProperties(user.id);
    return ok({ operator: { id: user.id, role: user.role }, properties });
  }

  @Post("segment")
  segment(@Body() dto: PgSegmentRequestDto) {
    const r = this.segmentation.segment({
      totalBeds: dto.total_beds,
      propertyCount: dto.property_count ?? 0,
      hasExistingListings: dto.has_existing_listings ?? false
    });
    return ok(r);
  }

  @Get("onboarding-state")
  async onboardingState(@AuthUser() user: UserContext) {
    const properties = await this.properties.listProperties(user.id);
    const state = properties.length === 0 ? "needs_property" : "ready_to_list";
    return ok({ state, property_count: properties.length });
  }

  // NOTE: there is intentionally no standalone "create property" route. Under the
  // 1 listing : 1 property model a pg_property is only ever born attached to a
  // listing via publish (POST /pg-operator/listings) — a standalone route would
  // mint orphan properties (a property with no listing), which is not a valid
  // state. Property lifecycle lives entirely in the listing create/update path.
}
