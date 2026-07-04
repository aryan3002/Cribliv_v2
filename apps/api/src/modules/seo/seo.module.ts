import { Module } from "@nestjs/common";
import { SeoController } from "./seo.controller";
import { SeoAggregatesService } from "./seo-aggregates.service";
import { SeoCityConfigService } from "./seo-city-config.service";
import { SeoCopyService } from "./seo-copy.service";

@Module({
  controllers: [SeoController],
  providers: [SeoAggregatesService, SeoCityConfigService, SeoCopyService],
  exports: [SeoAggregatesService, SeoCityConfigService, SeoCopyService]
})
export class SeoModule {}
