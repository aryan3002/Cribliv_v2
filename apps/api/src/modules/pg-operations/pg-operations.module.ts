import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PgOperatorModule } from "../pg-operator/pg-operator.module";
import { PgAdminManageController } from "./pg-admin-manage.controller";
import { PgManageRequestController } from "./pg-manage-request.controller";
import { PgPropertyOpsController } from "./pg-property-ops.controller";
import { PgBedAssignmentService } from "./services/pg-bed-assignment.service";
import { PgLayoutService } from "./services/pg-layout.service";
import { PgManageRequestService } from "./services/pg-manage-request.service";
import { PgOccupancyService } from "./services/pg-occupancy.service";

@Module({
  imports: [CoreModule, GuardsModule, PgOperatorModule, NotificationsModule],
  controllers: [PgManageRequestController, PgAdminManageController, PgPropertyOpsController],
  providers: [PgManageRequestService, PgLayoutService, PgOccupancyService, PgBedAssignmentService],
  exports: [PgManageRequestService, PgLayoutService, PgOccupancyService, PgBedAssignmentService]
})
export class PgOperationsModule {}
