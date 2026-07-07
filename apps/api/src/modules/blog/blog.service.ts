import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import type {
  BlogFaqItem,
  BlogGeneratedBy,
  BlogListItem,
  BlogPostRow,
  BlogScript,
  BlogSource,
  BlogStatus,
  QualityBreakdown
} from "./blog.types";

export interface UpsertDraftInput {
  slug: string;
  title: string;
  meta_title?: string | null;
  meta_description?: string | null;
  excerpt?: string | null;
  body_en?: string | null;
  body_hi?: string | null;
  target_keyword?: string | null;
  intent?: string | null;
  city_slug?: string | null;
  category_slug?: string | null;
  generated_by: BlogGeneratedBy;
  status: "draft" | "needs_attention";
  quality_score?: number | null;
  quality_breakdown?: QualityBreakdown | null;
  faq_items?: BlogFaqItem[];
  hero_image_path?: string | null;
  sources?: BlogSource[];
  data_asof?: string | null;
  script?: BlogScript;
  brief_id?: string | null;
}

export interface EditablePatch {
  title?: string;
  meta_title?: string | null;
  meta_description?: string | null;
  excerpt?: string | null;
  body_en?: string | null;
  body_hi?: string | null;
  faq_items?: BlogFaqItem[];
  hero_image_path?: string | null;
}

const POST_SELECT_COLUMNS = `
  p.id::text, p.slug, p.title, p.meta_title, p.meta_description, p.excerpt,
  p.body_en, p.body_hi, p.target_keyword, p.intent, p.city_slug,
  p.category_id, cat.slug AS category_slug,
  p.status, p.generated_by, p.quality_score::float8 AS quality_score,
  p.quality_breakdown, p.faq_items, p.hero_image_path, p.author, p.sources,
  p.data_asof::text AS data_asof, p.script, p.is_pillar, p.brief_id::text AS brief_id,
  p.published_at::text AS published_at, p.created_at::text AS created_at,
  p.updated_at::text AS updated_at`;

const POST_RETURNING_COLUMNS = `
  id::text, slug, title, meta_title, meta_description, excerpt,
  body_en, body_hi, target_keyword, intent, city_slug,
  category_id, (SELECT slug FROM blog_categories WHERE id = blog_posts.category_id) AS category_slug,
  status, generated_by, quality_score::float8 AS quality_score,
  quality_breakdown, faq_items, hero_image_path, author, sources,
  data_asof::text AS data_asof, script, is_pillar, brief_id::text AS brief_id,
  published_at::text AS published_at, created_at::text AS created_at,
  updated_at::text AS updated_at`;

const LIST_COLUMNS = `
  p.slug, p.title, p.excerpt, cat.slug AS category_slug, p.city_slug,
  p.hero_image_path, p.author, p.published_at::text AS published_at,
  p.data_asof::text AS data_asof`;

@Injectable()
export class BlogService {
  constructor(private readonly database: DatabaseService) {}

  async listPublished(opts: {
    page?: number;
    pageSize?: number;
    category?: string;
    city?: string;
  }): Promise<{ items: BlogListItem[]; total: number }> {
    if (!this.database.isEnabled()) return { items: [], total: 0 };

    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(Math.max(1, opts.pageSize ?? 12), 50);
    const offset = (page - 1) * pageSize;
    const where = [`p.status = 'published'`];
    const params: unknown[] = [];

    if (opts.category) {
      params.push(opts.category);
      where.push(`cat.slug = $${params.length}`);
    }
    if (opts.city) {
      params.push(opts.city);
      where.push(`p.city_slug = $${params.length}`);
    }

    const whereSql = where.join(" AND ");
    const countParams = [...params];
    params.push(pageSize, offset);

    const { rows } = await this.database.query<BlogListItem>(
      `SELECT ${LIST_COLUMNS}
       FROM blog_posts p
       LEFT JOIN blog_categories cat ON cat.id = p.category_id
       WHERE ${whereSql}
       ORDER BY p.published_at DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const totalRes = await this.database.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM blog_posts p
       LEFT JOIN blog_categories cat ON cat.id = p.category_id
       WHERE ${whereSql}`,
      countParams
    );

    return { items: rows, total: totalRes.rows[0]?.total ?? 0 };
  }

