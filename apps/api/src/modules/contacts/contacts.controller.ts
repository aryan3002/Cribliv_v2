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
    @Body() body: { listing_id: string; source?: string }
  ) {
    const idempotencyKey = requireIdempotencyKey(req.headers["idempotency-key"]);
    return ok(
      await this.contactsService.unlockContact(
        req.user.id,
        body.listing_id,
        idempotencyKey,
        sanitizeSource(body.source)
      )
    );
  }
}

// Attribution tag for what drove the unlock (e.g. 'blog-2bhk-rent-in-noida').
// Bounded + charset-restricted so it's safe to store and group on.
function sanitizeSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().slice(0, 120);
  return /^[a-z0-9][a-z0-9:_-]*$/i.test(s) ? s : null;
}
