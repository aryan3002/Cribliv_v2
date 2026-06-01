import { Controller, Inject, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { AuthUser } from "../../common/auth-user.decorator";
import type { UserContext } from "../../common/types";
import { ok } from "../../common/response";
import { PgListingService } from "./services/pg-listing.service";
import { LeadsService } from "../leads/leads.service";

/**
 * Free tenant "I'm interested" on a PG listing. Any authenticated user may
 * express interest (no role gate — a session carries one role and we must not
 * block owner/operator users who browse PGs). Looks up the listing's operator
 * and creates a free lead (no contact_unlock_id) via the existing 7-day-dedup
 * LeadsService. This is the tenant-free half of the inverted lead model.
 */
@Controller("pg")
@UseGuards(AuthGuard)
export class PgInterestController {
  constructor(
    @Inject(PgListingService) private readonly listings: PgListingService,
    @Inject(LeadsService) private readonly leads: LeadsService
  ) {}

  @Post("listings/:id/interest")
  async interest(@AuthUser() user: UserContext, @Param("id") id: string) {
    const operatorId = await this.listings.getActiveListingOperator(id);
    if (!operatorId) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: "listing_not_found: no active PG listing with that id"
      });
    }
    if (operatorId === user.id) {
      return ok({ interested: false, created: false, reason: "self" });
    }
    const { lead_id, created } = await this.leads.createLead({
      listing_id: id,
      owner_user_id: operatorId,
      tenant_user_id: user.id
    });
    return ok({ interested: true, created, lead_id });
  }
}
