import { Controller, Get, Inject } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { ok } from "../../common/response";

@Controller("health")
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Get()
  async health() {
    let db = "disabled";

    if (this.database.isEnabled()) {
      try {
        await this.database.query("SELECT 1");
        db = "up";
      } catch {
        db = "down";
      }
    }

    return ok({
      status: "ok",
      db,
      ts: new Date().toISOString()
    });
  }
}
