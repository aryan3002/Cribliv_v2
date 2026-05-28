import { Body, Controller, Headers, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import { SalesService, SalesLeadSource } from "./sales.service";

@Controller("sales")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "pg_operator", "admin")
export class SalesController {
  constructor(@Inject(SalesService) private readonly salesService: SalesService) {}

  @Post("leads")
  async createLead(
    @Req() req: { user: { id: string } },
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body()
    body: {
      source: SalesLeadSource;
      listing_id?: string;
      notes?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    const lead = await this.salesService.createLead({
      createdByUserId: req.user.id,
      listingId: body.listing_id,
      source: body.source,
      notes: body.notes,
      metadata: body.metadata ?? {},
      idempotencyKey
    });
    return ok(lead);
  }
}
