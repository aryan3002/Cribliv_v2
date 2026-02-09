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

@Controller("owner")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "pg_operator")
export class OwnerController {
  constructor(
    @Inject(OwnerService) private readonly ownerService: OwnerService,
    @Inject(ContactsService) private readonly contactsService: ContactsService
  ) {}

  @Get("listings")
  async list(@Req() req: { user: { id: string } }, @Query("status") status?: string): Promise<any> {
    return ok(await this.ownerService.listOwnerListings(req.user.id, status));
  }

  @Post("listings")
  async create(@Req() req: { user: { id: string } }, @Body() body: any) {
    return ok(await this.ownerService.createListing(req.user.id, body));
  }

  @Patch("listings/:listing_id")
  async update(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: any
  ) {
    return ok(await this.ownerService.updateListing(req.user.id, listingId, body));
  }

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

  @Post("listings/:listing_id/submit")
  async submit(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: { agree_terms: boolean }
  ) {
    return ok(await this.ownerService.submitListing(req.user.id, listingId, body.agree_terms));
  }

  @Post("contact-unlocks/:unlock_id/responded")
  async markResponded(
    @Req() req: { user: { id: string } },
    @Param("unlock_id") unlockId: string,
    @Body() body: { channel: "call" | "whatsapp" | "sms" }
  ) {
    return ok(await this.contactsService.markOwnerResponded(req.user.id, unlockId, body.channel));
  }
}
