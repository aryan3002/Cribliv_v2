import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";
import type { UserContext } from "../../common/types";
import { ok } from "../../common/response";
import { PgDashboardService } from "./services/pg-dashboard.service";

@Controller("pg-operator/dashboard")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgDashboardController {
  constructor(@Inject(PgDashboardService) private readonly dashboard: PgDashboardService) {}

  @Get()
  async get(@AuthUser() user: UserContext) {
    const data = await this.dashboard.getDashboard(user.id);
    return ok(data);
  }
}
