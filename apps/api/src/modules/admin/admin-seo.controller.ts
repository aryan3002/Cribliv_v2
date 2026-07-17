import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
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
import { SeoAggregatesService } from "../seo/seo-aggregates.service";
import { SeoCityConfigService } from "../seo/seo-city-config.service";
import { type GeneratedCopy, SeoCopyService } from "../seo/seo-copy.service";
import type { ToggleSeoCityDto } from "./dto/toggle-seo-city.dto";

const LOCALES = ["en", "hi"] as const;
const MIN_LISTINGS = 3;
const MAX_FAQ = 6;
const CAPS = {
  h1: 200,
  meta_title: 200,
  meta_description: 400,
  intro_paragraph: 4000,
  nearby_blurb: 2000
} as const;

type SeoCopyAction =
  | "seo_copy_generate"
  | "seo_copy_generate_batch"
  | "seo_copy_override"
  | "seo_copy_revert";

/**
 * Validate a hand-written override payload into the strict GeneratedCopy shape.
 * Throws BadRequestException on bad input. Null/missing string fields become
 * "" (a partial override still merges over template defaults on render).
 */
function validateOverrideCopy(raw: unknown): GeneratedCopy {
  if (!raw || typeof raw !== "object") {
    throw new BadRequestException({ code: "invalid_copy", message: "copy object is required" });
  }
  const c = raw as Record<string, unknown>;
  const str = (v: unknown, name: string, max: number): string => {
    if (v == null) return "";
    if (typeof v !== "string") {
      throw new BadRequestException({
        code: "invalid_copy_field",
        message: `${name} must be a string`
      });
    }
    if (v.length > max) {
      throw new BadRequestException({
        code: "invalid_copy_field",
        message: `${name} exceeds ${max} characters`
      });
    }
    return v;
  };

  const faqRaw = c.faq_items ?? [];
  if (!Array.isArray(faqRaw)) {
    throw new BadRequestException({ code: "invalid_faq", message: "faq_items must be an array" });
  }
  if (faqRaw.length > MAX_FAQ) {
    throw new BadRequestException({
      code: "too_many_faq",
      message: `faq_items must not exceed ${MAX_FAQ} items`
    });
  }
  const faq_items = faqRaw.map((f) => {
    if (!f || typeof f !== "object") {
      throw new BadRequestException({
        code: "invalid_faq_item",
        message: "each faq item needs a q and a"
      });
    }
    const item = f as Record<string, unknown>;
    if (typeof item.q !== "string" || typeof item.a !== "string") {
      throw new BadRequestException({
        code: "invalid_faq_item",
        message: "each faq item needs a string q and a"
      });
    }
    return { q: item.q, a: item.a };
  });

  return {
    h1: str(c.h1, "h1", CAPS.h1),
    meta_title: str(c.meta_title, "meta_title", CAPS.meta_title),
    meta_description: str(c.meta_description, "meta_description", CAPS.meta_description),
    intro_paragraph: str(c.intro_paragraph, "intro_paragraph", CAPS.intro_paragraph),
    nearby_blurb:
      c.nearby_blurb == null ? null : str(c.nearby_blurb, "nearby_blurb", CAPS.nearby_blurb),
    faq_items
  };
}

