import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule],
  controllers: [AdminController]
})
export class AdminModule {}
