import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { AdminLeadsController } from "./admin-leads.controller";
import { LeadsService } from "./leads.service";
import { AdminLeadOpsService } from "./admin-lead-ops.service";

@Module({
  controllers: [LeadsController, AdminLeadsController],
  providers: [LeadsService, AdminLeadOpsService],
  exports: [LeadsService, AdminLeadOpsService]
})
export class LeadsModule {}
