import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminAnalyticsService } from "./admin-analytics.service";
import { AdminOpsService } from "./admin-ops.service";
import { AdminOwnerHealthService } from "./admin-owner-health.service";
import { AdminRevenueService } from "./admin-revenue.service";
import { AdminFraudFeedService } from "./admin-fraud-feed.service";
import { AdminRentAgreementService } from "./admin-rent-agreement.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { RentAgreementModule } from "../rent-agreement/rent-agreement.module";

@Module({
  // RentAgreementModule is imported for the RENT_AGREEMENT_SAS_ISSUER token
  // (AdminRentAgreementService issues admin PDF download links).
  imports: [NotificationsModule, RentAgreementModule],
  controllers: [AdminController],
  providers: [
    AdminAnalyticsService,
    AdminOpsService,
    AdminOwnerHealthService,
    AdminRevenueService,
    AdminFraudFeedService,
    AdminRentAgreementService
  ]
})
export class AdminModule {}
