import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import { ok } from "../../common/response";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { ContactsService } from "./contacts.service";

@Controller("tenant")
@UseGuards(AuthGuard, RolesGuard)
@Roles("tenant")
export class ContactsController {
  constructor(@Inject(ContactsService) private readonly contactsService: ContactsService) {}

  @Post("contact-unlocks")
  async unlock(
    @Req() req: { user: { id: string }; headers: Record<string, string> },
    @Body() body: { listing_id: string }
  ) {
    const idempotencyKey = requireIdempotencyKey(req.headers["idempotency-key"]);
    return ok(
      await this.contactsService.unlockContact(req.user.id, body.listing_id, idempotencyKey)
    );
  }
}
