import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Optional,
  Param,
  Post,
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
import { ForfeitSchema, SettleSchema } from "../dto/settlement.dto";
import { assertRentFlag } from "../services/rent-guards";
import { RentSettlementService } from "../services/rent-settlement.service";

const PASSTHROUGH_IDEMPOTENCY = {
  run: (_: unknown, __: unknown, ___: unknown, fn: () => Promise<unknown>) => fn()
};

@Controller("pg-operator/properties/:propertyId/rent/tenants/:assignmentId")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentSettlementController {
  constructor(
    @Inject(RentSettlementService) private readonly settlement: RentSettlementService,
    @Optional() @Inject(IdempotencyService) private readonly idem: IdempotencyService | undefined
  ) {}

  @Get("settlement")
  async statement(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("assignmentId") assignmentId: string
  ) {
    assertRentFlag();
    return ok(await this.settlement.statement(user.id, propertyId, assignmentId));
  }

  @Post("settle")
  async settle(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("assignmentId") assignmentId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const key = requireIdempotencyKey(idempotencyKey);
    const input = parseOrThrow(SettleSchema, body);
    return ok(
      await (this.idem ?? PASSTHROUGH_IDEMPOTENCY).run(
        user.id,
        `pg-rent:${propertyId}:settle:${assignmentId}`,
        key,
        () => this.settlement.settle(user.id, propertyId, assignmentId, input, key)
      )
    );
  }

  @Post("forfeit")
  async forfeit(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("assignmentId") assignmentId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(ForfeitSchema, body);
    return ok(await this.settlement.forfeit(user.id, propertyId, assignmentId, input));
  }
}
