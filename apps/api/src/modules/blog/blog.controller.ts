import { Controller, Get, HttpCode, Inject, Param, Post, Query } from "@nestjs/common";
import { ok } from "../../common/response";
import { BlogEmbeddingService } from "./blog-embedding.service";
import { BlogService } from "./blog.service";

@Controller("blog")
export class BlogController {
  constructor(
    @Inject(BlogService) private readonly blog: BlogService,
    @Inject(BlogEmbeddingService) private readonly embeddings: BlogEmbeddingService
  ) {}

  @Get()
  async list(
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("category") category?: string,
    @Query("city") city?: string
  ) {
    const result = await this.blog.listPublished({
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      category: category || undefined,
      city: city || undefined
    });
    return ok(result);
  }

  // Declared before ":slug" — Nest matches routes in declaration order.
  @Get("most-read")
  async mostRead(@Query("days") days?: string, @Query("limit") limit?: string) {
    const d = Math.min(Math.max(Number(days) || 7, 1), 30);
    const l = Math.min(Math.max(Number(limit) || 5, 1), 10);
    return ok({ items: await this.blog.mostRead(d, l) });
  }

  /**
   * Reader-view tally, fired client-side by the article page (the page itself
   * is ISR-cached, so server renders cannot count readers). Public by design —
   * same trust model as listing view counting.
   */
  @Post(":slug/view")
  @HttpCode(202)
  async recordView(@Param("slug") slug: string) {
    await this.blog.recordView(slug);
    return ok({});
  }

  @Get(":slug")
  async getBySlug(@Param("slug") slug: string) {
    const post = await this.blog.getPublishedBySlug(slug);
    if (!post) return ok(null);

    const semantic = await this.embeddings.findRelated(post.id, 3).catch(() => []);
    const related =
      semantic.length > 0
        ? semantic.map((item) => ({ slug: item.slug, title: item.title }))
        : (await this.blog.relatedPublished(post.id, 3)).map((item) => ({
            slug: item.slug,
            title: item.title
          }));

    return ok({ post, related });
  }
}
