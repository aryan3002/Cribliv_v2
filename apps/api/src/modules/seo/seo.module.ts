import { Module } from "@nestjs/common";
import { SeoController } from "./seo.controller";
import { SeoAggregatesService } from "./seo-aggregates.service";
import { SeoPlacesService } from "./seo-places.service";
import { SeoCityConfigService } from "./seo-city-config.service";
import { SeoCopyService } from "./seo-copy.service";
import { GoogleServiceAuth } from "./google/google-service-auth";
import { IndexingService } from "./indexing.service";
import { GscService } from "./gsc.service";
import { SeoSearchService } from "./seo-search.service";

@Module({
  controllers: [SeoController],
  providers: [
    SeoAggregatesService,
    SeoPlacesService,
    SeoCityConfigService,
    SeoCopyService,
    GoogleServiceAuth,
    IndexingService,
    GscService,
    SeoSearchService
  ],
  exports: [
    SeoAggregatesService,
    SeoPlacesService,
    SeoCityConfigService,
    SeoCopyService,
    GoogleServiceAuth,
    IndexingService,
    GscService,
    SeoSearchService
  ]
})
export class SeoModule {}
