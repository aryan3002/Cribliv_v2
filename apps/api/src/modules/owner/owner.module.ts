import { Module } from "@nestjs/common";
import { OwnerController } from "./owner.controller";
import { OwnerService } from "./owner.service";
import { ContactsModule } from "../contacts/contacts.module";
import { OwnerCaptureController } from "./owner.capture.controller";
import { OwnerCaptureService } from "./owner.capture.service";
import { AzureSpeechClient } from "./azure-speech.client";
import { AzureOpenAiExtractorClient } from "./azure-openai-extractor.client";

@Module({
  imports: [ContactsModule],
  controllers: [OwnerController, OwnerCaptureController],
  providers: [OwnerService, OwnerCaptureService, AzureSpeechClient, AzureOpenAiExtractorClient]
})
export class OwnerModule {}
