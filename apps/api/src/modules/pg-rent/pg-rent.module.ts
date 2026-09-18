import { Module } from "@nestjs/common";

import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";
import { RentSettingsService } from "./services/rent-settings.service";

// Providers and controllers are appended by later tasks in this plan; the
// arrays start empty so the module can be registered (and AppModule boot
// tested) before any service exists.
@Module({
  imports: [CoreModule, GuardsModule],
  controllers: [],
  providers: [RentSettingsService],
  exports: [RentSettingsService]
})
export class PgRentModule {}
