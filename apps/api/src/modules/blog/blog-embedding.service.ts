import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { EmbeddingService } from "../ai/embedding.service";

interface PostForEmbed {
  id: string;
  title: string;
  target_keyword: string | null;
  body_en: string | null;
  city_slug: string | null;
}

export interface BlogRelatedByEmbedding {
  blog_post_id: string;
  slug: string;
  title: string;
  distance: number;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

@Injectable()
export class BlogEmbeddingService {
  private readonly logger = new Logger(BlogEmbeddingService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly embedding: EmbeddingService
  ) {}

  buildBlogDocument(post: {
    title: string;
    targetKeyword: string | null;
    bodyHtml: string | null;
    citySlug: string | null;
  }): string {
    const parts = [
      post.title,
      post.targetKeyword ?? "",
      post.citySlug ?? "",
      stripHtml(post.bodyHtml ?? "").slice(0, 4000)
    ];
    return parts.filter(Boolean).join(" | ");
  }

  async embedPost(postId: string): Promise<boolean> {
    if (!this.database.isEnabled()) return false;

    const { rows } = await this.database.query<PostForEmbed>(
      `SELECT id::text, title, target_keyword, body_en, city_slug
       FROM blog_posts
       WHERE id = $1::uuid`,
      [postId]
    );
    const post = rows[0];
    if (!post) return false;

    const document = this.buildBlogDocument({
      title: post.title,
      targetKeyword: post.target_keyword,
      bodyHtml: post.body_en,
      citySlug: post.city_slug
    });
    const result = await this.embedding.embedText(document);
    if (!result) return false;

    await this.database.query(
      `INSERT INTO blog_embeddings (blog_post_id, embedding, model, token_count)
       VALUES ($1::uuid, $2::vector, $3, $4)
       ON CONFLICT (blog_post_id) DO UPDATE SET
         embedding = EXCLUDED.embedding,
         model = EXCLUDED.model,
         token_count = EXCLUDED.token_count,
         updated_at = now()`,
      [postId, toVectorLiteral(result.embedding), result.model, result.tokenCount]
    );
    return true;
  }

  async uniquenessDistance(embedding: number[], excludePostId?: string): Promise<number | null> {
    if (!this.database.isEnabled()) return null;

    const params: unknown[] = [toVectorLiteral(embedding)];
    const where: string[] = ["p.status IN ('draft', 'in_review', 'published', 'needs_attention')"];
    if (excludePostId) {
      params.push(excludePostId);
      where.push(`be.blog_post_id <> $${params.length}::uuid`);
    }

    try {
      const { rows } = await this.database.query<{ distance: number }>(
        `SELECT (be.embedding <=> $1::vector)::float8 AS distance
         FROM blog_embeddings be
         JOIN blog_posts p ON p.id = be.blog_post_id
         WHERE ${where.join(" AND ")}
         ORDER BY be.embedding <=> $1::vector
         LIMIT 1`,
        params
      );
      return rows[0]?.distance ?? null;
    } catch (error) {
      this.logger.debug(
        `uniqueness query failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  async findRelated(postId: string, limit = 3): Promise<BlogRelatedByEmbedding[]> {
    if (!this.database.isEnabled()) return [];

    try {
      const { rows } = await this.database.query<BlogRelatedByEmbedding>(
        `WITH me AS (
           SELECT embedding
           FROM blog_embeddings
           WHERE blog_post_id = $1::uuid
         )
         SELECT be.blog_post_id::text, p.slug, p.title,
                (be.embedding <=> me.embedding)::float8 AS distance
         FROM blog_embeddings be
         JOIN blog_posts p ON p.id = be.blog_post_id
         CROSS JOIN me
         WHERE be.blog_post_id <> $1::uuid
           AND p.status = 'published'
         ORDER BY be.embedding <=> me.embedding
         LIMIT $2`,
        [postId, Math.max(1, Math.min(limit, 12))]
      );
      return rows;
    } catch (error) {
      this.logger.debug(
        `findRelated query failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }
}
