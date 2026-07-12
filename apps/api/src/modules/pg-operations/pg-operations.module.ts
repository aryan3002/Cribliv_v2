import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { PgOperatorModule } from "../pg-operator/pg-operator.module";
import { PgAdminManageController } from "./pg-admin-manage.controller";
import { PgManageRequestController } from "./pg-manage-request.controller";
import { PgManageRequestService } from "./services/pg-manage-request.service";

@Module({
  imports: [CoreModule, GuardsModule, PgOperatorModule],
  controllers: [PgManageRequestController, PgAdminManageController],
  providers: [PgManageRequestService],
  exports: [PgManageRequestService]
})
export class PgOperationsModule {}
