import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { AdminLeadsController } from "./admin-leads.controller";
import { LeadsService } from "./leads.service";

@Module({
  controllers: [LeadsController, AdminLeadsController],
  providers: [LeadsService],
  exports: [LeadsService]
})
export class LeadsModule {}
