import { Module } from "@nestjs/common";
import { WhatsAppClient } from "./whatsapp.client";
import { SmsClient } from "./sms.client";
import { NotificationService } from "./notification.service";

@Module({
  providers: [WhatsAppClient, SmsClient, NotificationService],
  exports: [NotificationService, WhatsAppClient, SmsClient]
})
export class NotificationsModule {}