@Controller("admin/seo")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminSeoController {
  constructor(
    @Inject(SeoCityConfigService) private readonly cityConfig: SeoCityConfigService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SeoAggregatesService) private readonly aggregates: SeoAggregatesService,
    @Inject(SeoCopyService) private readonly copy: SeoCopyService
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

  /**
   * Copy provenance (override / ai / template) per locale for every locality in
   * a city — powers the copy-status chips in the city review drawer.
   */
  @Get("copy-status")
  async copyStatus(@Query("citySlug") citySlug?: string) {
    const city = citySlug?.trim();
    if (!city) {
      throw new BadRequestException({ code: "missing_city_slug", message: "citySlug is required" });
    }
    const localities = await this.aggregates.localitiesForCity(city);
    const items: Array<{ slug: string; en: string; hi: string }> = [];
    for (const loc of localities) {
      const pagePath = `/city/${city}/${loc.slug}`;
      const [en, hi] = await Promise.all([
        this.copy.getProvenance(pagePath, "en"),
        this.copy.getProvenance(pagePath, "hi")
      ]);
      items.push({ slug: loc.slug, en, hi });
    }
    return ok({ items });
  }

  /**
   * Force-(re)generate AI copy for a single locality, both locales. Uses
   * generateAndCache so it refreshes the AI cache even when a manual override
   * is live (the override still wins on render).
   */
  @Post("copy/generate-one")
  @HttpCode(200)
  async generateOne(
    @Req() req: { user: UserContext },
    @Body() body: { citySlug?: string; localitySlug?: string }
  ) {
    const citySlug = body?.citySlug?.trim();
    const localitySlug = body?.localitySlug?.trim();
    if (!citySlug || !localitySlug) {
      throw new BadRequestException({
        code: "missing_slugs",
        message: "citySlug and localitySlug are required"
      });
    }
    const locality = await this.aggregates.findLocality(citySlug, localitySlug);
    if (!locality) {
      throw new NotFoundException({
        code: "locality_not_found",
        message: `Unknown locality: ${citySlug}/${localitySlug}`
      });
    }
    const agg = await this.aggregates.aggregatesForLocality(citySlug, localitySlug);
    const pagePath = `/city/${citySlug}/${localitySlug}`;
    const result: Record<(typeof LOCALES)[number], GeneratedCopy | null> = { en: null, hi: null };
    for (const locale of LOCALES) {
      result[locale] = await this.copy.generateAndCache({
        pagePath,
        locale,
        placeName: { en: locality.name_en, hi: locality.name_hi },
        placeKind: "locality",
        aggregates: {
          ...agg,
          nearest_metro: null,
          parent_locality: locality.parent_locality_slug ?? null
        }
      });
    }
    await this.audit(req.user.id, pagePath, "seo_copy_generate", null, { citySlug, localitySlug });
    logTelemetry("admin.seo_copy_generated", { admin_user_id: req.user.id, page_path: pagePath });
    return ok(result);
  }

  /** Upsert a manual override for a locality page + locale. */
  @Put("copy/override")
  async putOverride(
    @Req() req: { user: UserContext },
    @Body()
    body: {
      citySlug?: string;
      localitySlug?: string;
      locale?: string;
      copy?: unknown;
      notes?: string | null;
    }
  ) {
    const citySlug = body?.citySlug?.trim();
    const localitySlug = body?.localitySlug?.trim();
    if (!citySlug || !localitySlug) {
      throw new BadRequestException({
        code: "missing_slugs",
        message: "citySlug and localitySlug are required"
      });
    }
    if (body.locale !== "en" && body.locale !== "hi") {
      throw new BadRequestException({
        code: "invalid_locale",
        message: "locale must be 'en' or 'hi'"
      });
    }
    const overrideCopy = validateOverrideCopy(body.copy);
    const notes = body.notes == null ? null : String(body.notes).slice(0, CAPS.nearby_blurb);
    const pagePath = `/city/${citySlug}/${localitySlug}`;
    await this.copy.upsertOverride(pagePath, body.locale, overrideCopy, notes);
    await this.audit(req.user.id, pagePath, "seo_copy_override", notes, { locale: body.locale });
    logTelemetry("admin.seo_copy_overridden", {
      admin_user_id: req.user.id,
      page_path: pagePath,
      locale: body.locale
    });
    return ok({ page_path: pagePath, locale: body.locale });
  }

  /** Remove a manual override (revert to AI copy, else template). */
  @Delete("copy/override")
  async deleteOverride(
    @Req() req: { user: UserContext },
    @Query("path") path?: string,
    @Query("locale") locale?: string
  ) {
    const pagePath = path?.trim();
    if (!pagePath) {
      throw new BadRequestException({ code: "missing_path", message: "path is required" });
    }
    const loc = locale === "hi" ? "hi" : "en";
    await this.copy.deleteOverride(pagePath, loc);
    await this.audit(req.user.id, pagePath, "seo_copy_revert", null, { locale: loc });
    logTelemetry("admin.seo_copy_reverted", {
      admin_user_id: req.user.id,
      page_path: pagePath,
      locale: loc
    });
    return ok({ page_path: pagePath, locale: loc });
  }

  /**
   * City-scoped "generate all missing" — generate + store AI copy for
   * localities with >= 3 listings that lack fresh copy, bounded by `limit`.
   * Returns a live generated/skipped count for the drawer readout.
   */
  @Post("copy/generate-batch")
  @HttpCode(200)
  async generateBatch(
    @Req() req: { user: UserContext },
    @Body() body: { citySlug?: string; limit?: number; force?: boolean }
  ) {
    const citySlug = body?.citySlug?.trim();
    if (!citySlug) {
      throw new BadRequestException({ code: "missing_city_slug", message: "citySlug is required" });
    }
    const limit = Math.min(Math.max(Number(body?.limit) || 25, 1), 100);
    const force = body?.force === true;
    let generated = 0;
    let skipped = 0;

    const localities = await this.aggregates.localitiesForCity(citySlug);
    for (const loc of localities) {
      if (generated >= limit) break;
      // localitiesForCity is ordered by listing_count DESC — once we reach a
      // thin locality the rest are thinner, so stop scanning.
      if (loc.listing_count < MIN_LISTINGS) break;

      let agg: Awaited<ReturnType<SeoAggregatesService["aggregatesForLocality"]>> | null = null;
      for (const locale of LOCALES) {
        if (generated >= limit) break;
        const pagePath = `/city/${citySlug}/${loc.slug}`;
        if (!force && (await this.copy.hasFreshCopy(pagePath, locale))) {
          skipped++;
          continue;
        }
        if (force) await this.copy.deleteCopy(pagePath, locale);
        if (!agg) agg = await this.aggregates.aggregatesForLocality(citySlug, loc.slug);
        const generatedCopy = await this.copy.getOrGenerate({
          pagePath,
          locale,
          placeName: { en: loc.name_en, hi: loc.name_hi },
          placeKind: "locality",
          aggregates: {
            ...agg,
            nearest_metro: null,
            parent_locality: loc.parent_locality_slug ?? null
          }
        });
        if (generatedCopy) generated++;
        else skipped++;
      }
    }

    await this.audit(req.user.id, citySlug, "seo_copy_generate_batch", null, {
      generated,
      skipped
    });
    logTelemetry("admin.seo_copy_batch", {
      admin_user_id: req.user.id,
      city_slug: citySlug,
      generated,
      skipped
    });
    return ok({ generated, skipped });
  }

  /** Best-effort audit row for a copy operation (mirrors the city-toggle audit). */
  private async audit(
    adminId: string,
    targetKey: string,
    action: SeoCopyAction,
    reason: string | null,
    after: unknown
  ) {
    await this.database
      .query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
         VALUES ($1::uuid, 'seo_copy'::admin_target_type, $2::uuid, $3::admin_action_type, $4, null, $5::jsonb)`,
        [adminId, deterministicUuidV5(targetKey), action, reason, JSON.stringify(after ?? null)]
      )
      .catch(() => undefined);
  }
}
