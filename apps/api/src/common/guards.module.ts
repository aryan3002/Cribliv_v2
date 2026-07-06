import { Global, Module } from "@nestjs/common";
import { ApiKeyGuard } from "./api-key.guard";
import { AuthGuard } from "./auth.guard";
import { RolesGuard } from "./roles.guard";

@Global()
@Module({
  providers: [AuthGuard, RolesGuard, ApiKeyGuard],
  exports: [AuthGuard, RolesGuard, ApiKeyGuard]
})
export class GuardsModule {}
