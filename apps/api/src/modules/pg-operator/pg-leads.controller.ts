import { Controller, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";
import type { UserContext } from "../../common/types";
import { ok } from "../../common/response";
import { LeadsService } from "../leads/leads.service";

/**
 * Operator-facing lead actions. `open` reveals a lead's real tenant contact.
 * In V1.5 this is gated behind the operator-pays plan; until that's built it is
 * dev-revealed (NODE_ENV !== 'production' or PG_LEAD_DEV_REVEAL=true), else 402.
 * See LeadsService.openLeadForOperator.
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
}
