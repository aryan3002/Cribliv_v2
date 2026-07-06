import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
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
