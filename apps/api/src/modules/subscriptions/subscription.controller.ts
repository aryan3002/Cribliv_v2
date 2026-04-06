import { Body, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { SubscriptionService } from "./subscription.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { AuthUser } from "../../common/auth-user.decorator";

@Controller()
export class SubscriptionController {
  constructor(
    @Inject(SubscriptionService) private readonly subscriptionService: SubscriptionService
  ) {}

  @Get("owner/subscription/plans")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("owner", "pg_operator")
  async getPlans() {
    return ok(await this.subscriptionService.getPlans());
  }

  @Post("owner/subscription")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("owner", "pg_operator")
  async createSubscriptionOrder(
    @AuthUser() user: { sub: string },
    @Body() body: { plan_id: string }
  ) {
    return ok(await this.subscriptionService.createSubscriptionOrder(user.sub, body.plan_id));
  }

  @Get("owner/subscription")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("owner", "pg_operator")
  async getActiveSubscription(@AuthUser() user: { sub: string }) {
    return ok(await this.subscriptionService.getActiveSubscription(user.sub));
  }
}
