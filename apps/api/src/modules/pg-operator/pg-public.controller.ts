import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req
} from "@nestjs/common";
import type { Request } from "express";
import { randomUUID } from "node:crypto";
import { ok } from "../../common/response";
import { PgListingService } from "./services/pg-listing.service";
import { PgSearchService } from "./services/pg-search.service";
import { PgAnalyticsService } from "./services/pg-analytics.service";
import { PgSearchEventDto } from "./dto/pg-analytics.dto";

/**
 * Public, unauthenticated tenant-facing PG reads. The `/pg/*` namespace is the
 * tenant side of the split (operator reads live under `/pg-operator/*`, guarded).
 * Only ACTIVE listings are exposed — draft/pending/paused never leak publicly.
 */
@Controller("pg")
export class PgPublicController {
  constructor(
    @Inject(PgSearchService) private readonly search: PgSearchService,
    @Inject(PgListingService) private readonly listings: PgListingService,
    @Inject(PgAnalyticsService) private readonly analytics: PgAnalyticsService
  ) {}

  @Get("listings")
  async list(@Query() query: Record<string, string | undefined>) {
    return ok(await this.search.search(query));
  }

  @Get("suggest")
  async suggest(@Query() query: { q?: string; limit?: string }) {
    const limit = Math.min(Math.max(Number(query.limit) || 8, 1), 20);
    return ok(await this.search.suggest(query.q ?? "", limit));
  }

  @Get("preview")
  async preview(@Query() query: { type?: string; value?: string }) {
    return ok(await this.search.preview(query.type ?? "city", query.value ?? ""));
  }

  @Get("listings/:id")
  async detail(@Param("id") id: string) {
    const detail = await this.listings.getPublicListingDetail(id);
    if (!detail) {
      throw new NotFoundException({
        code: "listing_not_found",
        message: "listing_not_found: no active PG listing with that id"
      });
    }
    return ok(detail);
  }

  // Fire-and-forget tenant funnel sink. ALWAYS 200 — analytics must never break
  // the page. Unauthenticated (tenants have no session); global throttler applies.
  @Post("analytics/search")
  @HttpCode(200)
  trackSearch(@Body() body: PgSearchEventDto, @Req() req: Request) {
    try {
      const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
      void this.analytics.trackSearch({
        ...body,
        session_id: body.session_id || `anon-${randomUUID()}`,
        ip: fwd || req.ip,
        user_agent: req.headers["user-agent"]
      });
    } catch {
      // never propagate
    }
    return ok({ tracked: true });
  }
}
