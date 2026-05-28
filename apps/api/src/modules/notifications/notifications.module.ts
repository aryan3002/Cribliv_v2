import { Module } from "@nestjs/common";
import { WhatsAppClient } from "./whatsapp.client";
import { NotificationService } from "./notification.service";

@Module({
  providers: [WhatsAppClient, NotificationService],
  exports: [NotificationService, WhatsAppClient]
})
export class NotificationsModule {}
