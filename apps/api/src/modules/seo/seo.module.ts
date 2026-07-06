import { Module } from "@nestjs/common";
import { SeoController } from "./seo.controller";
import { SeoAggregatesService } from "./seo-aggregates.service";
import { SeoCityConfigService } from "./seo-city-config.service";
import { SeoCopyService } from "./seo-copy.service";
import { GoogleServiceAuth } from "./google/google-service-auth";
import { IndexingService } from "./indexing.service";
import { GscService } from "./gsc.service";

@Module({
  controllers: [SeoController],
  providers: [
    SeoAggregatesService,
    SeoCityConfigService,
    SeoCopyService,
    GoogleServiceAuth,
    IndexingService,
    GscService
  ],
  exports: [
    SeoAggregatesService,
    SeoCityConfigService,
    SeoCopyService,
    GoogleServiceAuth,
    IndexingService,
    GscService
  ]
})
export class SeoModule {}
