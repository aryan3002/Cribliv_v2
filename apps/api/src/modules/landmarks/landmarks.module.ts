import { Module } from "@nestjs/common";
import { LandmarksController } from "./landmarks.controller";
import { LandmarksService } from "./landmarks.service";

@Module({
  controllers: [LandmarksController],
  providers: [LandmarksService],
  exports: [LandmarksService]
})
export class LandmarksModule {}
