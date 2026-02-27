import { Module } from "@nestjs/common";
import { SearchModule } from "../search/search.module";
import { VoiceController } from "./voice.controller";
import { VoiceService } from "./voice.service";

@Module({
  imports: [SearchModule],
  controllers: [VoiceController],
  providers: [VoiceService],
  exports: [VoiceService]
})
export class VoiceModule {}
