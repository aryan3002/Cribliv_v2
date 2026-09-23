import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards
} from "@nestjs/common";
import type { PgRentEnablePreview } from "@cribliv/shared-types";

import { AuthGuard } from "../../../common/auth.guard";
import { AuthUser } from "../../../common/auth-user.decorator";
import { todayIst } from "../../../common/date";
import { ok } from "../../../common/response";
import { Roles } from "../../../common/roles.decorator";
import { RolesGuard } from "../../../common/roles.guard";
import type { UserContext } from "../../../common/types";
import { parseOrThrow, toIsoDate } from "../dto/common";
import {
  RentEnableInputSchema,
  RentPatchSettingsInputSchema,
  RentResumeInputSchema,
  settingsInputToColumns
} from "../dto/settings.dto";
import { assertManagedOwnership, assertRentFlag, requireDb } from "../services/rent-guards";
import {
  RentInvoiceEngineService,
  type EngineSettings
} from "../services/rent-invoice-engine.service";
import { RentSettingsService } from "../services/rent-settings.service";
import { DatabaseService } from "../../../common/database.service";

const GENERATE_NOW_WINDOW_MS = 5 * 60 * 1000;

@Controller("pg-operator/properties/:propertyId/rent")
@UseGuards(AuthGuard, RolesGuard)
@Roles("pg_operator")
export class PgRentSettingsController {
  /** Per-process rate limit for Generate now (spec §5.1). Multi-instance deployments get one window per instance; acceptable for a 5-minute courtesy limit. */
  private readonly lastGenerateNow = new Map<string, number>();

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(RentSettingsService) private readonly settings: RentSettingsService,
    @Inject(RentInvoiceEngineService) private readonly engine: RentInvoiceEngineService
  ) {}

  @Get("settings")
  async get(@AuthUser() user: UserContext, @Param("propertyId") propertyId: string) {
    assertRentFlag();
    return ok(await this.settings.get(user.id, propertyId));
  }

  @Get("enable/preview")
  async enablePreview(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query() query: unknown
  ) {
    assertRentFlag();
    return ok(await this.preview(user.id, propertyId, query));
  }

  @Post("enable")
  async enable(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const input = parseOrThrow(RentEnableInputSchema, body);
    const settings = await this.settings.enable(user.id, propertyId, input);
    const generated = await this.engine.generateInvoicesForProperty(propertyId, todayIst(), {
      id: user.id,
      role: "pg_operator"
    });
    return ok({ settings, generated });
  }

  @Patch("settings")
  async patch(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    return ok(
      await this.settings.patch(
        user.id,
        propertyId,
        parseOrThrow(RentPatchSettingsInputSchema, body)
      )
    );
  }

  @Post("pause")
  async pause(@AuthUser() user: UserContext, @Param("propertyId") propertyId: string) {
    assertRentFlag();
    return ok(await this.settings.pause(user.id, propertyId));
  }

  @Get("resume/preview")
  async resumePreview(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Query() query: unknown
  ) {
    assertRentFlag();
    return ok(await this.preview(user.id, propertyId, query));
  }

  @Post("resume")
  async resume(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Body() body: unknown
  ) {
    assertRentFlag();
    const settings = await this.settings.resume(
      user.id,
      propertyId,
      parseOrThrow(RentResumeInputSchema, body)
    );
    const generated = await this.engine.generateInvoicesForProperty(propertyId, todayIst(), {
      id: user.id,
      role: "pg_operator"
    });
    return ok({ settings, generated });
  }

  @Post("generate-now")
  async generateNow(@AuthUser() user: UserContext, @Param("propertyId") propertyId: string) {
    assertRentFlag();
    requireDb(this.db);
    await assertManagedOwnership(this.db, user.id, propertyId);
    const last = this.lastGenerateNow.get(propertyId) ?? 0;
    if (Date.now() - last < GENERATE_NOW_WINDOW_MS) {
      throw new HttpException(
        { code: "generate_rate_limited", message: "Try again in a few minutes" },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
    this.lastGenerateNow.set(propertyId, Date.now());
    return ok(
      await this.engine.generateInvoicesForProperty(propertyId, todayIst(), {
        id: user.id,
        role: "pg_operator"
      })
    );
  }

  /**
   * Preview works before AND after enabling: query params override the stored
   * row (or the seeded defaults when no row exists). Query values arrive as
   * strings; coerce the few the wizard sends.
   */
  private async preview(
    operatorId: string,
    propertyId: string,
    rawQuery: unknown
  ): Promise<PgRentEnablePreview> {
    requireDb(this.db);
    await assertManagedOwnership(this.db, operatorId, propertyId);
    const q = (rawQuery ?? {}) as Record<string, string | undefined>;
    const input = parseOrThrow(RentEnableInputSchema, {
      ...(q.billing_starts_on ? { billing_starts_on: q.billing_starts_on } : {}),
      ...(q.cycle_mode ? { cycle_mode: q.cycle_mode } : {}),
      ...(q.billing_timing ? { billing_timing: q.billing_timing } : {}),
      ...(q.due_day ? { due_day: Number(q.due_day) } : {}),
      ...(q.proration_mode ? { proration_mode: q.proration_mode } : {}),
      ...(q.prorate_move_out ? { prorate_move_out: q.prorate_move_out === "true" } : {}),
      ...(q.invoice_lead_days ? { invoice_lead_days: Number(q.invoice_lead_days) } : {})
    });
    const stored = await this.settings.getRow(this.db, propertyId);
    const defaults = await this.settings.defaultsFor(this.db, propertyId);
    const today = todayIst();
    const { billing_starts_on, ...rest } = input;
    const overrides = settingsInputToColumns(rest) as Partial<EngineSettings>;
    const effective: EngineSettings = {
      cycle_mode: "calendar_month",
      billing_timing: "advance",
      due_day: defaults.due_day,
      proration_mode: "actual_days",
      prorate_move_out: false,
      invoice_lead_days: 5,
      default_line_items: [],
      receipt_prefix: defaults.receipt_prefix,
      enabled_on: today,
      ...(stored ?? {}),
      ...overrides,
      billing_starts_on:
        billing_starts_on ?? (stored ? (toIsoDate(stored.billing_starts_on) as string) : today)
    };
    return this.engine.previewForProperty(propertyId, effective, today);
  }
}
