import {
  BadRequestException,
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";
import type { UserContext } from "../../common/types";
import { ok } from "../../common/response";
import { LeadsService } from "../leads/leads.service";
import { UpdatePgLeadStatusSchema } from "./dto/pg-lead-status.dto";

/**
 * Operator-facing lead actions.
 * - `open` reveals a lead's real tenant contact. PG contact is free for tenants,
 *   so there is NO refund/contact-unlock paywall on this path (unlike flats).
 * - `status` moves a lead through the pipeline (kanban drag in the dashboard).
 *   Ownership + the transition graph are enforced by LeadsService.updateLeadStatus.
 */
@Controller("pg-operator/leads")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgLeadsController {
  constructor(@Inject(LeadsService) private readonly leads: LeadsService) {}

  @Post(":id/open")
  async open(@AuthUser() user: UserContext, @Param("id") id: string) {
    return ok(await this.leads.openLeadForOperator(id, user.id));
  }

  @Patch(":id/status")
  async updateStatus(
    @AuthUser() user: UserContext,
    @Param("id") id: string,
    @Body() body: unknown
  ) {
    const parsed = UpdatePgLeadStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_lead_status",
        message: parsed.error.message
      });
    }
    return ok(await this.leads.updateLeadStatus(id, user.id, parsed.data.status));
  }
}
