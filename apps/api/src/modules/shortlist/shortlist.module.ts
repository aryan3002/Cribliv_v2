import { Module } from "@nestjs/common";
import { ShortlistController } from "./shortlist.controller";

@Module({
  controllers: [ShortlistController]
})
export class ShortlistModule {}
