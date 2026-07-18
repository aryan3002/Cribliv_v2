import { Module } from "@nestjs/common";
import { DemandSignalsController } from "./demand-signals.controller";
import { DemandSignalsService } from "./demand-signals.service";

@Module({
  controllers: [DemandSignalsController],
  providers: [DemandSignalsService]
})
export class DemandSignalsModule {}
