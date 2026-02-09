import { Module } from "@nestjs/common";
import { OwnerController } from "./owner.controller";
import { OwnerService } from "./owner.service";
import { ContactsModule } from "../contacts/contacts.module";

@Module({
  imports: [ContactsModule],
  controllers: [OwnerController],
  providers: [OwnerService]
})
export class OwnerModule {}
