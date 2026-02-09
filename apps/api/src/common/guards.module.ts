import { Global, Module } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { RolesGuard } from "./roles.guard";

@Global()
@Module({
  providers: [AuthGuard, RolesGuard],
  exports: [AuthGuard, RolesGuard]
})
export class GuardsModule {}
