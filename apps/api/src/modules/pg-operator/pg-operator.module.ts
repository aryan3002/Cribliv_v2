import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { LeadsModule } from "../leads/leads.module";
import { AnalyticsModule } from "../analytics/analytics.module";
import { PgOperatorController } from "./pg-operator.controller";
import { PgListingController } from "./pg-listing.controller";
import { PgDashboardController } from "./pg-dashboard.controller";
import { PgPublicController } from "./pg-public.controller";
import { PgInterestController } from "./pg-interest.controller";
import { PgLeadsController } from "./pg-leads.controller";
import { PgSegmentationService } from "./services/pg-segmentation.service";
import { PgPropertiesService } from "./services/pg-properties.service";
import { PgListingService } from "./services/pg-listing.service";
import { PgSearchService } from "./services/pg-search.service";
import { PgDashboardService } from "./services/pg-dashboard.service";
import { PgAnalyticsService } from "./services/pg-analytics.service";
import {
  PgListingsSliceAdapter,
  AnalyticsSliceAdapter,
  LeadsSliceAdapter
} from "./services/dashboard-adapters";

// No OwnerModule: PG is a self-contained bounded context after the split — it
// owns its listing write (PgListingService) and its dashboard read (pg_listings).
@Module({
  imports: [CoreModule, GuardsModule, LeadsModule, AnalyticsModule],
  controllers: [
    PgOperatorController,
    PgListingController,
    PgDashboardController,
    PgPublicController,
    PgInterestController,
    PgLeadsController
  ],
  providers: [
    PgSegmentationService,
    PgPropertiesService,
    PgListingService,
    PgSearchService,
    PgAnalyticsService,
    PgListingsSliceAdapter,
    AnalyticsSliceAdapter,
    LeadsSliceAdapter,
    {
      provide: PgDashboardService,
      useFactory: (o: PgListingsSliceAdapter, a: AnalyticsSliceAdapter, l: LeadsSliceAdapter) =>
        new PgDashboardService(o, a, l),
      inject: [PgListingsSliceAdapter, AnalyticsSliceAdapter, LeadsSliceAdapter]
    }
  ],
  exports: [PgSegmentationService, PgPropertiesService, PgListingService, PgDashboardService]
})
export class PgOperatorModule {}
