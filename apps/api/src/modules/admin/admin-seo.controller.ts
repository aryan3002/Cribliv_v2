import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Req,
  UseGuards
} from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { DatabaseService } from "../../common/database.service";
import { deterministicUuidV5 } from "../../common/deterministic-uuid";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import { logTelemetry } from "../../common/telemetry";
import type { UserContext } from "../../common/types";
import { SeoCityConfigService } from "../seo/seo-city-config.service";
import type { ToggleSeoCityDto } from "./dto/toggle-seo-city.dto";

@Controller("admin/seo")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminSeoController {
  constructor(
    @Inject(SeoCityConfigService) private readonly cityConfig: SeoCityConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  @Get("cities")
  async listCities() {
    return ok({ items: await this.cityConfig.listAllWithCounts() });
  }

  @Patch("cities/:slug")
  async toggleCity(
    @Req() req: { user: UserContext },
    @Param("slug") slug: string,
    @Body() body: ToggleSeoCityDto
  ) {
    if (!body || typeof body.programmatic_enabled !== "boolean") {
      throw new BadRequestException({
        code: "invalid_programmatic_enabled",
        message: "programmatic_enabled must be a boolean"
      });
    }
    if (body.notes != null && typeof body.notes !== "string") {
      throw new BadRequestException({
        code: "invalid_notes",
        message: "notes must be a string"
      });
    }

    const row = await this.cityConfig.setEnabled(slug, body.programmatic_enabled, body.notes);
    if (!row) {
      throw new BadRequestException({
        code: "db_disabled",
        message: "Database is required for programmatic SEO city toggles"
      });
    }

    await this.database
      .query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
         VALUES ($1::uuid, 'seo_city'::admin_target_type, $2::uuid, 'toggle_seo_city'::admin_action_type, $3, null, $4::jsonb)`,
        [req.user.id, deterministicUuidV5(slug), body.notes ?? null, JSON.stringify(row)]
      )
      .catch(() => undefined);

    logTelemetry("admin.seo_city_toggled", {
      admin_user_id: req.user.id,
      city_slug: slug,
      programmatic_enabled: row.programmatic_enabled
    });

    return ok(row);
  }
}
