import {
  Body,
  Controller,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  ValidationPipe
} from "@nestjs/common";
import { ApiKeyGuard } from "../../common/api-key.guard";
import { ok } from "../../common/response";
import type { BlogFaqItem, BlogSource, QualityBreakdown } from "./blog.types";
import { BlogService } from "./blog.service";
import { UpsertDraftDto } from "./dto/upsert-draft.dto";

const upsertDraftPipe = new ValidationPipe({
  expectedType: UpsertDraftDto,
  transform: true,
  whitelist: true
});

@Controller("blog/drafts")
@UseGuards(ApiKeyGuard)
export class BlogInternalController {
  constructor(@Inject(BlogService) private readonly blog: BlogService) {}

  @Post()
  async upsert(@Body(upsertDraftPipe) body: UpsertDraftDto) {
    const row = await this.blog.upsertDraft({
      slug: body.slug,
      title: body.title,
      meta_title: body.meta_title ?? null,
      meta_description: body.meta_description ?? null,
      excerpt: body.excerpt ?? null,
      body_en: body.body_en ?? null,
      body_hi: body.body_hi ?? null,
      target_keyword: body.target_keyword ?? null,
      intent: body.intent ?? null,
      city_slug: body.city_slug ?? null,
      category_slug: body.category_slug ?? null,
      generated_by: body.generated_by,
      status: body.status,
      quality_score: body.quality_score ?? null,
      quality_breakdown: (body.quality_breakdown as QualityBreakdown | undefined) ?? null,
      faq_items: (body.faq_items as BlogFaqItem[] | undefined) ?? [],
      hero_image_path: body.hero_image_path ?? null,
      sources: (body.sources as BlogSource[] | undefined) ?? [],
      data_asof: body.data_asof ?? null,
      script: body.script ?? "en",
      brief_id: body.brief_id ?? null
    });
    return ok(row);
  }

  @Patch(":id")
  async patch(@Param("id") id: string, @Body() body: Partial<UpsertDraftDto>) {
    const row = await this.blog.updateEditable(id, {
      title: body.title,
      meta_title: body.meta_title ?? undefined,
      meta_description: body.meta_description ?? undefined,
      excerpt: body.excerpt ?? undefined,
      body_en: body.body_en ?? undefined,
      body_hi: body.body_hi ?? undefined,
      faq_items: body.faq_items as BlogFaqItem[] | undefined,
      hero_image_path: body.hero_image_path ?? undefined
    });
    return ok(row);
  }
}
