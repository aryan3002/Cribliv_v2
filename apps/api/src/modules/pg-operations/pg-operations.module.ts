import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AzureBlobPhotoStorageService } from "../owner/azure-blob-photo-storage.service";
import { PgOperatorModule } from "../pg-operator/pg-operator.module";
import { PgAssignmentController } from "./pg-assignment.controller";
import { PgAdminManageController } from "./pg-admin-manage.controller";
import { PgMaintenanceController } from "./pg-maintenance.controller";
import { PgManageRequestController } from "./pg-manage-request.controller";
import { PgPropertyOpsController } from "./pg-property-ops.controller";
import { PgResidenceController } from "./pg-residence.controller";
import { PgBedAssignmentService } from "./services/pg-bed-assignment.service";
import { PgLayoutService } from "./services/pg-layout.service";
import { PgMaintenanceService } from "./services/pg-maintenance.service";
import { PgManageRequestService } from "./services/pg-manage-request.service";
import { PgOccupancyService } from "./services/pg-occupancy.service";
import { PgResidenceService } from "./services/pg-residence.service";

@Module({
  imports: [CoreModule, GuardsModule, PgOperatorModule, NotificationsModule],
  controllers: [
    PgManageRequestController,
    PgAdminManageController,
    PgPropertyOpsController,
    PgAssignmentController,
    PgMaintenanceController,
    PgResidenceController
  ],
  providers: [
    PgManageRequestService,
    PgLayoutService,
    PgOccupancyService,
    PgBedAssignmentService,
    PgResidenceService,
    PgMaintenanceService,
    AzureBlobPhotoStorageService
  ],
  exports: [
    PgManageRequestService,
    PgLayoutService,
    PgOccupancyService,
    PgBedAssignmentService,
    PgResidenceService,
    PgMaintenanceService
  ]
})
export class PgOperationsModule {}
