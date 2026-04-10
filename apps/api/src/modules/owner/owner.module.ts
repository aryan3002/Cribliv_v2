import { Module } from "@nestjs/common";
import { OwnerController } from "./owner.controller";
import { OwnerService } from "./owner.service";
import { ContactsModule } from "../contacts/contacts.module";
import { OwnerCaptureController } from "./owner.capture.controller";
import { OwnerCaptureService } from "./owner.capture.service";
import { AzureSpeechClient } from "./azure-speech.client";
import { AzureOpenAiExtractorClient } from "./azure-openai-extractor.client";
import { ListingContentGeneratorService } from "./listing-content-generator.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { AzureBlobPhotoStorageService } from "./azure-blob-photo-storage.service";

@Module({
  imports: [ContactsModule, NotificationsModule],
  controllers: [OwnerController, OwnerCaptureController],
  providers: [
    OwnerService,
    OwnerCaptureService,
    AzureSpeechClient,
    AzureOpenAiExtractorClient,
    ListingContentGeneratorService,
    AzureBlobPhotoStorageService
  ],
  exports: [AzureSpeechClient]
})
export class OwnerModule {}
