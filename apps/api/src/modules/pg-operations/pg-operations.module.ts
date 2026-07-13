import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { PgOperatorModule } from "../pg-operator/pg-operator.module";
import { PgAdminManageController } from "./pg-admin-manage.controller";
import { PgManageRequestController } from "./pg-manage-request.controller";
import { PgPropertyOpsController } from "./pg-property-ops.controller";
import { PgLayoutService } from "./services/pg-layout.service";
import { PgManageRequestService } from "./services/pg-manage-request.service";
import { PgOccupancyService } from "./services/pg-occupancy.service";

@Module({
  imports: [CoreModule, GuardsModule, PgOperatorModule],
  controllers: [PgManageRequestController, PgAdminManageController, PgPropertyOpsController],
  providers: [PgManageRequestService, PgLayoutService, PgOccupancyService],
  exports: [PgManageRequestService, PgLayoutService, PgOccupancyService]
})
export class PgOperationsModule {}
