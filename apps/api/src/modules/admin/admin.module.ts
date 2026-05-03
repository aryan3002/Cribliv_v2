import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { AdminOpsService } from "./admin-ops.service";
import { AdminOwnerHealthService } from "./admin-owner-health.service";
import { AdminRevenueService } from "./admin-revenue.service";
import { AdminFraudFeedService } from "./admin-fraud-feed.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [AdminController],
  providers: [
    AdminAnalyticsService,
    AdminOpsService,
    AdminOwnerHealthService,
    AdminRevenueService,
    AdminFraudFeedService
  ]
})
export class AdminModule {}
