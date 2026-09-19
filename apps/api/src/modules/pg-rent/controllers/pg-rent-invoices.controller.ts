import { Body, Controller, Get, Inject, Param, Patch, Query, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import { RentInvoiceListFiltersSchema } from "../dto/invoice.dto";
import { RentTenantOverridesSchema } from "../dto/tenant.dto";
import { assertRentFlag } from "../services/rent-guards";
import { RentInvoiceService } from "../services/rent-invoice.service";

@Controller("pg-operator/properties/:propertyId/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentInvoicesController {
  constructor(@Inject(RentInvoiceService) private readonly invoices: RentInvoiceService) {}

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
}
