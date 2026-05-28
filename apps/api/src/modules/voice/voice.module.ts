import { Module } from "@nestjs/common";
import { SearchModule } from "../search/search.module";
import { OwnerModule } from "../owner/owner.module";
import { VoiceController } from "./voice.controller";
import { VoiceService } from "./voice.service";

@Module({
  imports: [SearchModule, OwnerModule],
  controllers: [VoiceController],
  providers: [VoiceService],
  exports: [VoiceService]
})
export class VoiceModule {}
