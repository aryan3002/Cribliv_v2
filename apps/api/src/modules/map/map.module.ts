import { Module } from "@nestjs/common";
import { MapController } from "./map.controller";
import { MapService } from "./map.service";
import { MetroWalkService } from "./metro-walk.service";
import { SeekerTagsService } from "./seeker-tags.service";

@Module({
  controllers: [MapController],
  providers: [MapService, MetroWalkService, SeekerTagsService],
  exports: [MapService, MetroWalkService, SeekerTagsService]
})
export class MapModule {}
