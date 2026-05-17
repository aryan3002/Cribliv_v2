import { Module } from "@nestjs/common";
import { CoreModule } from "../../common/core.module";
import { GuardsModule } from "../../common/guards.module";

@Module({
  imports: [CoreModule, GuardsModule],
  controllers: [],
  providers: [],
  exports: []
})
export class RentAgreementModule {}
