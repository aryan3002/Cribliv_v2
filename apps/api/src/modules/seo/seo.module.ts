import { Module } from "@nestjs/common";
import { SeoController } from "./seo.controller";
import { SeoAggregatesService } from "./seo-aggregates.service";
import { SeoCopyService } from "./seo-copy.service";

@Module({
  controllers: [SeoController],
  providers: [SeoAggregatesService, SeoCopyService],
  exports: [SeoAggregatesService, SeoCopyService]
})
export class SeoModule {}