  async getPublishedBySlug(slug: string): Promise<BlogPostRow | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<BlogPostRow>(
      `SELECT ${POST_SELECT_COLUMNS}
       FROM blog_posts p
       LEFT JOIN blog_categories cat ON cat.id = p.category_id
       WHERE p.slug = $1 AND p.status = 'published'`,
      [slug]
    );
    return rows[0] ?? null;
  }

  async getAnyBySlug(slug: string): Promise<BlogPostRow | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<BlogPostRow>(
      `SELECT ${POST_SELECT_COLUMNS}
       FROM blog_posts p
       LEFT JOIN blog_categories cat ON cat.id = p.category_id
       WHERE p.slug = $1`,
      [slug]
    );
    return rows[0] ?? null;
  }

  async getById(id: string): Promise<BlogPostRow | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<BlogPostRow>(
      `SELECT ${POST_SELECT_COLUMNS}
       FROM blog_posts p
       LEFT JOIN blog_categories cat ON cat.id = p.category_id
       WHERE p.id = $1::uuid`,
      [id]
    );
    return rows[0] ?? null;
  }

  async listForAdmin(opts: { status?: BlogStatus }): Promise<BlogPostRow[]> {
    if (!this.database.isEnabled()) return [];
    const params: unknown[] = [];
    let whereSql = "TRUE";
    if (opts.status) {
      params.push(opts.status);
      whereSql = `p.status = $1`;
    }

    const { rows } = await this.database.query<BlogPostRow>(
      `SELECT ${POST_SELECT_COLUMNS}
       FROM blog_posts p
       LEFT JOIN blog_categories cat ON cat.id = p.category_id
       WHERE ${whereSql}
       ORDER BY p.updated_at DESC
       LIMIT 200`,
      params
    );
    return rows;
  }

  async countByStatus(status: BlogStatus): Promise<number> {
    if (!this.database.isEnabled()) return 0;
    const { rows } = await this.database.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM blog_posts WHERE status = $1`,
      [status]
    );
    return rows[0]?.n ?? 0;
  }

  async upsertDraft(input: UpsertDraftInput): Promise<BlogPostRow> {
    if (!this.database.isEnabled()) {
      throw new Error("DATABASE_URL is required for blog draft writes");
    }

    const status: "draft" | "needs_attention" =
      input.status === "needs_attention" ? "needs_attention" : "draft";
    const { rows } = await this.database.query<BlogPostRow>(
      `INSERT INTO blog_posts (
         slug, title, meta_title, meta_description, excerpt, body_en, body_hi,
         target_keyword, intent, city_slug, category_id, status, generated_by,
         quality_score, quality_breakdown, faq_items, hero_image_path, sources,
         data_asof, script, brief_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, (SELECT id FROM blog_categories WHERE slug = $11), $12, $13,
         $14, $15::jsonb, $16::jsonb, $17, $18::jsonb,
         $19, $20, $21::uuid
       )
       ON CONFLICT (slug) DO UPDATE SET
         title = EXCLUDED.title,
         meta_title = EXCLUDED.meta_title,
         meta_description = EXCLUDED.meta_description,
         excerpt = EXCLUDED.excerpt,
         body_en = EXCLUDED.body_en,
         body_hi = EXCLUDED.body_hi,
         target_keyword = EXCLUDED.target_keyword,
         intent = EXCLUDED.intent,
         city_slug = EXCLUDED.city_slug,
         category_id = EXCLUDED.category_id,
         status = EXCLUDED.status,
         generated_by = EXCLUDED.generated_by,
         quality_score = EXCLUDED.quality_score,
         quality_breakdown = EXCLUDED.quality_breakdown,
         faq_items = EXCLUDED.faq_items,
         hero_image_path = EXCLUDED.hero_image_path,
         sources = EXCLUDED.sources,
         data_asof = EXCLUDED.data_asof,
         script = EXCLUDED.script,
         brief_id = EXCLUDED.brief_id,
         updated_at = now()
       -- Never let a regeneration clobber a post a human has already moved
       -- forward: only refresh drafts still awaiting review. A conflict on a
       -- published/in_review/archived slug updates zero rows (RETURNING empty),
       -- and we return the existing row untouched below.
       WHERE blog_posts.status IN ('brief', 'generating', 'draft', 'needs_attention')
       RETURNING ${POST_RETURNING_COLUMNS}`,
      [
        input.slug,
        input.title,
        input.meta_title ?? null,
        input.meta_description ?? null,
        input.excerpt ?? null,
        input.body_en ?? null,
        input.body_hi ?? null,
        input.target_keyword ?? null,
        input.intent ?? null,
        input.city_slug ?? null,
        input.category_slug ?? null,
        status,
        input.generated_by,
        input.quality_score ?? null,
        JSON.stringify(input.quality_breakdown ?? {}),
        JSON.stringify(input.faq_items ?? []),
        input.hero_image_path ?? null,
        JSON.stringify(input.sources ?? []),
        input.data_asof ?? null,
        input.script ?? "en",
        input.brief_id ?? null
      ]
    );

    if (rows[0]) return rows[0];

    // No row returned means the slug already exists in a protected state
    // (published / in_review / archived) and the guarded UPDATE was skipped.
    // Return the existing post as-is rather than throwing, so a redundant
    // regeneration is a safe no-op instead of an error.
    const existing = await this.database.query<BlogPostRow>(
      `SELECT ${POST_RETURNING_COLUMNS} FROM blog_posts WHERE slug = $1`,
      [input.slug]
    );
    if (existing.rows[0]) return existing.rows[0];

    throw new Error("Failed to upsert blog draft");
  }

  async transition(
    id: string,
    to: "in_review" | "published" | "archived" | "needs_attention"
  ): Promise<BlogPostRow | null> {
    if (!this.database.isEnabled()) return null;
    const publishedAtSql = to === "published" ? ", published_at = now()" : "";
    const { rows } = await this.database.query<BlogPostRow>(
      `UPDATE blog_posts
       SET status = $2${publishedAtSql}, updated_at = now()
       WHERE id = $1::uuid
       RETURNING ${POST_RETURNING_COLUMNS}`,
      [id, to]
    );
    return rows[0] ?? null;
  }

  async updateEditable(id: string, patch: EditablePatch): Promise<BlogPostRow | null> {
    if (!this.database.isEnabled()) return null;

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown, cast = "") => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };

    if (patch.title !== undefined) push("title", patch.title);
    if (patch.meta_title !== undefined) push("meta_title", patch.meta_title);
    if (patch.meta_description !== undefined) push("meta_description", patch.meta_description);
    if (patch.excerpt !== undefined) push("excerpt", patch.excerpt);
    if (patch.body_en !== undefined) push("body_en", patch.body_en);
    if (patch.body_hi !== undefined) push("body_hi", patch.body_hi);
    if (patch.faq_items !== undefined)
      push("faq_items", JSON.stringify(patch.faq_items), "::jsonb");
    if (patch.hero_image_path !== undefined) push("hero_image_path", patch.hero_image_path);
    if (sets.length === 0) return this.getById(id);

    params.push(id);
    const { rows } = await this.database.query<BlogPostRow>(
      `UPDATE blog_posts
       SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${params.length}::uuid
       RETURNING ${POST_RETURNING_COLUMNS}`,
      params
    );
    return rows[0] ?? null;
  }

  async relatedPublished(postId: string, limit = 3): Promise<BlogListItem[]> {
    if (!this.database.isEnabled()) return [];
    const { rows } = await this.database.query<BlogListItem>(
      `SELECT ${LIST_COLUMNS}
       FROM blog_posts p
       LEFT JOIN blog_categories cat ON cat.id = p.category_id
       WHERE p.status = 'published' AND p.id <> $1::uuid
         AND (
           p.category_id = (SELECT category_id FROM blog_posts WHERE id = $1::uuid)
           OR p.city_slug = (SELECT city_slug FROM blog_posts WHERE id = $1::uuid)
         )
       ORDER BY p.published_at DESC NULLS LAST
       LIMIT $2`,
      [postId, limit]
    );
    return rows;
  }
}
