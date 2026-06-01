import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
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
import { PgListingService } from "./services/pg-listing.service";
import { PgPropertiesService } from "./services/pg-properties.service";
import { PgListingCreateSchema } from "./dto/pg-listing.dto";

@Controller("pg-operator/listings")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgListingController {
  constructor(
    @Inject(PgListingService) private readonly listings: PgListingService,
    @Inject(PgPropertiesService) private readonly properties: PgPropertiesService
  ) {}

  @Post()
  async create(
    @AuthUser() user: UserContext,
    @Headers("idempotency-key") idemKey: string | undefined,
    @Body() body: unknown
  ) {
    requireIdempotencyKey(idemKey);
    const parsed = PgListingCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_payload",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      });
    }
    const prop = await this.properties.getActiveProperty(user.id);
    if (!prop) {
      throw new NotFoundException({
        code: "no_property",
        message: "no_property: create a pg_property first"
      });
    }
    // Wizard publish = submit for admin review → lands in the existing admin
    // queue (listings.status='pending_review') for approval → go-live.
    const listing = await this.listings.createDraft(
      user.id,
      prop.id,
      parsed.data,
      "pending_review"
    );
    // Response contract the web wizard consumes (pg-operator-api.ts): the publish
    // redirect reads `listing_id`, so expose it explicitly (not the internal `id`).
    return ok({ listing_id: listing.id, status: listing.status });
  }

  @Post(":id/submit")
  async submit(@AuthUser() user: UserContext, @Param("id") id: string) {
    // draft → pending_review → enters the existing admin review queue (go-live).
    const r = await this.listings.submitForReview(user.id, id);
    return ok({ listing_id: r.id, status: r.status });
  }

  @Get(":id")
  async detail(@AuthUser() user: UserContext, @Param("id") id: string) {
    const detail = await this.listings.getOperatorListingDetail(user.id, id);
    if (!detail) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: "listing_not_found: no PG listing with that id for this operator"
      });
    }
    return ok(detail);
  }
}
