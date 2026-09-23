import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { IdempotencyService } from "../../../common/idempotency.service";
import { requireIdempotencyKey } from "../../../common/idempotency.util";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import {
  AllocationsPatchSchema,
  ClaimPaymentSchema,
  ConfirmPaymentSchema,
  RecordPaymentSchema,
  RefundSchema,
  RejectPaymentSchema,
  ReversePaymentSchema
} from "../dto/payment.dto";
import { assertRentFlag } from "../services/rent-guards";
import { RentPaymentService } from "../services/rent-payment.service";
import { RentReceiptService } from "../services/rent-receipt.service";

const PASSTHROUGH_IDEMPOTENCY = {
  run: (_: unknown, __: unknown, ___: unknown, fn: () => Promise<unknown>) => fn()
};

@Controller("pg-operator/properties/:propertyId/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentPaymentsController {
  constructor(
    @Inject(RentPaymentService) private readonly payments: RentPaymentService,
    @Inject(RentReceiptService) private readonly receipts: RentReceiptService,
    @Optional() @Inject(IdempotencyService) private readonly idem: IdempotencyService | undefined
  ) {}

  @Get("payments")
  async list(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query() query: unknown
  ) {
    assertRentFlag();
    const filters = parseOrThrow(
      z.object({
        assignment_id: z.string().uuid().optional(),
        status: z.string().optional(),
        direction: z.enum(["inflow", "outflow"]).optional()
      }),
      query ?? {}
    );
    return ok(await this.payments.list(user.id, propertyId, filters));
  }

  @Post("payments")
  async record(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const key = requireIdempotencyKey(idempotencyKey);
    const input = parseOrThrow(RecordPaymentSchema, body);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-rent:${propertyId}:payments`,
        key,
        () => this.payments.recordByOperator(user.id, propertyId, input, key)
      )
    );
  }

  @Post("payments/confirm-bulk")
  async confirmBulk(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }), body);
    return ok(await this.payments.confirmBulk(user.id, propertyId, input.ids));
  }

  @Post("payments/:id/confirm")
  async confirm(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(ConfirmPaymentSchema, body);
    return ok(await this.payments.confirm(user.id, propertyId, id, input));
  }

  @Post("payments/:id/reject")
  async reject(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(RejectPaymentSchema, body);
    return ok(await this.payments.reject(user.id, propertyId, id, input.reason));
  }

  @Post("payments/:id/reverse")
  async reverse(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(ReversePaymentSchema, body);
    return ok(await this.payments.reverse(user.id, propertyId, id, input.reason));
  }

  @Patch("payments/:id/allocations")
  async reallocate(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(AllocationsPatchSchema, body);
    return ok(await this.payments.reallocate(user.id, propertyId, id, input.allocations));
  }

  @Post("refunds")
  async refund(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const key = requireIdempotencyKey(idempotencyKey);
    const input = parseOrThrow(RefundSchema, body);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-rent:${propertyId}:refunds`,
        key,
        () => this.payments.recordRefund(user.id, propertyId, input, key)
      )
    );
  }

  @Get("receipts/:id/download")
  async download(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.receipts.downloadUrl(user.id, propertyId, id));
  }

  @Post("receipts/:id/retry")
  async retry(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.receipts.retry(user.id, propertyId, id));
  }

  @Post("receipts/:id/share-token")
  async share(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.receipts.regenerateShareToken(user.id, propertyId, id));
  }
}
