import { Body, Controller, Get, Inject, Param, Patch, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { LeadsService } from "./leads.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class LeadsController {
  constructor(@Inject(LeadsService) private readonly leadsService: LeadsService) {}

  @Get("owner/leads")
  @Roles("owner", "pg_operator")
  async getLeads(
    @AuthUser() user: { sub: string },
    @Query() query: { status?: string; page?: string }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    return ok(await this.leadsService.getOwnerLeads(user.sub, query.status, page));
  }

  @Get("owner/leads/stats")
  @Roles("owner", "pg_operator")
  async getStats(@AuthUser() user: { sub: string }) {
    return ok(await this.leadsService.getLeadStats(user.sub));
  }

  @Patch("owner/leads/:id/status")
  @Roles("owner", "pg_operator")
  async updateStatus(
    @AuthUser() user: { sub: string },
    @Param("id") leadId: string,
    @Body() body: { status: string; notes?: string }
  ) {
    return ok(await this.leadsService.updateLeadStatus(leadId, user.sub, body.status, body.notes));
  }

  @Get("owner/leads/export")
  @Roles("owner", "pg_operator")
  async exportCsv(@AuthUser() user: { sub: string }, @Res() res: Response) {
    const csv = await this.leadsService.exportLeadsCsv(user.sub);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
    res.send(csv);
  }
}
