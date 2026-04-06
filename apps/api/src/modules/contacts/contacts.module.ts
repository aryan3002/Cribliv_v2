import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { ContactsService } from "./contacts.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { LeadsModule } from "../leads/leads.module";

@Module({
  imports: [NotificationsModule, LeadsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService]
})
export class ContactsModule {}
