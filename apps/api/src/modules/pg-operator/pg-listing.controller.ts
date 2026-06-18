import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Put,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";
import type { UserContext } from "../../common/types";
import { ok } from "../../common/response";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { IdempotencyService, PASSTHROUGH_IDEMPOTENCY } from "../../common/idempotency.service";
import { PgListingService } from "./services/pg-listing.service";
import { PgPropertiesService } from "./services/pg-properties.service";
import { PgDraftService } from "./services/pg-draft.service";
import { PgAiAssistService } from "./services/pg-ai-assist.service";
import { PgListingCreateSchema } from "./dto/pg-listing.dto";
import { PgDraftUpsertSchema } from "./dto/pg-draft.dto";
import { UpdatePgListingStatusSchema } from "./dto/pg-listing-status.dto";
import { readFeatureFlags } from "../../config/feature-flags";

@Controller("pg-operator/listings")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgListingController {
  constructor(
    @Inject(PgListingService) private readonly listings: PgListingService,
    @Inject(PgPropertiesService) private readonly properties: PgPropertiesService,
    @Inject(PgDraftService) private readonly draftService: PgDraftService,
    @Optional() @Inject(IdempotencyService) private readonly idem: IdempotencyService | undefined,
    @Optional() @Inject(PgAiAssistService) private readonly aiAssist?: PgAiAssistService
  ) {}

  @Post()
  async create(
    @AuthUser() user: UserContext,
    @Headers("idempotency-key") idemKey: string | undefined,
    @Body() body: unknown
  ) {
    const idem = requireIdempotencyKey(idemKey);
    const parsed = PgListingCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_payload",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      });
    }
    // BUG-H1: wrap the whole publish in idempotency so a retry / double-submit
    // with the same Idempotency-Key returns the SAME listing instead of creating
    // a duplicate across pg_listings/listings/pg_details/pg_room_types.
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        "pg-operator:listings:create",
        idem,
        async () => {
          // 1 listing : 1 property — every publish mints its OWN fresh pg_property
          // from the publish payload (no shared reuse, no getActiveProperty). The
          // wizard carries property basics + location into the SAME payload, so the
          // property is created server-side here, covering both the manual and the
          // voice→review submit paths (which funnel through this endpoint).
          const prop = await this.properties.createProperty(user.id, {
            display_name: parsed.data.property.display_name,
            city_slug: parsed.data.property.city_slug,
            locality_slug: parsed.data.property.locality_slug,
            total_floors: parsed.data.property.total_floors ?? undefined,
            lat: parsed.data.property.lat ?? null,
            lng: parsed.data.property.lng ?? null,
            formatted_address: parsed.data.property.formatted_address ?? null
          });
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
          return { listing_id: listing.id, status: listing.status };
        }
      )
    );
  }

  @Post(":id/submit")
  async submit(@AuthUser() user: UserContext, @Param("id") id: string) {
    // draft → pending_review → enters the existing admin review queue (go-live).
    const r = await this.listings.submitForReview(user.id, id);
    return ok({ listing_id: r.id, status: r.status });
  }

  @Put("draft")
  async upsertDraft(
    @AuthUser() user: UserContext,
    @Headers("idempotency-key") idemKey: string | undefined,
    @Body() body: unknown
  ) {
    requireIdempotencyKey(idemKey);
    const input = PgDraftUpsertSchema.parse(body);
    return this.draftService.upsert(user.id, input as any);
  }

  @Get("drafts")
  async listDrafts(@AuthUser() user: UserContext) {
    return { items: await this.draftService.list(user.id) };
  }

  @Get("draft/:id")
  async getDraft(@AuthUser() user: UserContext, @Param("id") id: string) {
    const d = await this.draftService.get(user.id, id);
    if (!d) throw new NotFoundException("draft_not_found");
    return d;
  }

  @Delete("draft/:id")
  @HttpCode(204)
  async deleteDraft(@AuthUser() user: UserContext, @Param("id") id: string) {
    await this.draftService.remove(user.id, id);
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

  // BUG-M1: load a committed listing back into the wizard. Returns the EXACT
  // PgListingPayload (inverse of the write path), ownership-scoped → 404 for a
  // non-owner / bad id. (Distinct from GET :id, which is the display DTO.)
  @Get(":id/edit")
  async editPayload(@AuthUser() user: UserContext, @Param("id") id: string) {
    const payload = await this.listings.getEditPayload(user.id, id);
    if (!payload) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: "listing_not_found: no PG listing with that id for this operator"
      });
    }
    return ok(payload);
  }

  // BUG-M1: save an edited listing back to the SAME id (re-enters pending_review
  // per the MATERIAL-EDIT rule). Idempotency-wrapped like create() so a retry /
  // double-submit with the same key doesn't double-apply. Returns the same
  // { listing_id, status } contract the wizard consumes.
  @Put(":id")
  async update(
    @AuthUser() user: UserContext,
    @Param("id") id: string,
    @Headers("idempotency-key") idemKey: string | undefined,
    @Body() body: unknown
  ) {
    const idem = requireIdempotencyKey(idemKey);
    const parsed = PgListingCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_payload",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      });
    }
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        "pg-operator:listings:update",
        idem,
        async () => {
          const r = await this.listings.updateListing(user.id, id, parsed.data);
          return { listing_id: r.id, status: r.status };
        }
      )
    );
  }

  @Patch(":id/status")
  async setStatus(@AuthUser() user: UserContext, @Param("id") id: string, @Body() body: unknown) {
    const parsed = UpdatePgListingStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_listing_status",
        message: parsed.error.message
      });
    }
    return ok(await this.listings.setListingStatus(id, user.id, parsed.data.status));
  }

  @Post("generate-content")
  async generateContent(@Body() body: { payload: unknown }) {
    if (!readFeatureFlags().ff_pg_ai_assist || !this.aiAssist) {
      throw new NotFoundException({ code: "feature_disabled", message: "ff_pg_ai_assist is off" });
    }
    return this.aiAssist.generateContent(body.payload as never);
  }

  @Post("pricing-suggestions")
  async pricingSuggestions(
    @Body() body: { city_slug: string; locality_slug?: string; sharings: string[] }
  ) {
    if (!readFeatureFlags().ff_pg_ai_assist || !this.aiAssist) {
      throw new NotFoundException({ code: "feature_disabled", message: "ff_pg_ai_assist is off" });
    }
    return this.aiAssist.pricingSuggestions({
      city_slug: body.city_slug,
      locality_slug: body.locality_slug,
      sharings: body.sharings as never
    });
  }

  @Post("amenity-suggestions")
  async amenitySuggestions(@Body() body: { payload: unknown }) {
    if (!readFeatureFlags().ff_pg_ai_assist || !this.aiAssist) {
      throw new NotFoundException({ code: "feature_disabled", message: "ff_pg_ai_assist is off" });
    }
    return this.aiAssist.amenitySuggestions(body.payload as never);
  }
}
