import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
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
import { toAbsoluteSeoUrl } from "../seo/seo-urls";
import { BlogBriefService } from "./blog-brief.service";
import { BlogGeneratorService } from "./blog-generator.service";
import { BlogTopicPlannerService } from "./blog-topic-planner.service";
import type { BlogBriefRow, BlogFaqItem, BlogPostType, BlogStatus } from "./blog.types";
import { BlogService } from "./blog.service";

type BlogAction = "blog_approve" | "blog_publish" | "blog_archive" | "blog_edit" | "blog_generate";

type GenerateNowBody = {
  brief_id?: string;
  target_keyword?: string;
  city_slug?: string;
  category_slug?: string;
};

function manualBrief(input: {
  id: string;
  targetKeyword: string;
  citySlug?: string | null;
  categorySlug?: string | null;
  postType?: BlogPostType;
}): BlogBriefRow {
  return {
    id: input.id,
    target_keyword: input.targetKeyword,
    intent: null,
    outline: [],
    required_data: [],
    internal_link_targets: input.citySlug
      ? [{ href: `/rent-in/${input.citySlug}`, label: `Rentals in ${input.citySlug}` }]
      : [],
    source: "manual",
    status: "generating",
    city_slug: input.citySlug ?? null,
    category_slug: input.categorySlug ?? "market-updates",
    post_type: input.postType ?? "evergreen",
    notes: null,
    created_at: "",
    updated_at: ""
  };
}

