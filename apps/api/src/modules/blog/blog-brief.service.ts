import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import type { BlogBriefRow, BlogDataPoint, BlogPostType, BriefSource } from "./blog.types";

export interface CreateBriefInput {
  target_keyword: string;
  intent?: string | null;
  outline?: Array<{ heading: string; subheadings?: string[] }>;
  required_data?: BlogDataPoint[];
  internal_link_targets?: Array<{ href: string; label: string }>;
  source: BriefSource;
  city_slug?: string | null;
  category_slug?: string | null;
  post_type?: BlogPostType;
  notes?: string | null;
}

const BRIEF_COLUMNS = `
  id::text, target_keyword, intent, outline, required_data, internal_link_targets,
  source, status, city_slug, category_slug, post_type, notes,
  created_at::text AS created_at, updated_at::text AS updated_at`;

const BRIEF_RETURNING_COLUMNS = `
  b.id::text, b.target_keyword, b.intent, b.outline, b.required_data, b.internal_link_targets,
  b.source, b.status, b.city_slug, b.category_slug, b.post_type, b.notes,
  b.created_at::text AS created_at, b.updated_at::text AS updated_at`;

@Injectable()
export class BlogBriefService {
  constructor(private readonly database: DatabaseService) {}

  async createBrief(input: CreateBriefInput): Promise<BlogBriefRow | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<BlogBriefRow>(
      `INSERT INTO blog_briefs
         (target_keyword, intent, outline, required_data, internal_link_targets,
          source, city_slug, category_slug, post_type, notes)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
       ON CONFLICT (lower(target_keyword)) WHERE status = 'pending' DO NOTHING
       RETURNING ${BRIEF_COLUMNS}`,
      [
        input.target_keyword,
        input.intent ?? null,
        JSON.stringify(input.outline ?? []),
        JSON.stringify(input.required_data ?? []),
        JSON.stringify(input.internal_link_targets ?? []),
        input.source,
        input.city_slug ?? null,
        input.category_slug ?? null,
        input.post_type ?? "evergreen",
        input.notes ?? null
      ]
    );
    return rows[0] ?? null;
  }

  async listPending(limit = 100): Promise<BlogBriefRow[]> {
    if (!this.database.isEnabled()) return [];
    const { rows } = await this.database.query<BlogBriefRow>(
      `SELECT ${BRIEF_COLUMNS}
       FROM blog_briefs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT $1`,
      [limit]
    );
    return rows;
  }

  async getById(id: string): Promise<BlogBriefRow | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<BlogBriefRow>(
      `SELECT ${BRIEF_COLUMNS}
       FROM blog_briefs
       WHERE id = $1::uuid`,
      [id]
    );
    return rows[0] ?? null;
  }

  async countPending(): Promise<number> {
    if (!this.database.isEnabled()) return 0;
    const { rows } = await this.database.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM blog_briefs WHERE status = 'pending'`
    );
    return rows[0]?.n ?? 0;
  }

  async claimNextPending(): Promise<BlogBriefRow | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<BlogBriefRow>(
      `WITH next AS (
         SELECT id
         FROM blog_briefs
         WHERE status = 'pending'
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE blog_briefs b
       SET status = 'generating', updated_at = now()
       FROM next
       WHERE b.id = next.id
       RETURNING ${BRIEF_RETURNING_COLUMNS}`
    );
    return rows[0] ?? null;
  }

  async markDone(id: string): Promise<void> {
    if (!this.database.isEnabled()) return;
    await this.database.query(
      `UPDATE blog_briefs SET status = 'done', updated_at = now() WHERE id = $1::uuid`,
      [id]
    );
  }

  async markDropped(id: string, reason?: string): Promise<void> {
    if (!this.database.isEnabled()) return;
    await this.database.query(
      `UPDATE blog_briefs
       SET status = 'dropped', notes = COALESCE($2, notes), updated_at = now()
       WHERE id = $1::uuid`,
      [id, reason ?? null]
    );
  }
}
