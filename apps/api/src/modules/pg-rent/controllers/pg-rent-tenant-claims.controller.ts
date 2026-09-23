import { Body, Controller, Delete, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import { ClaimPaymentSchema } from "../dto/payment.dto";
import { assertRentFlag } from "../services/rent-guards";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";

@Controller("tenant/pg-rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("tenant")
export class PgRentTenantClaimsController {
  constructor(
    @Inject(RentPaymentService) private readonly payments: RentPaymentService,
    @Inject(RentReceiptService) private readonly receipts: RentReceiptService
  ) {}

  @Post("claims")
  async claim(@AuthUser() user: UserContext, @Body() body: unknown) {
    assertRentFlag();
    const input = parseOrThrow(ClaimPaymentSchema, body);
    return ok(await this.payments.claimByTenant(user.id, input));
  }

  @Delete("claims/:id")
  async cancel(@AuthUser() user: UserContext, @Param("id") id: string) {
    assertRentFlag();
    await this.payments.cancelClaim(user.id, id);
    return ok({ ok: true });
  }

  @Get("receipts/:id/download")
  async download(@AuthUser() user: UserContext, @Param("id") id: string) {
    assertRentFlag();
    return ok(await this.receipts.downloadUrlForTenant(user.id, id));
  }
}
