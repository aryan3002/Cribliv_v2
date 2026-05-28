import { Global, Module } from "@nestjs/common";
import { AppStateService } from "./app-state.service";
import { DatabaseService } from "./database.service";

@Global()
@Module({
  providers: [AppStateService, DatabaseService],
  exports: [AppStateService, DatabaseService]
})
export class CoreModule {}