@Controller("admin/blog")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminBlogController {
  constructor(
    @Inject(BlogService) private readonly blog: BlogService,
    @Inject(BlogGeneratorService) private readonly generator: BlogGeneratorService,
    @Inject(BlogBriefService) private readonly briefs: BlogBriefService,
    @Inject(BlogTopicPlannerService) private readonly planner: BlogTopicPlannerService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  private async audit(adminId: string, targetId: string, action: BlogAction, after: unknown) {
    const normalizedTarget = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      targetId
    )
      ? targetId
      : deterministicUuidV5(targetId);
    await this.database
      .query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
         VALUES ($1::uuid, 'blog_post'::admin_target_type, $2::uuid, $3::admin_action_type, null, null, $4::jsonb)`,
        [adminId, normalizedTarget, action, JSON.stringify(after ?? {})]
      )
      .catch(() => undefined);
  }

  @Get()
  async list(@Query("status") status?: string) {
    const items = await this.blog.listForAdmin({ status: (status as BlogStatus) || undefined });
    return ok({ items });
  }

  @Get(":id")
  async getOne(@Param("id") id: string) {
    const post = await this.blog.getById(id);
    if (!post) {
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    }
    return ok({ post });
  }

  @Post(":id/approve")
  async approve(@Req() req: { user: UserContext }, @Param("id") id: string) {
    const row = await this.blog.transition(id, "in_review");
    if (!row) {
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    }
    await this.audit(req.user.id, id, "blog_approve", { status: row.status });
    logTelemetry("admin.blog_approved", { admin_user_id: req.user.id, post_id: id });
    return ok(row);
  }

  @Post(":id/publish")
  async publish(@Req() req: { user: UserContext }, @Param("id") id: string) {
    const current = await this.blog.getById(id);
    if (!current) {
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    }
    if (!["in_review", "draft"].includes(current.status)) {
      throw new BadRequestException({
        code: "invalid_publish_state",
        message: `Cannot publish from status '${current.status}'`
      });
    }

    const row = await this.blog.transition(id, "published");
    if (!row) {
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    }

    await this.enqueuePublishSideEffects(id, row.slug);
    await this.audit(req.user.id, id, "blog_publish", { status: row.status, slug: row.slug });
    logTelemetry("admin.blog_published", {
      admin_user_id: req.user.id,
      post_id: id,
      slug: row.slug
    });
    return ok(row);
  }

  @Post(":id/archive")
  async archive(@Req() req: { user: UserContext }, @Param("id") id: string) {
    const row = await this.blog.transition(id, "archived");
    if (!row) {
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    }
    await this.audit(req.user.id, id, "blog_archive", { status: row.status });
    logTelemetry("admin.blog_archived", { admin_user_id: req.user.id, post_id: id });
    return ok(row);
  }

  @Patch(":id")
  async edit(
    @Req() req: { user: UserContext },
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      meta_title?: string | null;
      meta_description?: string | null;
      excerpt?: string | null;
      body_en?: string | null;
      body_hi?: string | null;
      faq_items?: BlogFaqItem[];
      hero_image_path?: string | null;
    }
  ) {
    const row = await this.blog.updateEditable(id, {
      title: body.title,
      meta_title: body.meta_title,
      meta_description: body.meta_description,
      excerpt: body.excerpt,
      body_en: body.body_en,
      body_hi: body.body_hi,
      faq_items: body.faq_items,
      hero_image_path: body.hero_image_path
    });
    if (!row) {
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    }
    await this.audit(req.user.id, id, "blog_edit", { edited_fields: Object.keys(body) });
    logTelemetry("admin.blog_edited", { admin_user_id: req.user.id, post_id: id });
    return ok(row);
  }

  @Post("plan")
  async plan(
    @Req() req: { user: UserContext },
    @Body() body: { city_slugs?: string[]; max_briefs?: number }
  ) {
    const result = await this.planner.planTopics({
      citySlugs: body.city_slugs,
      maxBriefs: body.max_briefs
    });
    await this.audit(req.user.id, "blog-plan", "blog_generate", result);
    logTelemetry("admin.blog_planned", { admin_user_id: req.user.id, ...result });
    return ok(result);
  }

  @Post("generate-now")
  async generateNow(@Req() req: { user: UserContext }, @Body() body: GenerateNowBody) {
    const brief = await this.resolveBrief(body);
    const generated = await this.generator.generate(brief);
    if (!generated) {
      throw new BadRequestException({
        code: "generation_failed",
        message: "The generator could not produce a post"
      });
    }

    const status: "draft" | "needs_attention" = generated.quality.passed
      ? "draft"
      : "needs_attention";
    const row = await this.blog.upsertDraft({
      slug: generated.slug,
      title: generated.title,
      meta_title: generated.metaTitle,
      meta_description: generated.metaDescription,
      excerpt: generated.excerpt,
      body_en: generated.bodyEn,
      body_hi: generated.bodyHi,
      target_keyword: generated.targetKeyword,
      intent: generated.intent,
      city_slug: generated.citySlug,
      category_slug: generated.categorySlug,
      generated_by: "manual",
      status,
      quality_score: generated.quality.score,
      quality_breakdown: generated.quality,
      faq_items: generated.faqItems,
      sources: generated.sources,
      data_asof: generated.dataAsof,
      script: "en",
      brief_id: brief.id
    });
    await this.briefs.markDone(brief.id).catch(() => undefined);
    await this.audit(req.user.id, row.id, "blog_generate", {
      status: row.status,
      quality_score: generated.quality.score
    });
    logTelemetry("admin.blog_generated_now", {
      admin_user_id: req.user.id,
      post_id: row.id,
      gate_passed: generated.quality.passed
    });
    return ok(row);
  }

  private async resolveBrief(body: GenerateNowBody): Promise<BlogBriefRow> {
    if (body.brief_id) {
      const brief = await this.briefs.getById(body.brief_id);
      if (!brief) {
        throw new BadRequestException({
          code: "blog_brief_not_found",
          message: "No blog brief found for brief_id"
        });
      }
      return brief;
    }
    if (!body.target_keyword) {
      throw new BadRequestException({
        code: "missing_brief",
        message: "Provide brief_id or target_keyword"
      });
    }

    const postType: BlogPostType =
      body.category_slug === "data-reports" ? "data_report" : "evergreen";
    const created = await this.briefs
      .createBrief({
        target_keyword: body.target_keyword,
        source: "manual",
        city_slug: body.city_slug ?? null,
        category_slug: body.category_slug ?? "market-updates",
        post_type: postType,
        internal_link_targets: body.city_slug
          ? [{ href: `/rent-in/${body.city_slug}`, label: `Rentals in ${body.city_slug}` }]
          : []
      })
      .catch(() => null);

    return (
      created ??
      manualBrief({
        id: deterministicUuidV5(`adhoc:${body.target_keyword}`),
        targetKeyword: body.target_keyword,
        citySlug: body.city_slug,
        categorySlug: body.category_slug,
        postType
      })
    );
  }

  private async enqueuePublishSideEffects(id: string, slug: string): Promise<void> {
    await this.database
      .query(
        `INSERT INTO outbound_events (event_type, aggregate_type, aggregate_id, dedupe_key, payload, status, next_attempt_at)
         VALUES ('seo.embed_blog', 'blog_post', $1::uuid, $2, $3::jsonb, 'pending', now())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [id, `blog_embed:${id}`, JSON.stringify({ blog_post_id: id })]
      )
      .catch(() => undefined);

    const url = toAbsoluteSeoUrl(`/en/blog/${slug}`);
    await this.database
      .query(
        `INSERT INTO seo_indexing_queue (url, reason)
         SELECT $1, 'blog_published'
         WHERE to_regclass('public.seo_indexing_queue') IS NOT NULL
         ON CONFLICT (url) DO UPDATE SET
           status = 'pending',
           reason = 'blog_published',
           updated_at = now()`,
        [url]
      )
      .catch(() => undefined);
  }
}
