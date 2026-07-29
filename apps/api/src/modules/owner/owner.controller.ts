import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import { ok } from "../../common/response";
import { OwnerService } from "./owner.service";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { ContactsService } from "../contacts/contacts.service";
import { CreateListingDto, UpdateListingDto, SubmitListingDto } from "./dto/listing.dto";
import {
  ListingContentGeneratorService,
  type GenerateContentInput
} from "./listing-content-generator.service";

@Controller("owner")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner")
export class OwnerController {
  constructor(
    @Inject(OwnerService) private readonly ownerService: OwnerService,
    @Inject(ContactsService) private readonly contactsService: ContactsService,
    @Inject(ListingContentGeneratorService)
    private readonly contentGenerator: ListingContentGeneratorService
  ) {}

  // Wizard endpoints also accept `admin`: the same wizard is mounted in the
  // admin portal for create-on-behalf. Ownership is still enforced in the
  // service layer, which scopes every query to owner_user_id = req.user.id, so
  // an admin caller reaches only their own drafts. Everything else on this
  // controller stays owner-only — see class @Roles. (SEC-H1)
  @Roles("owner", "admin")
  @Get("listings")
  async list(@Req() req: { user: { id: string } }, @Query("status") status?: string): Promise<any> {
    return ok(await this.ownerService.listOwnerListings(req.user.id, status));
  }

  @Roles("owner", "admin")
  @Post("listings")
  async create(@Req() req: { user: { id: string } }, @Body() body: CreateListingDto) {
    return ok(await this.ownerService.createListing(req.user.id, body));
  }

  @Roles("owner", "admin")
  @Get("listings/:listing_id")
  async getListing(@Req() req: { user: { id: string } }, @Param("listing_id") listingId: string) {
    return ok(await this.ownerService.getOwnerListing(req.user.id, listingId));
  }

  @Roles("owner", "admin")
  @Patch("listings/:listing_id")
  async update(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: UpdateListingDto
  ) {
    return ok(await this.ownerService.updateListing(req.user.id, listingId, body));
  }

  @Roles("owner", "pg_operator", "admin")
  @Post("listings/:listing_id/photos/presign")
  async presign(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body()
    body: { files: Array<{ client_upload_id: string; content_type: string; size_bytes: number }> },
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const idem = requireIdempotencyKey(idempotencyKey);
    return ok(await this.ownerService.presignPhotos(req.user.id, listingId, idem, body.files));
  }

  @Roles("owner", "pg_operator", "admin")
  @Post("listings/:listing_id/photos/complete")
  async complete(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body()
    body: {
      files: Array<{
        client_upload_id: string;
        blob_path: string;
        is_cover?: boolean;
        sort_order?: number;
      }>;
    },
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const idem = requireIdempotencyKey(idempotencyKey);
    return ok(await this.ownerService.completePhotos(req.user.id, listingId, idem, body.files));
  }

  @Roles("owner", "pg_operator", "admin")
  @Patch("listings/:listing_id/photos/reorder")
  async reorderPhotos(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body()
    body: { items: Array<{ photo_id: string; sort_order: number; is_cover?: boolean }> },
    @Headers("idempotency-key") idempotencyKey?: string
  ) {
    const idem = requireIdempotencyKey(idempotencyKey);
    return ok(await this.ownerService.reorderPhotos(req.user.id, listingId, idem, body.items));
  }

  @Roles("owner", "admin")
  @Post("listings/:listing_id/submit")
  async submit(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: SubmitListingDto
  ) {
    return ok(
      await this.ownerService.submitListing(req.user.id, listingId, body.agree_terms ?? false)
    );
  }

  // Pauses/resumes the listing entirely (status active <-> paused). Renamed from
  // `/availability` to `/visibility` so that path is never reused for the new
  // `is_available` flag below (see setAvailability).
  @Patch("listings/:listing_id/visibility")
  async toggleAvailability(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: { available: boolean }
  ) {
    return ok(await this.ownerService.toggleAvailability(req.user.id, listingId, body.available));
  }

  // Flips the `is_available` flag — independent of `status`/visibility above.
  @Patch("listings/:listing_id/availability-status")
  async setAvailability(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: { available: boolean }
  ) {
    return ok(await this.ownerService.setAvailability(req.user.id, listingId, body.available));
  }

  @Post("contact-unlocks/:unlock_id/responded")
  async markResponded(
    @Req() req: { user: { id: string } },
    @Param("unlock_id") unlockId: string,
    @Body() body: { channel: "call" | "whatsapp" | "sms" }
  ) {
    return ok(await this.contactsService.markOwnerResponded(req.user.id, unlockId, body.channel));
  }

  @Roles("owner", "admin")
  @Post("listings/generate-content")
  async generateContent(@Body() body: GenerateContentInput) {
    const result = await this.contentGenerator.generate(body);
    return ok(result);
  }
}
