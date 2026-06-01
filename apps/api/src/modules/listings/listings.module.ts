import { Module } from "@nestjs/common";
import { ListingsController } from "./listings.controller";
import { AnalyticsModule } from "../analytics/analytics.module";

@Module({
  imports: [AnalyticsModule],
  controllers: [ListingsController]
})
export class ListingsModule {}
