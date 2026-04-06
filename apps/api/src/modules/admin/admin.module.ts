import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [AdminController],
  providers: [AdminAnalyticsService]
})
export class AdminModule {}
