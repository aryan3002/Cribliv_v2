import { Controller, Get, Post, Param, Query, Req, Inject, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { ok } from "../../common/response";
import { LeadsService } from "./leads.service";
import { AdminLeadOpsService, BoardParams } from "./admin-lead-ops.service";
import type { AdminLeadBoardFilter } from "@cribliv/shared-types";

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
    const params: BoardParams = {
      filter: (filter as AdminLeadBoardFilter) || undefined,
      ownerId,
      state,
      status,
      q,
      range,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    };
    return ok(await this.ops.getBoard(params));
  }

  @Get("rescue-queue")
  async rescueQueue() {
    return ok(await this.leadsService.getRescueQueue());
  }

  @Get(":id/timeline")
  async timeline(@Param("id") leadId: string) {
    return ok(await this.ops.getTimeline(leadId));
  }

  @Post(":id/team-called")
  async teamCalled(@Param("id") leadId: string, @Req() req: { user: { id: string } }) {
    return ok(await this.leadsService.teamMarkCalled(leadId, req.user.id));
  }
}
