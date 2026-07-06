import { Module } from "@nestjs/common";
import { SeoController } from "./seo.controller";
import { SeoAggregatesService } from "./seo-aggregates.service";
import { SeoCityConfigService } from "./seo-city-config.service";
import { SeoCopyService } from "./seo-copy.service";
import { GoogleServiceAuth } from "./google/google-service-auth";
import { IndexingService } from "./indexing.service";

@Module({
  controllers: [SeoController],
  providers: [
    SeoAggregatesService,
    SeoCityConfigService,
    SeoCopyService,
    GoogleServiceAuth,
    IndexingService
  ],
  exports: [
    SeoAggregatesService,
    SeoCityConfigService,
    SeoCopyService,
    GoogleServiceAuth,
    IndexingService
  ]
})
export class SeoModule {}
