import { Controller, Get, Inject, UseGuards } from "@nestjs/common";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { assertRentFlag } from "../services/rent-guards";
import { RentQueueService } from "../services/rent-queue.service";

@Controller("pg-operator/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentPortfolioController {
  constructor(@Inject(RentQueueService) private readonly queue: RentQueueService) {}
  @Get("portfolio") async portfolio(@AuthUser() user: UserContext) {
    assertRentFlag();
    return ok(await this.queue.portfolio(user.id));
  }
}
