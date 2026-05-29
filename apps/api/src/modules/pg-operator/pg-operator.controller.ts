import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Post,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";
import type { UserContext } from "../../common/types";
import { ok } from "../../common/response";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { PgSegmentationService } from "./services/pg-segmentation.service";
import { PgPropertiesService } from "./services/pg-properties.service";
import { PgSegmentRequestDto } from "./dto/pg-segment.dto";
import { PgPropertyCreateSchema } from "./dto/pg-property.dto";

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

  @Post("properties")
  async createProperty(
    @AuthUser() user: UserContext,
    @Headers("idempotency-key") idemKey: string | undefined,
    @Body() body: unknown
  ) {
    requireIdempotencyKey(idemKey);
    const parsed = PgPropertyCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_payload",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      });
    }
    const prop = await this.properties.createProperty(user.id, parsed.data);
    return ok(prop);
  }
}
