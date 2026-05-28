import { Module } from "@nestjs/common";
import { BoostController } from "./boost.controller";
import { BoostService } from "./boost.service";

@Module({
  controllers: [BoostController],
  providers: [BoostService],
  exports: [BoostService]
})
export class BoostModule {}
