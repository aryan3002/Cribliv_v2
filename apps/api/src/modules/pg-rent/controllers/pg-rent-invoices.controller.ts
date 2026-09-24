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
  ApplyFeeSchema,
  CancelInvoiceSchema,
  EligibilitySchema,
  ExtendDueSchema,
  IssueDraftSchema,
  LineInputSchema,
  LinePatchSchema,
  WaiveFeeSchema
} from "../dto/invoice-actions.dto";
import { BackfillSchema, ManualInvoiceSchema } from "../dto/payment.dto";
import { RentInvoiceListFiltersSchema } from "../dto/invoice.dto";
import { RentTenantOverridesSchema } from "../dto/tenant.dto";
import { assertRentFlag } from "../services/rent-guards";
import { RentInvoiceService } from "../services/rent-invoice.service";

const PASSTHROUGH_IDEMPOTENCY = {
  run: (_: unknown, __: unknown, ___: unknown, fn: () => Promise<unknown>) => fn()
};

@Controller("pg-operator/properties/:propertyId/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentInvoicesController {
  constructor(
    @Inject(RentInvoiceService) private readonly invoices: RentInvoiceService,
    @Optional() @Inject(IdempotencyService) private readonly idem: IdempotencyService | undefined
  ) {}

  @Get("invoices")
  async list(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query() query: unknown
  ) {
    assertRentFlag();
    return ok(
      await this.invoices.list(
        user.id,
        propertyId,
        parseOrThrow(RentInvoiceListFiltersSchema, query ?? {})
      )
    );
  }

  @Get("invoices/:id")
  async get(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.invoices.get(user.id, propertyId, id));
  }

  @Get("invoices/:id/events")
  async events(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.invoices.events(user.id, propertyId, id));
  }

  @Patch("tenants/:assignmentId")
  async overrides(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("assignmentId") assignmentId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    await this.invoices.updateTenantOverrides(
      user.id,
      propertyId,
      assignmentId,
      parseOrThrow(RentTenantOverridesSchema, body)
    );
    return ok({ ok: true });
  }

  @Post("invoices")
  async create(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const key = requireIdempotencyKey(idempotencyKey);
    const bodyRecord = body as Record<string, unknown>;
    const { source, ...rest } = bodyRecord;

    if (source === "backfill") {
      const input = parseOrThrow(BackfillSchema, rest);
      return ok(
        await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
          user.id,
          `pg-rent:${propertyId}:invoices`,
          key,
          () => this.invoices.createBackfill(user.id, propertyId, input, key)
        )
      );
    } else {
      const input = parseOrThrow(ManualInvoiceSchema, rest);
      return ok(
        await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
          user.id,
          `pg-rent:${propertyId}:invoices`,
          key,
          () => this.invoices.createManual(user.id, propertyId, input, key)
        )
      );
    }
  }

  @Post("invoices/:id/issue")
  async issue(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(IssueDraftSchema, body);
    return ok(await this.invoices.issueDraft(user.id, propertyId, id, input));
  }

  @Post("invoices/:id/lines")
  async addLine(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(LineInputSchema, body);
    return ok(await this.invoices.addLine(user.id, propertyId, id, input));
  }

  @Patch("invoices/:id/lines/:lineId")
  async updateLine(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(LinePatchSchema, body);
    return ok(await this.invoices.updateLine(user.id, propertyId, id, lineId, input));
  }

  @Delete("invoices/:id/lines/:lineId")
  async removeLine(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Param("lineId") lineId: string
  ) {
    assertRentFlag();
    return ok(await this.invoices.removeLine(user.id, propertyId, id, lineId));
  }

  @Post("invoices/:id/extend-due")
  async extendDue(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(ExtendDueSchema, body);
    return ok(await this.invoices.extendDue(user.id, propertyId, id, input.due_date));
  }

  @Post("invoices/:id/cancel")
  async cancel(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(CancelInvoiceSchema, body);
    return ok(await this.invoices.cancel(user.id, propertyId, id, input.reason));
  }

  @Post("invoices/:id/late-fee/apply")
  async applyFee(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(ApplyFeeSchema, body);
    return ok(await this.invoices.applyFee(user.id, propertyId, id, input.amount_inr));
  }

  @Post("invoices/:id/late-fee/waive")
  async waiveFee(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(WaiveFeeSchema, body);
    return ok(await this.invoices.waiveFee(user.id, propertyId, id, input.reason));
  }

  @Patch("invoices/:id/late-fee/eligibility")
  async setEligibility(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(EligibilitySchema, body);
    return ok(await this.invoices.setEligibility(user.id, propertyId, id, input.late_fee_eligible));
  }

  @Post("late-fees/waive-all")
  async waiveAllFees(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(WaiveFeeSchema, body);
    return ok(await this.invoices.waiveAllFees(user.id, propertyId, input.reason));
  }

  @Post("invoices/:id/reprorate")
  async applyReprorate(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.invoices.applyReprorate(user.id, propertyId, id));
  }

  @Post("invoices/:id/reprorate/dismiss")
  async dismissReprorate(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.invoices.dismissReprorate(user.id, propertyId, id));
  }

  @Post("invoices/:id/reprorate/restore")
  async restoreReprorate(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.invoices.restoreReprorate(user.id, propertyId, id));
  }
}
