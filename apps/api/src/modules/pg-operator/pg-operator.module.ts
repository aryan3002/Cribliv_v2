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
import { PgFunnelController } from "./pg-funnel.controller";
import { PgFunnelService } from "./services/pg-funnel.service";
import { PgSegmentationService } from "./services/pg-segmentation.service";
import { PgPropertiesService } from "./services/pg-properties.service";
import { PgListingService } from "./services/pg-listing.service";
import { PgScoreService } from "./services/pg-score.service";
import { PgAiAssistService } from "./services/pg-ai-assist.service";
import { PgFraudSignalsService } from "./services/pg-fraud-signals.service";
import { PgDraftService } from "./services/pg-draft.service";
import { ListingContentGeneratorService } from "../owner/listing-content-generator.service";
import { PgSearchService } from "./services/pg-search.service";
import { PgDashboardService } from "./services/pg-dashboard.service";
import { PgAnalyticsService } from "./services/pg-analytics.service";
import {
  PgListingsSliceAdapter,
  AnalyticsSliceAdapter,
  LeadsSliceAdapter,
  OverridesSliceAdapter
} from "./services/dashboard-adapters";
import { PgAnalyticsOverrideService } from "../admin/pg-analytics-override.service";
import { PgNearbyService } from "./services/pg-nearby.service";

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
    PgLeadsController,
    PgFunnelController
  ],
  providers: [
    PgSegmentationService,
    PgPropertiesService,
    PgScoreService,
    ListingContentGeneratorService,
    PgAiAssistService,
    PgFraudSignalsService,
    PgListingService,
    PgNearbyService,
    PgDraftService,
    PgSearchService,
    PgAnalyticsService,
    PgFunnelService,
    PgListingsSliceAdapter,
    AnalyticsSliceAdapter,
    LeadsSliceAdapter,
    PgAnalyticsOverrideService,
    OverridesSliceAdapter,
    {
      provide: PgDashboardService,
      useFactory: (
        o: PgListingsSliceAdapter,
        a: AnalyticsSliceAdapter,
        l: LeadsSliceAdapter,
        ov: OverridesSliceAdapter
      ) => new PgDashboardService(o, a, l, ov),
      inject: [
        PgListingsSliceAdapter,
        AnalyticsSliceAdapter,
        LeadsSliceAdapter,
        OverridesSliceAdapter
      ]
    }
  ],
  exports: [
    PgSegmentationService,
    PgPropertiesService,
    PgListingService,
    PgDashboardService,
    PgFraudSignalsService,
    PgFunnelService
  ]
})
export class PgOperatorModule {}
