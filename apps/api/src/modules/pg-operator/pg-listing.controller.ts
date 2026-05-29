import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  NotFoundException,
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
    const listing = await this.listings.createDraft(user.id, prop.id, parsed.data);
    return ok(listing);
  }
}
