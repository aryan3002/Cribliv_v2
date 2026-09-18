import { Module } from "@nestjs/common";

import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";

// Providers and controllers are appended by later tasks in this plan; the
// arrays start empty so the module can be registered (and AppModule boot
// tested) before any service exists.
@Module({
  imports: [CoreModule, GuardsModule],
  controllers: [],
  providers: [],
  exports: []
})
export class PgRentModule {}
