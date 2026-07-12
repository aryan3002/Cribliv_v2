import { Body, Controller, Get, Post, Param, Query, Req, Inject, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { ok } from "../../common/response";
import { LeadsService } from "./leads.service";
import { AdminLeadOpsService } from "./admin-lead-ops.service";
import { sanitizeBoardParams } from "./board-params";

@Controller("admin/leads")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminLeadsController {
  constructor(
    @Inject(LeadsService) private readonly leadsService: LeadsService,
    @Inject(AdminLeadOpsService) private readonly ops: AdminLeadOpsService
  ) {}

  @Get("board")
  async board(
    @Query("filter") filter?: string,
    @Query("owner_id") ownerId?: string,
    @Query("state") state?: string,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("range") range?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string
  ) {
    return ok(
      await this.ops.getBoard(
        sanitizeBoardParams({
          filter,
          owner_id: ownerId,
          state,
          status,
          q,
          range,
          page,
          page_size: pageSize
        })
      )
    );
  }

  @Get("rescue-queue")
  async rescueQueue() {
    return ok(await this.leadsService.getRescueQueue());
  }

  @Get("analytics")
  async analytics(@Query("range") range?: string) {
    return ok(await this.ops.getAnalytics(range ?? "30 days"));
  }

  @Get(":id/timeline")
  async timeline(@Param("id") leadId: string) {
    return ok(await this.ops.getTimeline(leadId));
  }

  @Post(":id/team-called")
  async teamCalled(@Param("id") leadId: string, @Req() req: { user: { id: string } }) {
    return ok(await this.leadsService.teamMarkCalled(leadId, req.user.id));
  }

  @Post(":id/refund")
  async refund(
    @Param("id") leadId: string,
    @Req() req: { user: { id: string } },
    @Body() body: { reason?: string }
  ) {
    return ok(
      await this.ops.refundLead(leadId, req.user.id, body?.reason ?? "admin manual refund")
    );
  }

  @Post(":id/nudge-owner")
  async nudge(@Param("id") leadId: string, @Req() req: { user: { id: string } }) {
    return ok(await this.ops.nudgeOwner(leadId, req.user.id));
  }
}
