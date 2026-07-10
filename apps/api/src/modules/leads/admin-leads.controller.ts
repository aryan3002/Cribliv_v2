import { Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";

/**
 * Ops tooling for the callback guarantee: the rescue queue lists leads about
 * to breach the 24h promise so the Cribliv team can call the tenant themselves
 * (spec §3.3). It doubles as the unresponsive-owner report.
 */
@Controller("admin/leads")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminLeadsController {
  constructor(@Inject(LeadsService) private readonly leadsService: LeadsService) {}

  @Get("rescue-queue")
  async rescueQueue() {
    return ok(await this.leadsService.getRescueQueue());
  }

  @Post(":id/team-called")
  async teamCalled(@Param("id") leadId: string) {
    return ok(await this.leadsService.teamMarkCalled(leadId));
  }
}
