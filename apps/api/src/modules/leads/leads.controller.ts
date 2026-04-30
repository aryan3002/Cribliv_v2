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
    @AuthUser() user: { id: string },
    @Query() query: { status?: string; page?: string; page_size?: string }
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    // Cap page_size at 200 to keep responses bounded; default 20 preserves
    // existing behaviour for clients that don't pass it.
    const pageSize = Math.min(200, Math.max(1, Number(query.page_size) || 20));
    return ok(await this.leadsService.getOwnerLeads(user.id, query.status, page, pageSize));
  }

  @Get("owner/leads/stats")
  @Roles("owner", "pg_operator")
  async getStats(@AuthUser() user: { id: string }) {
    return ok(await this.leadsService.getLeadStats(user.id));
  }

  @Patch("owner/leads/:id/status")
  @Roles("owner", "pg_operator")
  async updateStatus(
    @AuthUser() user: { id: string },
    @Param("id") leadId: string,
    @Body() body: { status: string; notes?: string }
  ) {
    return ok(await this.leadsService.updateLeadStatus(leadId, user.id, body.status, body.notes));
  }

  @Get("owner/leads/export")
  @Roles("owner", "pg_operator")
  async exportCsv(@AuthUser() user: { id: string }, @Res() res: Response) {
    const csv = await this.leadsService.exportLeadsCsv(user.id);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
    res.send(csv);
  }
}
