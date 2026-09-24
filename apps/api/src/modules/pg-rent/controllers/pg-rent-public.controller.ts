import { Controller, Get, Header, Inject, NotFoundException, Param, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";

import { ok } from "../../../common/response";
import { assertRentFlag } from "../services/rent-guards";
import { RentPayInstructionService } from "../services/rent-pay-instruction.service";
import { RentReceiptService } from "../services/rent-receipt.service";

@Controller("public/pg-rent")
export class PgRentPublicController {
  constructor(
    @Inject(RentPayInstructionService) private readonly pay: RentPayInstructionService,
    @Inject(RentReceiptService) private readonly receipts: RentReceiptService
  ) {}

  @Get("pay/:token")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header("Cache-Control", "no-store")
  async payPage(@Param("token") token: string) {
    assertRentFlag();
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new NotFoundException({ code: "pay_link_not_found" });
    return ok(await this.pay.publicPayPage(token));
  }

  @Get("receipts/:shareToken")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header("Cache-Control", "no-store")
  async receipt(@Param("shareToken") shareToken: string, @Res() res: Response) {
    assertRentFlag();
    if (!/^[A-Za-z0-9_-]{43}$/.test(shareToken))
      throw new NotFoundException({ code: "receipt_not_found" });
    const dl = await this.receipts.resolveShareToken(shareToken);
    res.redirect(302, dl.url);
  }
}
