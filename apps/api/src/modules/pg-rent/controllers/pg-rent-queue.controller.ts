import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { isIsoDate, todayIst } from "../../../common/date";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow } from "../dto/common";
import { firstOfMonth } from "../pure/rent-dates";
import { assertRentFlag } from "../services/rent-guards";
import { RentMessageService } from "../services/rent-message.service";
import { RentQueueService } from "../services/rent-queue.service";
import { RentTenantService } from "../services/rent-tenant.service";

@Controller("pg-operator/properties/:propertyId/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentQueueController {
  constructor(
    @Inject(RentQueueService) private readonly queue: RentQueueService,
    @Inject(RentMessageService) private readonly messages: RentMessageService,
    @Inject(RentTenantService) private readonly tenants: RentTenantService
  ) {}
  @Get("queue") async getQueue(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string
  ) {
    assertRentFlag();
    return ok(await this.queue.queue(user.id, propertyId));
  }
  @Get("summary") async summary(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query("month") month?: string
  ) {
    assertRentFlag();
    const m =
      parseOrThrow(z.object({ month: z.string().refine(isIsoDate).optional() }), { month }).month ??
      firstOfMonth(todayIst());
    return ok(await this.queue.monthSummary(user.id, propertyId, m));
  }
  @Get("invoices/:id/messages") async messagesFor(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.messages.messagesForInvoice(user.id, propertyId, id));
  }
  @Post("messages/preview") async preview(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(
      z.object({
        key: z.enum(["reminder", "overdue", "tenant_paid", "receipt_share"]),
        text: z.string().max(600),
        invoice_id: z.string().uuid().optional()
      }),
      body
    );
    return ok(await this.messages.preview(user.id, propertyId, input));
  }
  @Post("invoices/:id/reminder-opened") async reminderOpened(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(
      z.object({
        stage: z.enum(["upcoming", "due_soon", "due_today", "overdue"]),
        channel: z.enum(["whatsapp", "call"])
      }),
      body
    );
    await this.messages.reminderOpened(user.id, propertyId, id, input);
    return ok({ ok: true });
  }
  @Post("invoices/:id/pay-token") async payToken(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") id: string
  ) {
    assertRentFlag();
    return ok(await this.messages.regeneratePayToken(user.id, propertyId, id));
  }
  @Post("tenants/:assignmentId/identity-dispute/resolve") async resolveDispute(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("assignmentId") assignmentId: string
  ) {
    assertRentFlag();
    await this.tenants.resolveDispute(user.id, propertyId, assignmentId);
    return ok({ ok: true });
  }
}
