import { Module } from "@nestjs/common";
import { AvailabilityAlertsController } from "./availability-alerts.controller";
import { AvailabilityAlertsService } from "./availability-alerts.service";

@Module({
  controllers: [AvailabilityAlertsController],
  providers: [AvailabilityAlertsService],
  // Exported for the admin lead-center waitlist view (Task 14) to inject and
  // call `listForListing` directly, same pattern as ContactsModule/LeadsModule.
  exports: [AvailabilityAlertsService]
})
export class AvailabilityAlertsModule {}
