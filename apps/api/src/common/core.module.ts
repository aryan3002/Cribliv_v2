import { Global, Module } from "@nestjs/common";
import { AppStateService } from "./app-state.service";
import { DatabaseService } from "./database.service";
import { IdempotencyService } from "./idempotency.service";

@Global()
@Module({
  providers: [AppStateService, DatabaseService, IdempotencyService],
  exports: [AppStateService, DatabaseService, IdempotencyService]
})
export class CoreModule {}
