import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";
import type { Response } from "express";
import { AuthGuard } from "../../common/auth.guard";
import { DatabaseService } from "../../common/database.service";
import { ok } from "../../common/response";
import { Roles } from "../../common/roles.decorator";
import { RolesGuard } from "../../common/roles.guard";
import type { UserContext } from "../../common/types";
import { IndexingService } from "../seo/indexing.service";
import { SeoSearchService } from "../seo/seo-search.service";
import type { SearchPerformanceParams } from "../seo/seo-search.service";

function parseSearchPerformanceQuery(query: {
  city_slug?: string;
  locale?: string;
  quick_wins?: string;
  limit?: string;
  offset?: string;
}): SearchPerformanceParams {
  return {
    city_slug: query.city_slug || undefined,
    locale: query.locale || undefined,
    quick_wins: query.quick_wins === "true" ? true : undefined,
    limit: query.limit ? Number(query.limit) : undefined,
    offset: query.offset ? Number(query.offset) : undefined
  };
}

@Controller("admin/seo")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminSeoSearchController {
  constructor(
    @Inject(SeoSearchService) private readonly seoSearch: SeoSearchService,
    @Inject(IndexingService) private readonly indexing: IndexingService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  @Get("search-performance")
  async searchPerformance(
    @Query()
    query: {
      city_slug?: string;
      locale?: string;
      quick_wins?: string;
      limit?: string;
      offset?: string;
    }
  ) {
    return ok(await this.seoSearch.getSearchPerformance(parseSearchPerformanceQuery(query)));
  }

  @Get("search-performance/export")
  async exportSearchPerformance(
    @Query() query: { city_slug?: string; locale?: string; quick_wins?: string },
    @Res() res: Response
  ) {
    const csv = await this.seoSearch.exportSearchPerformanceCsv(parseSearchPerformanceQuery(query));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="search-performance.csv"');
    res.send(csv);
  }

  @Get("coverage")
  async coverage() {
    return ok(await this.seoSearch.getCoverage());
  }

  @Get("indexing-queue")
  async indexingQueue(@Query() query: { status?: string; limit?: string; offset?: string }) {
    const [{ items, total }, summary] = await Promise.all([
      this.indexing.listQueue({
        status: query.status,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined
      }),
      this.seoSearch.getIndexingQueueSummary()
    ]);
    return ok({ items, total, summary });
  }

  @Post("indexing-queue")
  async submitUrl(
    @Req() req: { user: UserContext },
    @Body() body: { url?: string; reason?: string }
  ) {
    if (!body?.url || typeof body.url !== "string") {
      throw new BadRequestException({ code: "invalid_url", message: "url is required" });
    }

    const row = await this.indexing.enqueue(body.url, body.reason ?? "manual_admin_submit");
    if (!row) {
      throw new BadRequestException({
        code: "db_disabled",
        message: "Database is required to submit an indexing URL"
      });
    }

    await this.database
      .query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
         VALUES ($1::uuid, 'seo_indexing_queue'::admin_target_type, $2::uuid, 'submit_indexing_url'::admin_action_type, $3, null, $4::jsonb)`,
        [req.user.id, row.id, body.reason ?? null, JSON.stringify(row)]
      )
      .catch(() => undefined);

    return ok(row);
  }

  @Post("indexing-queue/:id/retry")
  @HttpCode(200)
  async retryUrl(@Req() req: { user: UserContext }, @Param("id") id: string) {
    const row = await this.indexing.retry(id);
    if (!row) {
      throw new NotFoundException({
        code: "indexing_queue_row_not_found",
        message: `No indexing queue row: ${id}`
      });
    }

    await this.database
      .query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
         VALUES ($1::uuid, 'seo_indexing_queue'::admin_target_type, $2::uuid, 'retry_indexing_url'::admin_action_type, null, null, $3::jsonb)`,
        [req.user.id, row.id, JSON.stringify(row)]
      )
      .catch(() => undefined);

    return ok(row);
  }
}
