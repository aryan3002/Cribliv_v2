import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { OwnerModule } from "../owner/owner.module";
import { LeadsModule } from "../leads/leads.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { PgOperatorController } from "./pg-operator.controller";
import { PgListingController } from "./pg-listing.controller";
import { PgDashboardController } from "./pg-dashboard.controller";
import { PgSegmentationService } from "./services/pg-segmentation.service";
import { PgPropertiesService } from "./services/pg-properties.service";
import { PgListingService } from "./services/pg-listing.service";
import { PgDashboardService } from "./services/pg-dashboard.service";
import {
  OwnerSliceAdapter,
  AnalyticsSliceAdapter,
  LeadsSliceAdapter
} from "./services/dashboard-adapters";

@Module({
  imports: [CoreModule, GuardsModule, OwnerModule, LeadsModule, AnalyticsModule],
  controllers: [PgOperatorController, PgListingController, PgDashboardController],
  providers: [
    PgSegmentationService,
    PgPropertiesService,
    PgListingService,
    OwnerSliceAdapter,
    AnalyticsSliceAdapter,
    LeadsSliceAdapter,
    {
      provide: PgDashboardService,
      useFactory: (o: OwnerSliceAdapter, a: AnalyticsSliceAdapter, l: LeadsSliceAdapter) =>
        new PgDashboardService(o, a, l),
      inject: [OwnerSliceAdapter, AnalyticsSliceAdapter, LeadsSliceAdapter]
    }
  ],
  exports: [PgSegmentationService, PgPropertiesService, PgListingService, PgDashboardService]
})
export class PgOperatorModule {}
