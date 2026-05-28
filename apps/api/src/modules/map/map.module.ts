import { Module } from "@nestjs/common";
import { MapController } from "./map.controller";
import { MapService } from "./map.service";
import { MetroWalkService } from "./metro-walk.service";
import { SeekerTagsService } from "./seeker-tags.service";
import { CommuteService } from "./commute.service";

@Module({
  controllers: [MapController],
  providers: [MapService, MetroWalkService, SeekerTagsService, CommuteService],
  exports: [MapService, MetroWalkService, SeekerTagsService, CommuteService]
})
export class MapModule {}
