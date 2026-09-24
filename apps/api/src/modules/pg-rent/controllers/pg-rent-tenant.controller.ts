import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import { IdentityDisputeSchema } from "../dto/tenant-reads.dto";
import { assertRentFlag } from "../services/rent-guards";
import { RentMessageService } from "../services/rent-message.service";
import { RentTenantService } from "../services/rent-tenant.service";

@Controller("tenant/pg-rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("tenant")
export class PgRentTenantController {
  constructor(
    @Inject(RentTenantService) private readonly tenants: RentTenantService,
    @Inject(RentMessageService) private readonly messages: RentMessageService
  ) {}
  @Get("summary") async summary(@AuthUser() user: UserContext) {
    assertRentFlag();
    return ok(await this.tenants.summary(user.id));
  }
  @Get("history") async history(
    @AuthUser() user: UserContext,
    @Query("assignment") assignment?: string
  ) {
    assertRentFlag();
    const { assignment: id } = parseOrThrow(z.object({ assignment: z.string().uuid() }), {
      assignment
    });
    return ok(await this.tenants.history(user.id, id));
  }
  @Get("invoices/:id") async invoice(@AuthUser() user: UserContext, @Param("id") id: string) {
    assertRentFlag();
    return ok(await this.tenants.invoice(user.id, id));
  }
  @Post("identity-dispute") async dispute(@AuthUser() user: UserContext, @Body() body: unknown) {
    assertRentFlag();
    const input = parseOrThrow(IdentityDisputeSchema, body);
    return ok(await this.tenants.identityDispute(user.id, input.assignment_id));
  }
  @Post("claims/:id/notify-message") async notify(
    @AuthUser() user: UserContext,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.messages.tenantPaidMessage(user.id, id));
  }
}
