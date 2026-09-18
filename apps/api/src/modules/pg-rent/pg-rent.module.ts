import { Module } from "@nestjs/common";

import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { RentAllocationService } from "./services/rent-allocation.service";
import { RentSettingsService } from "./services/rent-settings.service";

// Providers and controllers are appended by later tasks in this plan; the
// arrays start empty so the module can be registered (and AppModule boot
// tested) before any service exists.
@Module({
  imports: [CoreModule, GuardsModule],
  controllers: [],
  providers: [RentSettingsService, RentAllocationService],
  exports: [RentSettingsService, RentAllocationService]
})
export class PgRentModule {}
