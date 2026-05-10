import { Module } from "@nestjs/common";
import { MapController } from "./map.controller";
import { MapService } from "./map.service";
import { MetroWalkService } from "./metro-walk.service";

@Module({
  controllers: [MapController],
  providers: [MapService, MetroWalkService],
  exports: [MapService, MetroWalkService]
})
export class MapModule {}
