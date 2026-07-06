import type { DatabaseService } from "../common/database.service";
import { EmbeddingService } from "../modules/ai/embedding.service";
import { BlogBriefService } from "../modules/blog/blog-brief.service";
import { BlogEmbeddingService } from "../modules/blog/blog-embedding.service";
import { BlogGeneratorService, type CallJson } from "../modules/blog/blog-generator.service";
import { BlogTopicPlannerService } from "../modules/blog/blog-topic-planner.service";
import { BlogService } from "../modules/blog/blog.service";
import { SeoAggregatesService } from "../modules/seo/seo-aggregates.service";

export function blogFlagEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.FF_SEO_BLOG ?? "").trim().toLowerCase());
}

export type PoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
};

export function adapterFor(pool: PoolLike): DatabaseService {
  return {
    isEnabled: () => true,
    query: (text: string, params?: unknown[]) => pool.query(text, params)
  } as unknown as DatabaseService;
}

export async function runBlogTopicPlanner(
  pool: PoolLike,
  citySlugs: string[] = ["lucknow"]
): Promise<{ created: number }> {
  const database = adapterFor(pool);
  const aggregates = new SeoAggregatesService(database);
  const briefs = new BlogBriefService(database);
  const planner = new BlogTopicPlannerService(database, aggregates, briefs);
  const result = await planner.planTopics({ citySlugs });
  return { created: result.created };
}

export interface GeneratorDeps {
  callJson?: CallJson;
  embedForUniqueness?: (postDocument: string) => Promise<number | null>;
}

export async function runBlogGenerator(
  pool: PoolLike,
  batch = 3,
  deps: GeneratorDeps = {}
): Promise<{ drafted: number; needsAttention: number }> {
  const database = adapterFor(pool);
  const aggregates = new SeoAggregatesService(database);
  const briefs = new BlogBriefService(database);
  const blog = new BlogService(database);
  const embeddingService = new EmbeddingService(database);
  const blogEmbeddings = new BlogEmbeddingService(database, embeddingService);
  const generator = deps.callJson
    ? new BlogGeneratorService(aggregates, deps.callJson)
    : new BlogGeneratorService(aggregates);

  const uniqueness = async (bodyEn: string, title: string): Promise<number | null> => {
    const document = `${title} | ${bodyEn.replace(/<[^>]+>/g, " ").slice(0, 4000)}`;
    if (deps.embedForUniqueness) return deps.embedForUniqueness(document);
    const embedded = await embeddingService.embedText(document);
    if (!embedded) return null;
    return blogEmbeddings.uniquenessDistance(embedded.embedding);
  };

  let drafted = 0;
  let needsAttention = 0;

  for (let i = 0; i < batch; i += 1) {
    const brief = await briefs.claimNextPending();
    if (!brief) break;

    let generated = await generator.generate(brief);
    if (generated) {
      const distance = await uniqueness(generated.bodyEn, generated.title);
      generated = await generator.generate(brief, distance);
    }

    if (!generated || !generated.quality.passed) {
      const retry = await generator.generate(brief);
      if (retry) {
        const distance = await uniqueness(retry.bodyEn, retry.title);
        generated = await generator.generate(brief, distance);
      }
    }

    if (!generated) {
      await briefs.markDropped(brief.id, "generation_failed");
      continue;
    }

    const status: "draft" | "needs_attention" = generated.quality.passed
      ? "draft"
      : "needs_attention";
    await blog.upsertDraft({
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
      generated_by: "planner",
      status,
      quality_score: generated.quality.score,
      quality_breakdown: generated.quality,
      faq_items: generated.faqItems,
      sources: generated.sources,
      data_asof: generated.dataAsof,
      script: "en",
      brief_id: brief.id
    });

    if (status === "draft") drafted += 1;
    else needsAttention += 1;
    await briefs.markDone(brief.id);
  }

  return { drafted, needsAttention };
}

const EMBED_MAX_ATTEMPTS = 5;

export async function runBlogEmbedSweep(
  pool: PoolLike,
  batch = 25,
  deps: {
    embedText?: (
      input: string
    ) => Promise<{ embedding: number[]; tokenCount: number; model: string } | null>;
  } = {}
): Promise<{ embedded: number }> {
  const database = adapterFor(pool);
  const embeddingService = new EmbeddingService(database);
  const blogEmbeddings = new BlogEmbeddingService(database, embeddingService);
  if (deps.embedText) {
    (embeddingService as unknown as { embedText: typeof deps.embedText }).embedText =
      deps.embedText;
  }

  let embedded = 0;
  for (let i = 0; i < batch; i += 1) {
    const { rows } = await pool.query(
      `SELECT id, aggregate_id::text AS aggregate_id, payload, attempt_count
       FROM outbound_events
       WHERE event_type = 'seo.embed_blog'
         AND status = 'pending'
         AND next_attempt_at <= now()
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`
    );
    const event = rows[0] as
      | {
          id: number;
          aggregate_id: string | null;
          payload: { blog_post_id?: string };
          attempt_count?: number;
        }
      | undefined;
    if (!event) break;

    const postId = event.aggregate_id ?? event.payload?.blog_post_id;
    let ok = false;
    try {
      if (postId) ok = await blogEmbeddings.embedPost(postId);
    } catch {
      ok = false;
    }

    if (ok) {
      await pool.query(
        `UPDATE outbound_events
         SET status = 'dispatched',
             attempt_count = attempt_count + 1,
             dispatched_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [event.id]
      );
      embedded += 1;
      continue;
    }

    const nextAttemptCount = (Number(event.attempt_count) || 0) + 1;
    const failed = nextAttemptCount >= EMBED_MAX_ATTEMPTS;
    await pool.query(
      `UPDATE outbound_events
       SET status = $2,
           attempt_count = $3,
           next_attempt_at = CASE
             WHEN $2 = 'failed' THEN next_attempt_at
             ELSE now() + interval '10 minutes'
           END,
           updated_at = now()
       WHERE id = $1`,
      [event.id, failed ? "failed" : "pending", nextAttemptCount]
    );
    if (!failed) break;
  }

  return { embedded };
}
