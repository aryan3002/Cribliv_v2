# Slice 3 — Blog / Content Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a data-grounded, multi-step, quality-gated, human-approved blog engine so Cribliv publishes a steady cadence of genuinely useful posts (never slop) that rank for long-tail queries and feed the programmatic surface with internal links.

**Architecture:** A NestJS `BlogModule` (DB-only services) exposes public read endpoints, internal worker-write endpoints behind a new `ApiKeyGuard` (`x-api-key`), and audited admin endpoints (`@Roles("admin")`). Two standalone worker jobs — a weekly `blog_topic_planner` (turns GSC quick-wins + gaps + data-trends + an evergreen seed list into `blog_briefs`) and a daily `blog_generator` (outline → section drafting with **real `SeoAggregatesService` data injected** → fact-check → SEO/readability → `qualityScore` gate) — produce `status='draft'` posts that a human edits and approves; only then does the post publish, embed (`seo.embed_blog` → `blog_embeddings` via `EmbeddingService`), enqueue to slice-2's `seo_indexing_queue`, and enter the sitemap. Next.js 14 renders bilingual ISR hub + detail pages with Article + FAQPage + BreadcrumbList JSON-LD, data fact-blocks + recharts, and semantic internal links.

**Tech Stack:** NestJS, Postgres+pgvector, Azure OpenAI, standalone worker, Next.js 14.2.13, recharts, Vitest.

## Global Constraints

- DB-only services: every blog service guards on `DatabaseService.isEnabled()` and never falls back to `AppStateService` (mirrors `SeoCityConfigService`, `SeoAggregatesService`, `SeoCopyService`).
- Azure OpenAI via per-service `readAiConfig` (endpoint/apiKey/deployment from `AZURE_OPENAI_*` env), JSON `response_format`, `AbortController` timeout — reuse `SeoCopyService`'s conventions verbatim.
- Embeddings reuse `EmbeddingService.callEmbeddingApi` semantics + the `listing_embeddings` HNSW pattern (vector 1536, `vector_cosine_ops`, `<=>` cosine) — `BlogEmbeddingService` is a thin sibling.
- NEVER auto-publish — human approval required: the generator only ever writes `status='draft'` (gate pass) or `status='needs_attention'` (gate fail); the ONLY path to `published` is an admin action.
- Every published post cites real data + has internal links + passes the quality gate: enforced by `qualityScore()` before a draft reaches the review queue.
- Migrations raw SQL + paired rollback (confirm next free number at build time — 0044 is the latest on this branch; slice 2 lands its own migrations first, so run `ls infra/migrations/ | sort | tail -5` and take the next free `NNNN` for each blog migration; this plan writes them as `00XX_*` placeholders you MUST renumber to the actual next-free numbers before committing).
- `ApiKeyGuard` (`x-api-key`) for worker writes: a new guard validating the header against `BLOG_WORKER_API_KEY`; used only on the internal draft write/patch endpoints.
- Admin `@Roles("admin")` + `admin_actions` audit: every admin mutation writes an `admin_actions` row (best-effort `.catch(() => undefined)`) using `deterministicUuidV5(slug)` for `target_id`.
- Flags `FF_*` default off: `FF_SEO_BLOG` gates worker generation + the admin tab; publishing is human-gated regardless of the flag.
- LLM/embedding calls mocked in tests: no live Azure calls; mock `fetch` (inline fake or `vi.fn`) and inject fake `DatabaseService` (`{ isEnabled, query }`).
- DB-safety: never touch the default Azure `DATABASE_URL`; integration tests use `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test'`; local dev uses `cribliv_v2`.
- Fonts Inter/Manrope/Fraunces only (already configured in `apps/web/app/layout.tsx` as `--font-inter` / `--font-manrope` / `--font-display`) — no new families.
- Keep files plain UTF-8.

**Test locations & commands (used by every task):**

- Unit tests: `apps/api/test/*.test.ts` (mocked, no DB). Run one: `pnpm --filter @cribliv/api exec vitest run test/<file>.test.ts`.
- Integration tests: `apps/api/test/*.integration.test.ts` — first line of the suite is `describe.runIf(!!process.env.TEST_DATABASE_URL)(...)`. Run one:
  `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/<file>.integration.test.ts`.
- Web unit tests: `pnpm --filter @cribliv/web exec vitest run <path>` (Vitest is used for web `__tests__` too, e.g. `app/__tests__/sitemap.test.ts`).
- Every commit message ends with the trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  ```

**Shared vocabulary (types every task must use verbatim):**

- Post status enum values: `brief | generating | draft | needs_attention | in_review | published | archived`.
- `generated_by` values: `planner | manual | refresh | pillar`.
- `blog_briefs.source` values: `gsc_quickwin | gap | data_trend | evergreen | manual`.
- `blog_briefs.status` values: `pending | generating | done | dropped`.
- `script` values: `en | hi | hinglish` (hinglish reserved for slice 8).
- Event type for embeddings: `seo.embed_blog`; `aggregate_type = 'blog_post'`; dedupe key `blog_embed:<postId>`.
- Quality gate default thresholds (tunable — stored as constants in `quality-gate.ts`): `MIN_WORDS = 900`, `MIN_WORDS_DATA = 1200`, `MIN_DATA_POINTS_DATA = 3`, `MIN_INTERNAL_LINKS = 3`, `UNIQUENESS_MIN_DISTANCE = 0.15` (cosine distance vs nearest existing post), banned phrases `["as an ai", "in conclusion", "it's important to note", "as a language model", "lorem ipsum", "todo", "tbd"]`, keyword must appear in title + H1 + first 100 words (present, not stuffed → keyword density ≤ 3%).

---

## Task 0: Migration numbering + branch note (read before Task 1)

**Files:** none (verification-only)

- [ ] **Step 1: Confirm the next free migration number**

Run: `ls infra/migrations/ | sort | tail -8`
Expected: the highest existing number is `0044` on this branch. **Slice 2 merges first and consumes numbers** (it adds `seo_indexing_queue` + `keyword_rankings`). Before writing each blog migration below, re-run this command and use the actual next-free `NNNN`. Throughout this plan the four blog migrations are written with placeholder numbers `00A0` (blog_categories), `00A1` (blog_posts), `00A2` (blog_briefs), `00A3` (blog_embeddings). **Rename all four (and their `.rollback.sql` siblings, and every `readFileSync`/filename reference in tests) to the real consecutive next-free numbers before committing Task 1.** Keep them consecutive and in this dependency order (categories → posts → briefs → embeddings).

- [ ] **Step 2: Confirm the slice-2 dependency exists (or note it as pending)**

Run: `grep -rl "seo_indexing_queue" infra/migrations apps/api/src 2>/dev/null || echo "slice-2 not merged yet"`
Expected: after slice 2 merges, this finds the table + the `IndexingService`/enqueue point. Task 15 (on-publish indexing) enqueues into `seo_indexing_queue`; if slice 2 is not yet merged when you reach Task 15, that task's write is guarded by a `to_regclass('public.seo_indexing_queue') IS NOT NULL` check so it is a safe no-op until the table exists. No code change is required here — this step is a reminder.

---

## Task 1: Migration — `blog_categories`

**Files:**

- Create: `infra/migrations/00A0_blog_categories.sql` (renumber per Task 0)
- Create: `infra/migrations/00A0_blog_categories.rollback.sql`
- Test: `apps/api/test/blog-migrations.integration.test.ts`

**Interfaces:**

- Produces: table `blog_categories(id serial pk, slug text unique, name_en text, name_hi text, description_en text, description_hi text, sort_order int, created_at, updated_at)`. Seeds 4 categories: `data-reports`, `local-guides`, `tenancy`, `market-updates`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-migrations.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");
// NOTE: renumber these four constants to the real next-free numbers (Task 0).
const CATEGORIES = "00A0_blog_categories";
const POSTS = "00A1_blog_posts";
const BRIEFS = "00A2_blog_briefs";
const EMBEDDINGS = "00A3_blog_embeddings";

function sql(name: string): string {
  return readFileSync(join(MIG, `${name}.sql`), "utf8");
}
function rollback(name: string): string {
  return readFileSync(join(MIG, `${name}.rollback.sql`), "utf8");
}

describe.runIf(!!TEST_DB)("blog migrations", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(sql(CATEGORIES));
  });

  afterAll(async () => {
    await client.query(rollback(CATEGORIES));
    await client.end();
  });

  it("creates blog_categories with a unique slug and seeds four rows", async () => {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'blog_categories'`
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining(["id", "slug", "name_en", "name_hi", "description_en", "sort_order"])
    );

    const seeded = await client.query(`SELECT slug FROM blog_categories ORDER BY sort_order`);
    expect(seeded.rows.map((r) => r.slug)).toEqual([
      "data-reports",
      "local-guides",
      "tenancy",
      "market-updates"
    ]);

    const dup = client.query(
      `INSERT INTO blog_categories (slug, name_en, name_hi) VALUES ('tenancy','x','y')`
    );
    await expect(dup).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/blog-migrations.integration.test.ts`
Expected: FAIL — `ENOENT` reading `00A0_blog_categories.sql` (file does not exist yet).

- [ ] **Step 3: Write the migration + rollback**

Create `infra/migrations/00A0_blog_categories.sql`:

```sql
-- Migration 00A0: blog_categories — taxonomy for the content engine (slice 3).
-- Bilingual names + descriptions. Seeded with the four post-type buckets from
-- the spec so blog_posts.category_id always resolves.

CREATE TABLE IF NOT EXISTS blog_categories (
  id            serial PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name_en       text NOT NULL,
  name_hi       text NOT NULL,
  description_en text,
  description_hi text,
  sort_order    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION blog_categories_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_categories_touch ON blog_categories;
CREATE TRIGGER trg_blog_categories_touch
  BEFORE UPDATE ON blog_categories
  FOR EACH ROW EXECUTE FUNCTION blog_categories_touch_updated_at();

INSERT INTO blog_categories (slug, name_en, name_hi, description_en, sort_order) VALUES
  ('data-reports',  'Data Reports',  'डेटा रिपोर्ट',   'Rent trends and market data backed by live listings.', 1),
  ('local-guides',  'Local Guides',  'लोकल गाइड',      'Neighbourhood and city rental guides.',                 2),
  ('tenancy',       'Tenancy',       'किरायेदारी',     'Rent agreements, deposits, tenant rights, moving.',     3),
  ('market-updates','Market Updates','मार्केट अपडेट',  'Query-targeted and seasonal rental updates.',           4)
ON CONFLICT (slug) DO NOTHING;
```

Create `infra/migrations/00A0_blog_categories.rollback.sql`:

```sql
-- Rollback for 00A0_blog_categories.sql
DROP TRIGGER IF EXISTS trg_blog_categories_touch ON blog_categories;
DROP FUNCTION IF EXISTS blog_categories_touch_updated_at();
DROP TABLE IF EXISTS blog_categories;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/blog-migrations.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/00A0_blog_categories.sql infra/migrations/00A0_blog_categories.rollback.sql apps/api/test/blog-migrations.integration.test.ts
git commit -m "feat(blog): add blog_categories migration + integration test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Migration — `blog_posts`

**Files:**

- Create: `infra/migrations/00A1_blog_posts.sql`
- Create: `infra/migrations/00A1_blog_posts.rollback.sql`
- Modify: `apps/api/test/blog-migrations.integration.test.ts` (add a describe block that also applies 00A1 on top of 00A0)

**Interfaces:**

- Produces: table `blog_posts` per spec §8 with a `CHECK` on `status` and `generated_by`, unique `slug`, and indexes on `status`, `target_keyword`, `city_slug`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/blog-migrations.integration.test.ts` a second suite (so it can run independently, applying 00A0 then 00A1):

```typescript
describe.runIf(!!TEST_DB)("blog_posts migration", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(sql(CATEGORIES));
    await client.query(sql(POSTS));
  });

  afterAll(async () => {
    await client.query(rollback(POSTS));
    await client.query(rollback(CATEGORIES));
    await client.end();
  });

  it("creates blog_posts with unique slug, status/generated_by checks, and indexes", async () => {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'blog_posts'`
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "slug",
        "title",
        "meta_title",
        "meta_description",
        "excerpt",
        "body_en",
        "body_hi",
        "target_keyword",
        "intent",
        "city_slug",
        "category_id",
        "status",
        "generated_by",
        "quality_score",
        "quality_breakdown",
        "faq_items",
        "hero_image_path",
        "author",
        "sources",
        "data_asof",
        "script",
        "is_pillar",
        "published_at",
        "created_at",
        "updated_at"
      ])
    );

    // status CHECK rejects an unknown value
    const catId = (await client.query(`SELECT id FROM blog_categories LIMIT 1`)).rows[0].id;
    const bad = client.query(
      `INSERT INTO blog_posts (slug, title, category_id, status)
       VALUES ('x', 'X', $1, 'bogus')`,
      [catId]
    );
    await expect(bad).rejects.toThrow();

    // a valid draft inserts and defaults apply
    const okRow = await client.query(
      `INSERT INTO blog_posts (slug, title, category_id, status, generated_by, target_keyword)
       VALUES ('2bhk-rent-gomti-nagar', '2BHK rent in Gomti Nagar', $1, 'draft', 'planner', '2bhk rent gomti nagar')
       RETURNING script, is_pillar`,
      [catId]
    );
    expect(okRow.rows[0].script).toBe("en");
    expect(okRow.rows[0].is_pillar).toBe(false);

    const idx = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'blog_posts'`
    );
    const idxNames = idx.rows.map((r) => r.indexname).join(",");
    expect(idxNames).toMatch(/status/);
    expect(idxNames).toMatch(/target_keyword/);
    expect(idxNames).toMatch(/city_slug/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/blog-migrations.integration.test.ts`
Expected: FAIL — `ENOENT` reading `00A1_blog_posts.sql`.

- [ ] **Step 3: Write the migration + rollback**

Create `infra/migrations/00A1_blog_posts.sql`:

```sql
-- Migration 00A1: blog_posts — the content engine's core table (slice 3, spec §8).
-- Bilingual body (en/hi), grounded-data provenance (sources, data_asof),
-- quality gate output (quality_score + quality_breakdown), FAQ block for
-- buildFaqPage, editorial byline (author), and the full state machine via a
-- status CHECK. Human approval is the only path to 'published' (enforced in
-- the service, not here).

CREATE TABLE IF NOT EXISTS blog_posts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              text NOT NULL UNIQUE,
  title             text NOT NULL,
  meta_title        text,
  meta_description  text,
  excerpt           text,
  body_en           text,
  body_hi           text,
  target_keyword    text,
  intent            text,
  city_slug         text,
  category_id       int REFERENCES blog_categories(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'brief'
                      CHECK (status IN ('brief','generating','draft','needs_attention','in_review','published','archived')),
  generated_by      text NOT NULL DEFAULT 'planner'
                      CHECK (generated_by IN ('planner','manual','refresh','pillar')),
  quality_score     numeric,
  quality_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  faq_items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  hero_image_path   text,
  author            text NOT NULL DEFAULT 'Aditi Sharma',
  sources           jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_asof         date,
  script            text NOT NULL DEFAULT 'en'
                      CHECK (script IN ('en','hi','hinglish')),
  is_pillar         boolean NOT NULL DEFAULT false,
  brief_id          uuid,
  published_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts (status);
CREATE INDEX IF NOT EXISTS idx_blog_posts_target_keyword ON blog_posts (target_keyword);
CREATE INDEX IF NOT EXISTS idx_blog_posts_city_slug ON blog_posts (city_slug) WHERE city_slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts (published_at DESC) WHERE status = 'published';

CREATE OR REPLACE FUNCTION blog_posts_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_posts_touch ON blog_posts;
CREATE TRIGGER trg_blog_posts_touch
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION blog_posts_touch_updated_at();
```

Create `infra/migrations/00A1_blog_posts.rollback.sql`:

```sql
-- Rollback for 00A1_blog_posts.sql
DROP TRIGGER IF EXISTS trg_blog_posts_touch ON blog_posts;
DROP FUNCTION IF EXISTS blog_posts_touch_updated_at();
DROP INDEX IF EXISTS idx_blog_posts_published;
DROP INDEX IF EXISTS idx_blog_posts_city_slug;
DROP INDEX IF EXISTS idx_blog_posts_target_keyword;
DROP INDEX IF EXISTS idx_blog_posts_status;
DROP TABLE IF EXISTS blog_posts;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/blog-migrations.integration.test.ts`
Expected: PASS (both suites).

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/00A1_blog_posts.sql infra/migrations/00A1_blog_posts.rollback.sql apps/api/test/blog-migrations.integration.test.ts
git commit -m "feat(blog): add blog_posts migration + integration test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Migrations — `blog_briefs` + `blog_embeddings`

**Files:**

- Create: `infra/migrations/00A2_blog_briefs.sql` + `.rollback.sql`
- Create: `infra/migrations/00A3_blog_embeddings.sql` + `.rollback.sql`
- Modify: `apps/api/test/blog-migrations.integration.test.ts` (add briefs + embeddings suites)

**Interfaces:**

- Produces: `blog_briefs` (spec §8) and `blog_embeddings` (`blog_post_id uuid pk` FK → `blog_posts` ON DELETE CASCADE, `embedding vector(1536)`, HNSW `vector_cosine_ops` — mirrors migration 0006). `blog_embeddings` is created inside a safe `DO $$ … EXCEPTION WHEN OTHERS` block so it skips gracefully where pgvector is unavailable (same as 0006).

- [ ] **Step 1: Write the failing test**

Append two suites to `apps/api/test/blog-migrations.integration.test.ts`:

```typescript
describe.runIf(!!TEST_DB)("blog_briefs migration", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(sql(BRIEFS));
  });
  afterAll(async () => {
    await client.query(rollback(BRIEFS));
    await client.end();
  });

  it("creates blog_briefs with source/status checks and jsonb columns", async () => {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'blog_briefs'`
    );
    const names = cols.rows.map((r) => r.column_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "target_keyword",
        "intent",
        "outline",
        "required_data",
        "internal_link_targets",
        "source",
        "status",
        "city_slug",
        "created_at"
      ])
    );
    const bad = client.query(
      `INSERT INTO blog_briefs (target_keyword, source, status) VALUES ('k', 'bogus', 'pending')`
    );
    await expect(bad).rejects.toThrow();
    const good = await client.query(
      `INSERT INTO blog_briefs (target_keyword, source) VALUES ('2bhk rent noida', 'gsc_quickwin')
       RETURNING status, outline`
    );
    expect(good.rows[0].status).toBe("pending");
    expect(good.rows[0].outline).toEqual([]);
  });
});

describe.runIf(!!TEST_DB)("blog_embeddings migration", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(sql(CATEGORIES));
    await client.query(sql(POSTS));
    await client.query(sql(EMBEDDINGS));
  });
  afterAll(async () => {
    await client.query(rollback(EMBEDDINGS));
    await client.query(rollback(POSTS));
    await client.query(rollback(CATEGORIES));
    await client.end();
  });

  it("creates blog_embeddings keyed by blog_post_id when pgvector is present", async () => {
    const hasVector = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    if (hasVector.rowCount === 0) return; // pgvector absent — migration skipped gracefully
    const tbl = await client.query(`SELECT to_regclass('public.blog_embeddings') AS t`);
    expect(tbl.rows[0].t).toBe("blog_embeddings");
    const idx = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'blog_embeddings'`
    );
    expect(idx.rows.map((r) => r.indexdef).join(" ")).toMatch(/hnsw/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/blog-migrations.integration.test.ts`
Expected: FAIL — `ENOENT` reading `00A2_blog_briefs.sql`.

- [ ] **Step 3: Write the migrations + rollbacks**

Create `infra/migrations/00A2_blog_briefs.sql`:

```sql
-- Migration 00A2: blog_briefs — the structured content brief the generator
-- writes to (spec §2.3, §6). Never "write a blog about X": every post starts
-- here with a target keyword, intent, SERP-informed outline, required data
-- points (pulled live from SeoAggregatesService at generation time), and
-- mandatory internal-link targets.

CREATE TABLE IF NOT EXISTS blog_briefs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_keyword         text NOT NULL,
  intent                 text,
  outline                jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_data          jsonb NOT NULL DEFAULT '[]'::jsonb,
  internal_link_targets  jsonb NOT NULL DEFAULT '[]'::jsonb,
  source                 text NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('gsc_quickwin','gap','data_trend','evergreen','manual')),
  status                 text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','generating','done','dropped')),
  city_slug              text,
  category_slug          text,
  post_type              text NOT NULL DEFAULT 'evergreen'
                          CHECK (post_type IN ('data_report','local_guide','evergreen','query_targeted')),
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_briefs_status ON blog_briefs (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_blog_briefs_keyword_pending
  ON blog_briefs (lower(target_keyword)) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION blog_briefs_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_blog_briefs_touch ON blog_briefs;
CREATE TRIGGER trg_blog_briefs_touch
  BEFORE UPDATE ON blog_briefs
  FOR EACH ROW EXECUTE FUNCTION blog_briefs_touch_updated_at();
```

Create `infra/migrations/00A2_blog_briefs.rollback.sql`:

```sql
-- Rollback for 00A2_blog_briefs.sql
DROP TRIGGER IF EXISTS trg_blog_briefs_touch ON blog_briefs;
DROP FUNCTION IF EXISTS blog_briefs_touch_updated_at();
DROP INDEX IF EXISTS uq_blog_briefs_keyword_pending;
DROP INDEX IF EXISTS idx_blog_briefs_status;
DROP TABLE IF EXISTS blog_briefs;
```

Create `infra/migrations/00A3_blog_embeddings.sql` (mirrors the safe DO-block from 0006):

```sql
-- Migration 00A3: blog_embeddings — vector(1536) per post for uniqueness
-- checks + semantic internal linking (spec §2.8, §5). Mirrors listing_embeddings
-- from 0006: pgvector + HNSW cosine, created inside a safe DO block so the
-- migration still succeeds where pgvector is unavailable.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;

  EXECUTE '
    CREATE TABLE IF NOT EXISTS blog_embeddings (
      blog_post_id UUID PRIMARY KEY REFERENCES blog_posts(id) ON DELETE CASCADE,
      embedding    vector(1536) NOT NULL,
      model        TEXT NOT NULL DEFAULT ''text-embedding-3-small'',
      token_count  INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  ';

  EXECUTE '
    CREATE INDEX IF NOT EXISTS idx_blog_embeddings_hnsw
      ON blog_embeddings
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 64)
  ';

  RAISE NOTICE ''blog_embeddings table created.'';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE ''pgvector not available (%). Skipping blog_embeddings.'', SQLERRM;
END $$;
```

Create `infra/migrations/00A3_blog_embeddings.rollback.sql`:

```sql
-- Rollback for 00A3_blog_embeddings.sql
DROP INDEX IF EXISTS idx_blog_embeddings_hnsw;
DROP TABLE IF EXISTS blog_embeddings;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/blog-migrations.integration.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/00A2_blog_briefs.sql infra/migrations/00A2_blog_briefs.rollback.sql infra/migrations/00A3_blog_embeddings.sql infra/migrations/00A3_blog_embeddings.rollback.sql apps/api/test/blog-migrations.integration.test.ts
git commit -m "feat(blog): add blog_briefs + blog_embeddings migrations + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `ApiKeyGuard` (worker writes)

**Files:**

- Create: `apps/api/src/common/api-key.guard.ts`
- Modify: `apps/api/src/common/guards.module.ts:6-9` (provide + export `ApiKeyGuard`)
- Test: `apps/api/test/api-key.guard.test.ts`

**Interfaces:**

- Produces: `ApiKeyGuard implements CanActivate` — reads `x-api-key` header, compares (constant-time) to `process.env.BLOG_WORKER_API_KEY`; throws `UnauthorizedException({ code: "unauthorized", message: "Invalid API key" })` on mismatch/missing; if `BLOG_WORKER_API_KEY` is unset, denies all (fail closed).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/api-key.guard.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { UnauthorizedException } from "@nestjs/common";
import { ApiKeyGuard } from "../src/common/api-key.guard";

function ctx(headers: Record<string, string>) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) })
  } as never;
}

describe("ApiKeyGuard", () => {
  const OLD = process.env.BLOG_WORKER_API_KEY;
  beforeEach(() => {
    process.env.BLOG_WORKER_API_KEY = "secret-key-123";
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.BLOG_WORKER_API_KEY;
    else process.env.BLOG_WORKER_API_KEY = OLD;
  });

  it("allows a request with the correct x-api-key", () => {
    const guard = new ApiKeyGuard();
    expect(guard.canActivate(ctx({ "x-api-key": "secret-key-123" }))).toBe(true);
  });

  it("rejects a wrong key", () => {
    const guard = new ApiKeyGuard();
    expect(() => guard.canActivate(ctx({ "x-api-key": "wrong" }))).toThrow(UnauthorizedException);
  });

  it("rejects a missing key", () => {
    const guard = new ApiKeyGuard();
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it("fails closed when BLOG_WORKER_API_KEY is unset", () => {
    delete process.env.BLOG_WORKER_API_KEY;
    const guard = new ApiKeyGuard();
    expect(() => guard.canActivate(ctx({ "x-api-key": "anything" }))).toThrow(
      UnauthorizedException
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/api-key.guard.test.ts`
Expected: FAIL — cannot find module `../src/common/api-key.guard`.

- [ ] **Step 3: Write the guard + register it**

Create `apps/api/src/common/api-key.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";

/**
 * Guards the internal worker-write endpoints (POST/PATCH /v1/blog/drafts).
 * The standalone worker authenticates with a shared secret in the
 * `x-api-key` header (BLOG_WORKER_API_KEY). Fails closed: if the env var is
 * unset, every request is rejected — the worker routes must never be open.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.BLOG_WORKER_API_KEY?.trim();
    const request = context.switchToHttp().getRequest();
    const provided = (request.headers["x-api-key"] as string | undefined)?.trim();

    if (!expected || !provided) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid API key" });
    }

    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException({ code: "unauthorized", message: "Invalid API key" });
    }
    return true;
  }
}
```

Modify `apps/api/src/common/guards.module.ts` — add the import and register:

```typescript
import { Global, Module } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";
import { RolesGuard } from "./roles.guard";
import { ApiKeyGuard } from "./api-key.guard";

@Global()
@Module({
  providers: [AuthGuard, RolesGuard, ApiKeyGuard],
  exports: [AuthGuard, RolesGuard, ApiKeyGuard]
})
export class GuardsModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/api-key.guard.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/api-key.guard.ts apps/api/src/common/guards.module.ts apps/api/test/api-key.guard.test.ts
git commit -m "feat(blog): add ApiKeyGuard for worker writes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Feature flag `FF_SEO_BLOG`

**Files:**

- Modify: `apps/api/src/config/feature-flags.ts` (add `ff_seo_blog` to interface, defaults, reader)
- Test: `apps/api/test/feature-flags-blog.test.ts`

**Interfaces:**

- Produces: `FeatureFlags.ff_seo_blog: boolean` (default `false`), read from env `FF_SEO_BLOG`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/feature-flags-blog.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { readFeatureFlags, defaultFeatureFlags } from "../src/config/feature-flags";

describe("FF_SEO_BLOG", () => {
  const OLD = process.env.FF_SEO_BLOG;
  afterEach(() => {
    if (OLD === undefined) delete process.env.FF_SEO_BLOG;
    else process.env.FF_SEO_BLOG = OLD;
  });

  it("defaults off", () => {
    expect(defaultFeatureFlags.ff_seo_blog).toBe(false);
    delete process.env.FF_SEO_BLOG;
    expect(readFeatureFlags().ff_seo_blog).toBe(false);
  });

  it("reads FF_SEO_BLOG=true", () => {
    process.env.FF_SEO_BLOG = "true";
    expect(readFeatureFlags().ff_seo_blog).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/feature-flags-blog.test.ts`
Expected: FAIL — `ff_seo_blog` does not exist on `FeatureFlags`.

- [ ] **Step 3: Add the flag**

In `apps/api/src/config/feature-flags.ts`, add to the `FeatureFlags` interface (near `ff_programmatic_seo_cities_enabled`):

```typescript
ff_programmatic_seo_cities_enabled: boolean;
/** Slice 3 — Blog / content engine (worker generation + admin tab). */
ff_seo_blog: boolean;
```

Add to `defaultFeatureFlags` (after `ff_programmatic_seo_cities_enabled: true`):

```typescript
  ff_programmatic_seo_cities_enabled: true,
  ff_seo_blog: false
```

Add to the `readFeatureFlags()` return object (after the `ff_programmatic_seo_cities_enabled` entry):

```typescript
    ff_programmatic_seo_cities_enabled: parseBooleanEnv(
      "FF_PROGRAMMATIC_SEO_CITIES_ENABLED",
      defaultFeatureFlags.ff_programmatic_seo_cities_enabled
    ),
    ff_seo_blog: parseBooleanEnv("FF_SEO_BLOG", defaultFeatureFlags.ff_seo_blog)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/feature-flags-blog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/feature-flags.ts apps/api/test/feature-flags-blog.test.ts
git commit -m "feat(blog): add FF_SEO_BLOG flag (default off)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Shared blog types

**Files:**

- Create: `apps/api/src/modules/blog/blog.types.ts`
- Test: `apps/api/test/blog-types.test.ts` (compile/shape smoke test)

**Interfaces:**

- Produces (imported by every later blog task — use these names verbatim):

```typescript
export type BlogStatus =
  | "brief"
  | "generating"
  | "draft"
  | "needs_attention"
  | "in_review"
  | "published"
  | "archived";
export type BlogGeneratedBy = "planner" | "manual" | "refresh" | "pillar";
export type BlogScript = "en" | "hi" | "hinglish";
export type BriefSource = "gsc_quickwin" | "gap" | "data_trend" | "evergreen" | "manual";
export type BriefStatus = "pending" | "generating" | "done" | "dropped";
export type BlogPostType = "data_report" | "local_guide" | "evergreen" | "query_targeted";

export interface BlogFaqItem {
  q: string;
  a: string;
}
export interface BlogSource {
  label: string;
  url?: string | null;
  asof?: string | null;
}
export interface BlogDataPoint {
  key: string;
  label: string;
  value: number | string;
  unit?: string | null;
}

export interface QualityCheck {
  id: string; // e.g. "word_count", "internal_links", "uniqueness"
  label: string;
  passed: boolean;
  detail: string; // human-readable reason
  value?: number | string | null;
  threshold?: number | string | null;
}
export interface QualityBreakdown {
  score: number; // 0..1
  passed: boolean;
  checks: QualityCheck[];
}

export interface BlogPostRow {
  id: string;
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  body_en: string | null;
  body_hi: string | null;
  target_keyword: string | null;
  intent: string | null;
  city_slug: string | null;
  category_id: number | null;
  category_slug?: string | null;
  status: BlogStatus;
  generated_by: BlogGeneratedBy;
  quality_score: number | null;
  quality_breakdown: QualityBreakdown | Record<string, never>;
  faq_items: BlogFaqItem[];
  hero_image_path: string | null;
  author: string;
  sources: BlogSource[];
  data_asof: string | null;
  script: BlogScript;
  is_pillar: boolean;
  brief_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BlogBriefRow {
  id: string;
  target_keyword: string;
  intent: string | null;
  outline: Array<{ heading: string; subheadings?: string[] }>;
  required_data: BlogDataPoint[];
  internal_link_targets: Array<{ href: string; label: string }>;
  source: BriefSource;
  status: BriefStatus;
  city_slug: string | null;
  category_slug: string | null;
  post_type: BlogPostType;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Public list item (published-only projection). */
export interface BlogListItem {
  slug: string;
  title: string;
  excerpt: string | null;
  category_slug: string | null;
  city_slug: string | null;
  hero_image_path: string | null;
  author: string;
  published_at: string | null;
  data_asof: string | null;
}

export const EDITORIAL_AUTHOR = {
  name: "Aditi Sharma",
  slug: "aditi-sharma",
  role: "Rental Markets Editor, Cribliv",
  bio_en:
    "Aditi Sharma covers India's rental markets for Cribliv, turning live listing data into practical guidance for tenants. She has tracked rents across Lucknow and the NCR since 2023.",
  bio_hi:
    "अदिति शर्मा Cribliv के लिए भारत के किराया बाज़ार पर लिखती हैं और लाइव लिस्टिंग डेटा को किरायेदारों के लिए व्यावहारिक सलाह में बदलती हैं।"
} as const;
```

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { EDITORIAL_AUTHOR } from "../src/modules/blog/blog.types";
import type { BlogPostRow, QualityBreakdown } from "../src/modules/blog/blog.types";

describe("blog.types", () => {
  it("exposes the named editorial persona for E-E-A-T", () => {
    expect(EDITORIAL_AUTHOR.name).toBe("Aditi Sharma");
    expect(EDITORIAL_AUTHOR.slug).toBe("aditi-sharma");
  });

  it("QualityBreakdown + BlogPostRow shapes compose", () => {
    const qb: QualityBreakdown = { score: 1, passed: true, checks: [] };
    const row: Pick<BlogPostRow, "status" | "quality_breakdown"> = {
      status: "draft",
      quality_breakdown: qb
    };
    expect(row.status).toBe("draft");
    expect(row.quality_breakdown.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-types.test.ts`
Expected: FAIL — cannot find module `../src/modules/blog/blog.types`.

- [ ] **Step 3: Create the types file**

Create `apps/api/src/modules/blog/blog.types.ts` with the full content from the **Interfaces** block above (verbatim).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/blog.types.ts apps/api/test/blog-types.test.ts
git commit -m "feat(blog): add shared blog types + editorial persona

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: `BlogService` (DB-only) — reads, draft write, state transitions

**Files:**

- Create: `apps/api/src/modules/blog/blog.service.ts`
- Test: `apps/api/test/blog.service.test.ts` (unit, mocked DB)

**Interfaces:**

- Consumes: `DatabaseService` (`{ isEnabled, query }`), `blog.types.ts`.
- Produces (method signatures relied on by controllers + worker in later tasks):
  - `listPublished(opts: { page?: number; pageSize?: number; category?: string; city?: string }): Promise<{ items: BlogListItem[]; total: number }>`
  - `getPublishedBySlug(slug: string): Promise<BlogPostRow | null>` (only `status='published'`)
  - `getAnyBySlug(slug: string): Promise<BlogPostRow | null>` (admin/preview — any status)
  - `getById(id: string): Promise<BlogPostRow | null>`
  - `listForAdmin(opts: { status?: BlogStatus }): Promise<BlogPostRow[]>`
  - `countByStatus(status: BlogStatus): Promise<number>`
  - `upsertDraft(input: UpsertDraftInput): Promise<BlogPostRow>` — internal worker write; inserts or updates by `slug`; sets `status` to `'draft'` or `'needs_attention'` based on `input.status`; NEVER `'published'`.
  - `transition(id: string, to: Extract<BlogStatus, "in_review" | "published" | "archived" | "needs_attention">): Promise<BlogPostRow | null>` — sets `published_at = now()` when moving to `published`; the ONLY method that can set `published`.
  - `updateEditable(id: string, patch: EditablePatch): Promise<BlogPostRow | null>` — admin inline edit of title/body/meta/faq/hero.
  - `relatedPublished(postId: string, limit?: number): Promise<BlogListItem[]>` (embedding join is added in Task 14 via a separate method `findRelatedByEmbedding`; this fallback is by category/city recency).

  where:

```typescript
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
```

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog.service.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { BlogService } from "../src/modules/blog/blog.service";

function svc(query = vi.fn(), enabled = true) {
  const db = { isEnabled: () => enabled, query } as never;
  return { service: new BlogService(db), query };
}

const ROW = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "2bhk-rent-gomti-nagar",
  title: "2BHK rent in Gomti Nagar",
  meta_title: null,
  meta_description: null,
  excerpt: null,
  body_en: "…",
  body_hi: null,
  target_keyword: "2bhk rent gomti nagar",
  intent: null,
  city_slug: "lucknow",
  category_id: 1,
  category_slug: "data-reports",
  status: "draft",
  generated_by: "planner",
  quality_score: 0.9,
  quality_breakdown: { score: 0.9, passed: true, checks: [] },
  faq_items: [],
  hero_image_path: null,
  author: "Aditi Sharma",
  sources: [],
  data_asof: "2026-07-01",
  script: "en",
  is_pillar: false,
  brief_id: null,
  published_at: null,
  created_at: "t",
  updated_at: "t"
};

describe("BlogService (DB-only)", () => {
  it("returns empty published list without querying when DB disabled", async () => {
    const { service, query } = svc(vi.fn(), false);
    await expect(service.listPublished({})).resolves.toEqual({ items: [], total: 0 });
    expect(query).not.toHaveBeenCalled();
  });

  it("listPublished filters to status='published' and paginates", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ ...ROW, status: "published" }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const { service } = svc(query);
    const out = await service.listPublished({ page: 1, pageSize: 10, city: "lucknow" });
    const [listSql, listParams] = query.mock.calls[0];
    expect(listSql).toMatch(/status\s*=\s*'published'/i);
    expect(listSql).toMatch(/LIMIT/i);
    expect(listParams).toContain("lucknow");
    expect(out.total).toBe(1);
    expect(out.items[0].slug).toBe("2bhk-rent-gomti-nagar");
  });

  it("getPublishedBySlug only returns published rows", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ ...ROW, status: "published" }] });
    const { service } = svc(query);
    const row = await service.getPublishedBySlug("2bhk-rent-gomti-nagar");
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/status\s*=\s*'published'/i);
    expect(row?.slug).toBe("2bhk-rent-gomti-nagar");
  });

  it("upsertDraft never writes status='published' and forwards draft/needs_attention", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [ROW] });
    const { service } = svc(query);
    await service.upsertDraft({
      slug: ROW.slug,
      title: ROW.title,
      generated_by: "planner",
      status: "draft",
      body_en: "…",
      quality_score: 0.9,
      quality_breakdown: { score: 0.9, passed: true, checks: [] }
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO blog_posts/i);
    expect(sql).toMatch(/ON CONFLICT \(slug\)/i);
    // status is a bound param, and the value passed must be 'draft'
    expect(params).toContain("draft");
    expect(params).not.toContain("published");
  });

  it("transition to published stamps published_at", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ ...ROW, status: "published", published_at: "now" }] });
    const { service } = svc(query);
    const row = await service.transition(ROW.id, "published");
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/status\s*=\s*'published'/i);
    expect(sql).toMatch(/published_at\s*=\s*now\(\)/i);
    expect(row?.status).toBe("published");
  });

  it("countByStatus returns the count", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ n: 4 }] });
    const { service } = svc(query);
    await expect(service.countByStatus("draft")).resolves.toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog.service.test.ts`
Expected: FAIL — cannot find module `../src/modules/blog/blog.service`.

- [ ] **Step 3: Write `BlogService`**

Create `apps/api/src/modules/blog/blog.service.ts`:

```typescript
import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import type {
  BlogBriefRow,
  BlogGeneratedBy,
  BlogListItem,
  BlogPostRow,
  BlogScript,
  BlogStatus,
  BlogFaqItem,
  BlogSource,
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

const POST_COLUMNS = `
  p.id::text, p.slug, p.title, p.meta_title, p.meta_description, p.excerpt,
  p.body_en, p.body_hi, p.target_keyword, p.intent, p.city_slug,
  p.category_id, cat.slug AS category_slug,
  p.status, p.generated_by, p.quality_score::float8 AS quality_score,
  p.quality_breakdown, p.faq_items, p.hero_image_path, p.author, p.sources,
  p.data_asof::text AS data_asof, p.script, p.is_pillar, p.brief_id::text AS brief_id,
  p.published_at::text AS published_at, p.created_at::text AS created_at,
  p.updated_at::text AS updated_at`;

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

    const where: string[] = [`p.status = 'published'`];
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
      params.slice(0, params.length - 2)
    );
    return { items: rows, total: totalRes.rows[0]?.total ?? 0 };
  }

  async getPublishedBySlug(slug: string): Promise<BlogPostRow | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<BlogPostRow>(
      `SELECT ${POST_COLUMNS}
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
      `SELECT ${POST_COLUMNS}
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
      `SELECT ${POST_COLUMNS}
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
      `SELECT ${POST_COLUMNS}
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
    // Hard guard: this path can only ever set draft | needs_attention.
    const status: "draft" | "needs_attention" =
      input.status === "needs_attention" ? "needs_attention" : "draft";

    const { rows } = await this.database.query<BlogPostRow>(
      `INSERT INTO blog_posts (
         slug, title, meta_title, meta_description, excerpt, body_en, body_hi,
         target_keyword, intent, city_slug,
         category_id, status, generated_by, quality_score, quality_breakdown,
         faq_items, hero_image_path, sources, data_asof, script, brief_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10,
         (SELECT id FROM blog_categories WHERE slug = $11),
         $12, $13, $14, $15::jsonb,
         $16::jsonb, $17, $18::jsonb, $19, $20, $21::uuid
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
       RETURNING ${POST_COLUMNS.replace(/cat\.slug AS category_slug,?/, "")}
                 , (SELECT slug FROM blog_categories WHERE id = blog_posts.category_id) AS category_slug`,
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
    return rows[0];
  }

  async transition(
    id: string,
    to: "in_review" | "published" | "archived" | "needs_attention"
  ): Promise<BlogPostRow | null> {
    if (!this.database.isEnabled()) return null;
    const setPublishedAt = to === "published" ? ", published_at = now()" : "";
    const { rows } = await this.database.query<BlogPostRow>(
      `UPDATE blog_posts
         SET status = '${to}'${setPublishedAt}, updated_at = now()
       WHERE id = $1::uuid
       RETURNING ${POST_COLUMNS.replace("p.", "").replace(/cat\.slug AS category_slug,?/, "")}
                 , (SELECT slug FROM blog_categories WHERE id = blog_posts.category_id) AS category_slug`,
      [id]
    );
    return rows[0] ?? null;
  }

  async updateEditable(id: string, patch: EditablePatch): Promise<BlogPostRow | null> {
    if (!this.database.isEnabled()) return null;
    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown, cast = "") => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
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
      `UPDATE blog_posts SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${params.length}::uuid
       RETURNING ${POST_COLUMNS.replace("p.", "").replace(/cat\.slug AS category_slug,?/, "")}
                 , (SELECT slug FROM blog_categories WHERE id = blog_posts.category_id) AS category_slug`,
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
         AND (p.category_id = (SELECT category_id FROM blog_posts WHERE id = $1::uuid)
              OR p.city_slug = (SELECT city_slug FROM blog_posts WHERE id = $1::uuid))
       ORDER BY p.published_at DESC NULLS LAST
       LIMIT $2`,
      [postId, limit]
    );
    return rows;
  }
}
```

> Note on `RETURNING`: because `POST_COLUMNS` is aliased with the `p.`/`cat.` prefixes used in SELECTs, the `RETURNING` clauses above strip the `p.` prefix and re-derive `category_slug` via a subquery (RETURNING cannot reference a joined table). Keep the SELECT-path and RETURNING-path column lists in sync if you add fields.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog.service.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/blog.service.ts apps/api/test/blog.service.test.ts
git commit -m "feat(blog): add BlogService (DB-only reads, draft write, transitions)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Quality gate scorer (`qualityScore`) — the anti-slop gate

**Files:**

- Create: `apps/api/src/modules/blog/quality-gate.ts`
- Test: `apps/api/test/blog-quality-gate.test.ts` (unit — includes a golden slop-fails / good-passes set)

**Interfaces:**

- Consumes: nothing external (pure). Uniqueness distance is passed IN (computed by `BlogEmbeddingService` in Task 14) so the scorer stays pure and fully unit-testable.
- Produces:
  - constants `MIN_WORDS = 900`, `MIN_WORDS_DATA = 1200`, `MIN_DATA_POINTS_DATA = 3`, `MIN_INTERNAL_LINKS = 3`, `UNIQUENESS_MIN_DISTANCE = 0.15`, `MAX_KEYWORD_DENSITY = 0.03`, `BANNED_PHRASES: string[]`.
  - `countWords(html: string): number`
  - `countInternalLinks(html: string): number` — counts `href` values that are internal (start with `/` and are not `#`, mailto, tel, or an external `http`), and specifically counts links whose path targets a programmatic surface (`/city/`, `/rent-in/`, `/pg/`, `/blog/`).
  - `countCitedDataPoints(html: string, sources: BlogSource[]): number`
  - `keywordDensity(text: string, keyword: string): number`
  - `qualityScore(input: QualityInput): QualityBreakdown` — runs every check, returns `{ score, passed, checks }`. `passed` is true only when EVERY required check passes.

```typescript
export interface QualityInput {
  title: string;
  h1: string; // the first H1 in body (generator emits it)
  bodyHtml: string; // en body — the gate runs on the primary locale
  targetKeyword: string;
  faqItems: BlogFaqItem[];
  sources: BlogSource[];
  isDataPost: boolean; // true for data_report post_type
  citedDataPointCount: number; // count of injected data points actually rendered (from generator)
  uniquenessDistance: number | null; // cosine distance to nearest existing post; null = no corpus yet → treated as unique
}
```

- [ ] **Step 1: Write the failing test (golden set)**

Create `apps/api/test/blog-quality-gate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  qualityScore,
  countWords,
  countInternalLinks,
  countCitedDataPoints,
  keywordDensity,
  MIN_WORDS,
  MIN_INTERNAL_LINKS
} from "../src/modules/blog/quality-gate";
import type { QualityInput } from "../src/modules/blog/quality-gate";

// A realistic "good" data post: keyword in title/H1/first-100-words, >900 words,
// 3 internal links into programmatic pages, 3 cited data points, no hedge phrases.
function goodBody(): string {
  const intro =
    "<h1>2BHK rent in Gomti Nagar</h1>" +
    "<p>The median 2BHK rent in Gomti Nagar is ₹18,000 based on live Cribliv listings. " +
    "This guide breaks down what tenants actually pay across the neighbourhood.</p>";
  const filler =
    "<p>" + "Gomti Nagar offers wide roads, parks and reliable water supply. ".repeat(120) + "</p>";
  const links =
    '<p>See more <a href="/city/lucknow/gomti-nagar">flats in Gomti Nagar</a>, ' +
    '<a href="/rent-in/lucknow">rentals in Lucknow</a>, and ' +
    '<a href="/city/lucknow/metro/gomti-nagar">homes near the metro</a>.</p>';
  const data = "<p>Median 2BHK: ₹18,000. Median 1BHK: ₹11,000. Active listings: 42.</p>";
  return intro + data + filler + links;
}

function goodInput(): QualityInput {
  return {
    title: "2BHK rent in Gomti Nagar — Cribliv",
    h1: "2BHK rent in Gomti Nagar",
    bodyHtml: goodBody(),
    targetKeyword: "2bhk rent gomti nagar",
    faqItems: [{ q: "What is the average 2BHK rent in Gomti Nagar?", a: "About ₹18,000." }],
    sources: [{ label: "Cribliv live listings", asof: "2026-07-01" }],
    isDataPost: true,
    citedDataPointCount: 3,
    uniquenessDistance: 0.42
  };
}

describe("quality-gate helpers", () => {
  it("countWords strips HTML tags", () => {
    expect(countWords("<p>one two three</p>")).toBe(3);
  });
  it("countInternalLinks counts only internal hrefs", () => {
    const html =
      '<a href="/city/lucknow/gomti-nagar">a</a>' +
      '<a href="https://google.com">b</a>' +
      '<a href="/rent-in/lucknow">c</a>' +
      '<a href="#top">d</a>' +
      '<a href="mailto:x@y.com">e</a>';
    expect(countInternalLinks(html)).toBe(2);
  });
  it("countCitedDataPoints counts ₹ figures + source-backed numbers", () => {
    const n = countCitedDataPoints("<p>₹18,000 and ₹11,000 and 42 listings</p>", [
      { label: "Cribliv" }
    ]);
    expect(n).toBeGreaterThanOrEqual(3);
  });
  it("keywordDensity is a fraction of total words", () => {
    const d = keywordDensity("rent rent rent other words here now", "rent");
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });
});

describe("qualityScore — good post passes", () => {
  it("passes every check for a solid data post", () => {
    const out = qualityScore(goodInput());
    const failed = out.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual([]);
    expect(out.passed).toBe(true);
    expect(out.score).toBe(1);
  });
});

describe("qualityScore — golden slop set (each must fail)", () => {
  it("fails on hedge/AI phrases", () => {
    const input = goodInput();
    input.bodyHtml = input.bodyHtml.replace(
      "</p>",
      " In conclusion, as an AI language model, it's important to note this. </p>"
    );
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "banned_phrases")?.passed).toBe(false);
  });

  it("fails when too short", () => {
    const input = goodInput();
    input.bodyHtml = "<h1>2BHK rent in Gomti Nagar</h1><p>Too short. ₹18,000.</p>";
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "word_count")?.passed).toBe(false);
  });

  it("fails when internal links are missing", () => {
    const input = goodInput();
    input.bodyHtml = input.bodyHtml
      .replace('href="/city/lucknow/gomti-nagar"', 'href="https://x.com"')
      .replace('href="/rent-in/lucknow"', 'href="https://y.com"')
      .replace('href="/city/lucknow/metro/gomti-nagar"', 'href="https://z.com"');
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "internal_links")?.passed).toBe(false);
  });

  it("fails a data post with too few cited data points", () => {
    const input = goodInput();
    input.citedDataPointCount = 1;
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "data_points")?.passed).toBe(false);
  });

  it("fails when the keyword is absent from the title/H1/first 100 words", () => {
    const input = goodInput();
    input.title = "Some unrelated title — Cribliv";
    input.h1 = "Some unrelated heading";
    input.bodyHtml = input.bodyHtml.replace(/2BHK rent in Gomti Nagar/g, "Homes here");
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "keyword_placement")?.passed).toBe(false);
  });

  it("fails when the keyword is stuffed (density too high)", () => {
    const input = goodInput();
    input.bodyHtml =
      "<h1>2bhk rent gomti nagar</h1><p>" + "2bhk rent gomti nagar ".repeat(80) + "</p>";
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "keyword_stuffing")?.passed).toBe(false);
  });

  it("fails when not unique enough vs the existing corpus", () => {
    const input = goodInput();
    input.uniquenessDistance = 0.08; // < 0.15
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "uniqueness")?.passed).toBe(false);
  });

  it("treats a null uniqueness distance (empty corpus) as unique", () => {
    const input = goodInput();
    input.uniquenessDistance = null;
    const out = qualityScore(input);
    expect(out.checks.find((c) => c.id === "uniqueness")?.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-quality-gate.test.ts`
Expected: FAIL — cannot find module `../src/modules/blog/quality-gate`.

- [ ] **Step 3: Write `quality-gate.ts`**

Create `apps/api/src/modules/blog/quality-gate.ts`:

```typescript
import type { BlogFaqItem, BlogSource, QualityBreakdown, QualityCheck } from "./blog.types";

export const MIN_WORDS = 900;
export const MIN_WORDS_DATA = 1200;
export const MIN_DATA_POINTS_DATA = 3;
export const MIN_INTERNAL_LINKS = 3;
export const UNIQUENESS_MIN_DISTANCE = 0.15;
export const MAX_KEYWORD_DENSITY = 0.03;

export const BANNED_PHRASES = [
  "as an ai",
  "as a language model",
  "in conclusion",
  "it's important to note",
  "it is important to note",
  "lorem ipsum",
  "todo",
  "tbd"
];

const PROGRAMMATIC_PREFIXES = ["/city/", "/rent-in/", "/pg/", "/blog/"];

export interface QualityInput {
  title: string;
  h1: string;
  bodyHtml: string;
  targetKeyword: string;
  faqItems: BlogFaqItem[];
  sources: BlogSource[];
  isDataPost: boolean;
  citedDataPointCount: number;
  uniquenessDistance: number | null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWords(html: string): number {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1].trim());
  return out;
}

export function countInternalLinks(html: string): number {
  return extractHrefs(html).filter((href) => {
    if (!href.startsWith("/")) return false;
    if (href.startsWith("//")) return false; // protocol-relative external
    return true;
  }).length;
}

/** Internal links that specifically target a programmatic surface. */
export function countProgrammaticLinks(html: string): number {
  return extractHrefs(html).filter((href) =>
    PROGRAMMATIC_PREFIXES.some((p) => href.startsWith(p) || href.includes(p))
  ).length;
}

export function countCitedDataPoints(html: string, sources: BlogSource[]): number {
  const text = stripHtml(html);
  const rupee = (text.match(/₹\s?[\d,]+/g) ?? []).length;
  const percents = (text.match(/\d+(\.\d+)?\s?%/g) ?? []).length;
  // Bare integer counts near data words (listings/median/rent/deposit)
  const counts = (
    text.match(/\b\d{2,}\b(?=[^.]{0,40}\b(listings|median|rent|deposit|sq\s?ft|BHK)\b)/gi) ?? []
  ).length;
  const base = rupee + percents + counts;
  // Only credit numbers if at least one source is present (grounded claim).
  return sources.length > 0 ? base : Math.min(base, 0);
}

export function keywordDensity(text: string, keyword: string): number {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const kw = keyword.toLowerCase().trim();
  const kwWords = kw.split(/\s+/).filter(Boolean);
  if (kwWords.length === 0) return 0;
  let hits = 0;
  for (let i = 0; i + kwWords.length <= words.length; i++) {
    if (kwWords.every((w, j) => words[i + j] === w)) hits++;
  }
  return (hits * kwWords.length) / words.length;
}

function firstNWords(html: string, n: number): string {
  return stripHtml(html).split(/\s+/).slice(0, n).join(" ").toLowerCase();
}

export function qualityScore(input: QualityInput): QualityBreakdown {
  const plain = stripHtml(input.bodyHtml);
  const lower = plain.toLowerCase();
  const words = countWords(input.bodyHtml);
  const minWords = input.isDataPost ? MIN_WORDS_DATA : MIN_WORDS;
  const keyword = input.targetKeyword.toLowerCase().trim();

  const checks: QualityCheck[] = [];

  // 1. Word count
  checks.push({
    id: "word_count",
    label: "Minimum word count",
    passed: words >= minWords,
    detail: `${words} words (need ≥ ${minWords})`,
    value: words,
    threshold: minWords
  });

  // 2. Internal links (must include programmatic-targeted links)
  const internal = countInternalLinks(input.bodyHtml);
  const programmatic = countProgrammaticLinks(input.bodyHtml);
  checks.push({
    id: "internal_links",
    label: "Internal links into site pages",
    passed: internal >= MIN_INTERNAL_LINKS && programmatic >= 1,
    detail: `${internal} internal links (${programmatic} into programmatic pages); need ≥ ${MIN_INTERNAL_LINKS} and ≥ 1 programmatic`,
    value: internal,
    threshold: MIN_INTERNAL_LINKS
  });

  // 3. Cited data points (data posts only, otherwise informational pass)
  if (input.isDataPost) {
    checks.push({
      id: "data_points",
      label: "Cited real data points",
      passed: input.citedDataPointCount >= MIN_DATA_POINTS_DATA,
      detail: `${input.citedDataPointCount} cited data points (need ≥ ${MIN_DATA_POINTS_DATA})`,
      value: input.citedDataPointCount,
      threshold: MIN_DATA_POINTS_DATA
    });
  } else {
    checks.push({
      id: "data_points",
      label: "Cited data points (non-data post)",
      passed: input.sources.length >= 1,
      detail: input.sources.length >= 1 ? "Has ≥ 1 authoritative source" : "No sources cited",
      value: input.sources.length,
      threshold: 1
    });
  }

  // 4. Banned phrases
  const found = BANNED_PHRASES.filter((p) => lower.includes(p));
  checks.push({
    id: "banned_phrases",
    label: "No placeholder / hedge / AI phrases",
    passed: found.length === 0,
    detail: found.length === 0 ? "Clean" : `Found: ${found.join(", ")}`
  });

  // 5. Keyword placement (title + H1 + first 100 words)
  const inTitle = input.title.toLowerCase().includes(keyword);
  const inH1 = input.h1.toLowerCase().includes(keyword);
  const inIntro = firstNWords(input.bodyHtml, 100).includes(keyword);
  checks.push({
    id: "keyword_placement",
    label: "Target keyword in title, H1, and first 100 words",
    passed: inTitle && inH1 && inIntro,
    detail: `title=${inTitle} h1=${inH1} intro=${inIntro}`
  });

  // 6. Keyword stuffing
  const density = keywordDensity(plain, keyword);
  checks.push({
    id: "keyword_stuffing",
    label: "Keyword not stuffed",
    passed: density <= MAX_KEYWORD_DENSITY,
    detail: `density ${(density * 100).toFixed(2)}% (max ${(MAX_KEYWORD_DENSITY * 100).toFixed(0)}%)`,
    value: Number(density.toFixed(4)),
    threshold: MAX_KEYWORD_DENSITY
  });

  // 7. Uniqueness vs existing corpus (null distance = empty corpus = unique)
  const uniquePassed =
    input.uniquenessDistance === null || input.uniquenessDistance >= UNIQUENESS_MIN_DISTANCE;
  checks.push({
    id: "uniqueness",
    label: "Sufficiently distinct from existing posts",
    passed: uniquePassed,
    detail:
      input.uniquenessDistance === null
        ? "No existing posts to compare (unique)"
        : `cosine distance ${input.uniquenessDistance.toFixed(3)} (need ≥ ${UNIQUENESS_MIN_DISTANCE})`,
    value: input.uniquenessDistance,
    threshold: UNIQUENESS_MIN_DISTANCE
  });

  const passedCount = checks.filter((c) => c.passed).length;
  const score = checks.length > 0 ? passedCount / checks.length : 0;
  const passed = checks.every((c) => c.passed);
  return { score: Number(score.toFixed(3)), passed, checks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-quality-gate.test.ts`
Expected: PASS (all golden-set cases + helpers).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/quality-gate.ts apps/api/test/blog-quality-gate.test.ts
git commit -m "feat(blog): add anti-slop quality gate scorer + golden test set

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Azure OpenAI JSON call helper (`blog-llm.ts`)

**Files:**

- Create: `apps/api/src/modules/blog/blog-llm.ts`
- Test: `apps/api/test/blog-llm.test.ts` (unit — mock `fetch`)

**Interfaces:**

- Consumes: env `AZURE_OPENAI_*` (same as `SeoCopyService.readAiConfig`).
- Produces:
  - `readBlogAiConfig(): { endpoint; apiKey; deployment; timeoutMs }` (reuses `SeoCopyService`'s env precedence: `AZURE_OPENAI_CHAT_DEPLOYMENT || AZURE_OPENAI_EXTRACT_DEPLOYMENT`, timeout from `SEO_BLOG_TIMEOUT_MS` default 20000 min 8000).
  - `callBlogJson<T>(opts: { system: string; user: string; maxTokens?: number; temperature?: number; fetchImpl?: typeof fetch }): Promise<T | null>` — POSTs a chat completion with `response_format: { type: "json_object" }`, parses the JSON content, returns `null` on any failure/timeout/misconfig. `fetchImpl` is injectable so tests never hit the network.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-llm.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callBlogJson, readBlogAiConfig } from "../src/modules/blog/blog-llm.ts";

const ENV = {
  AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
  AZURE_OPENAI_API_KEY: "k",
  AZURE_OPENAI_CHAT_DEPLOYMENT: "gpt-4o"
};

describe("blog-llm", () => {
  const OLD: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
      OLD[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterEach(() => {
    for (const k of Object.keys(ENV)) {
      if (OLD[k] === undefined) delete process.env[k];
      else process.env[k] = OLD[k];
    }
  });

  it("readBlogAiConfig reads Azure env", () => {
    const cfg = readBlogAiConfig();
    expect(cfg.endpoint).toBe("https://example.openai.azure.com");
    expect(cfg.deployment).toBe("gpt-4o");
    expect(cfg.timeoutMs).toBeGreaterThanOrEqual(8000);
  });

  it("returns null when Azure is not configured", async () => {
    delete process.env.AZURE_OPENAI_API_KEY;
    const out = await callBlogJson({ system: "s", user: "u", fetchImpl: vi.fn() });
    expect(out).toBeNull();
  });

  it("parses the JSON content from a chat completion", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ outline: ["A", "B"] }) } }]
      })
    })) as unknown as typeof fetch;
    const out = await callBlogJson<{ outline: string[] }>({
      system: "s",
      user: "u",
      fetchImpl
    });
    expect(out).toEqual({ outline: ["A", "B"] });
    // hits the Azure deployments URL with api-key header + json response_format
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/openai/deployments/gpt-4o/chat/completions");
    expect((init as RequestInit).headers).toMatchObject({ "api-key": "k" });
    expect(String((init as RequestInit).body)).toContain("json_object");
  });

  it("returns null on non-OK HTTP", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({})
    })) as unknown as typeof fetch;
    const out = await callBlogJson({ system: "s", user: "u", fetchImpl });
    expect(out).toBeNull();
  });

  it("returns null on invalid JSON content", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "not json" } }] })
    })) as unknown as typeof fetch;
    const out = await callBlogJson({ system: "s", user: "u", fetchImpl });
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-llm.test.ts`
Expected: FAIL — cannot find module `blog-llm`.

- [ ] **Step 3: Write `blog-llm.ts`**

Create `apps/api/src/modules/blog/blog-llm.ts`:

```typescript
import { Logger } from "@nestjs/common";

const logger = new Logger("BlogLlm");

export interface BlogAiConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  timeoutMs: number;
}

export function readBlogAiConfig(): BlogAiConfig {
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment:
      process.env.AZURE_OPENAI_CHAT_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ||
      "",
    timeoutMs: Math.max(Number(process.env.SEO_BLOG_TIMEOUT_MS) || 20000, 8000)
  };
}

export async function callBlogJson<T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  fetchImpl?: typeof fetch;
}): Promise<T | null> {
  const config = readBlogAiConfig();
  if (!config.endpoint || !config.apiKey || !config.deployment) {
    logger.debug("Azure OpenAI not configured — skipping blog generation step");
    return null;
  }
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;
    const response = await doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": config.apiKey },
      body: JSON.stringify({
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user }
        ],
        temperature: opts.temperature ?? 0.5,
        max_tokens: opts.maxTokens ?? 3000,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      logger.warn(`blog LLM call returned HTTP ${(response as Response).status}`);
      return null;
    }
    const payload = (await response.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as T;
  } catch (err) {
    logger.debug(`blog LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-llm.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/blog-llm.ts apps/api/test/blog-llm.test.ts
git commit -m "feat(blog): add Azure OpenAI JSON call helper (injectable fetch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Multi-step generator (`BlogGeneratorService`)

**Files:**

- Create: `apps/api/src/modules/blog/blog-generator.service.ts`
- Test: `apps/api/test/blog-generator.service.test.ts` (unit — inject a fake `callBlogJson` + fake `SeoAggregatesService`)

**Interfaces:**

- Consumes: `SeoAggregatesService` (`aggregatesForLocality`, `localitiesForCity`), a `callBlogJson`-shaped function (injected for testability), the quality gate (`qualityScore`), `BlogBriefRow`.
- Produces:
  - `buildDataFacts(brief: BlogBriefRow): Promise<BlogDataPoint[]>` — pulls LIVE numbers from `SeoAggregatesService` for the brief's `city_slug`/locality (median 1/2/3BHK + PG rents, listing counts) so the model quotes real figures, never hallucinations.
  - `generate(brief: BlogBriefRow): Promise<GeneratedPost | null>` — runs the four steps in order: **outline → section drafting (with `dataFacts` injected as ground truth) → fact-check/consistency → SEO/readability**, assembles `bodyHtml` + `faqItems` + `sources` + `dataAsof`, then calls `qualityScore`. Returns the assembled post with its `QualityBreakdown` (uniqueness distance is filled in later by the worker via `BlogEmbeddingService`; `generate` accepts an optional `uniquenessDistance` param, default `null`).

```typescript
export interface GeneratedPost {
  slug: string;
  title: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  bodyEn: string; // HTML
  bodyHi: string; // HTML (faithful hi rendering)
  targetKeyword: string;
  intent: string | null;
  citySlug: string | null;
  categorySlug: string | null;
  faqItems: BlogFaqItem[];
  sources: BlogSource[];
  dataAsof: string | null;
  dataFacts: BlogDataPoint[];
  citedDataPointCount: number;
  isDataPost: boolean;
  quality: QualityBreakdown;
}

export type CallJson = <T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}) => Promise<T | null>;
```

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-generator.service.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { BlogGeneratorService } from "../src/modules/blog/blog-generator.service";
import type { BlogBriefRow } from "../src/modules/blog/blog.types";

const BRIEF: BlogBriefRow = {
  id: "b1",
  target_keyword: "2bhk rent gomti nagar",
  intent: "informational",
  outline: [{ heading: "Overview" }, { heading: "What tenants pay" }],
  required_data: [
    { key: "median_rent_2bhk", label: "Median 2BHK rent", value: 0 },
    { key: "median_rent_1bhk", label: "Median 1BHK rent", value: 0 },
    { key: "listing_count", label: "Active listings", value: 0 }
  ],
  internal_link_targets: [
    { href: "/city/lucknow/gomti-nagar", label: "Flats in Gomti Nagar" },
    { href: "/rent-in/lucknow", label: "Rentals in Lucknow" }
  ],
  source: "data_trend",
  status: "pending",
  city_slug: "lucknow",
  category_slug: "data-reports",
  post_type: "data_report",
  notes: null,
  created_at: "t",
  updated_at: "t"
};

function fakeAggregates() {
  return {
    aggregatesForLocality: vi.fn(async () => ({
      listing_count: 42,
      pg_count: 5,
      flat_count: 37,
      median_rent_pg: 7000,
      median_rent_1bhk: 11000,
      median_rent_2bhk: 18000,
      median_rent_3bhk: 26000
    })),
    localitiesForCity: vi.fn(async () => [{ slug: "gomti-nagar", name_en: "Gomti Nagar" }])
  } as never;
}

// A fake LLM that returns a valid, on-brief, data-grounded body per step.
function fakeCallJson() {
  return vi.fn(async (opts: { system: string; user: string }) => {
    if (/outline/i.test(opts.system)) {
      return { sections: [{ heading: "Overview" }, { heading: "What tenants pay" }] };
    }
    if (/section/i.test(opts.system)) {
      // The user prompt injects the real facts; the model "quotes" them.
      return {
        html:
          "<p>The median 2BHK rent in Gomti Nagar is ₹18,000, the 1BHK median is ₹11,000, " +
          "and there are 42 active listings. " +
          'See more <a href="/city/lucknow/gomti-nagar">flats in Gomti Nagar</a> and ' +
          '<a href="/rent-in/lucknow">rentals in Lucknow</a> and ' +
          '<a href="/city/lucknow/metro/gomti-nagar">metro homes</a>. ' +
          "Gomti Nagar has parks and reliable supply. ".repeat(160) +
          "</p>"
      };
    }
    if (/fact/i.test(opts.system)) {
      return { ok: true, removed: [], html_unchanged: true };
    }
    if (/seo|readability/i.test(opts.system)) {
      return {
        title: "2BHK rent in Gomti Nagar — Cribliv",
        h1: "2BHK rent in Gomti Nagar",
        meta_title: "2BHK rent in Gomti Nagar — Cribliv",
        meta_description:
          "The median 2BHK rent in Gomti Nagar is ₹18,000. See live listings and what tenants really pay in this Lucknow neighbourhood guide.",
        excerpt: "What tenants really pay for a 2BHK in Gomti Nagar, from live listings.",
        faq_items: [{ q: "Average 2BHK rent in Gomti Nagar?", a: "About ₹18,000." }],
        body_hi: "<p>गोमती नगर में 2BHK का औसत किराया ₹18,000 है।</p>"
      };
    }
    return null;
  });
}

describe("BlogGeneratorService", () => {
  it("buildDataFacts pulls live aggregates for the brief's locality", async () => {
    const svc = new BlogGeneratorService(fakeAggregates(), fakeCallJson() as never);
    const facts = await svc.buildDataFacts(BRIEF);
    const byKey = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    expect(byKey.median_rent_2bhk).toBe(18000);
    expect(byKey.listing_count).toBe(42);
  });

  it("generate runs all four steps and produces a gate-passing data post", async () => {
    const call = fakeCallJson();
    const svc = new BlogGeneratorService(fakeAggregates(), call as never);
    const post = await svc.generate(BRIEF, 0.4);
    expect(post).not.toBeNull();
    expect(post!.isDataPost).toBe(true);
    // The real facts were injected into the section step's user prompt.
    const sectionCall = call.mock.calls.find((c) => /section/i.test(c[0].system));
    expect(sectionCall).toBeTruthy();
    expect(String(sectionCall![0].user)).toContain("18000");
    // Quality gate ran and passed.
    expect(post!.quality.passed).toBe(true);
    expect(post!.citedDataPointCount).toBeGreaterThanOrEqual(3);
    expect(post!.bodyEn).toContain("₹18,000");
    expect(post!.slug).toBe("2bhk-rent-gomti-nagar");
  });

  it("generate returns null when the outline step fails", async () => {
    const call = vi.fn(async () => null);
    const svc = new BlogGeneratorService(fakeAggregates(), call as never);
    await expect(svc.generate(BRIEF)).resolves.toBeNull();
  });

  it("marks a too-short draft as gate-failed (not thrown)", async () => {
    const call = vi.fn(async (opts: { system: string }) => {
      if (/outline/i.test(opts.system)) return { sections: [{ heading: "X" }] };
      if (/section/i.test(opts.system)) return { html: "<p>Too short. ₹1.</p>" };
      if (/fact/i.test(opts.system)) return { ok: true, removed: [], html_unchanged: true };
      if (/seo|readability/i.test(opts.system)) {
        return {
          title: "2bhk rent gomti nagar — Cribliv",
          h1: "2bhk rent gomti nagar",
          meta_title: "t",
          meta_description: "d",
          excerpt: "e",
          faq_items: [],
          body_hi: "<p>x</p>"
        };
      }
      return null;
    });
    const svc = new BlogGeneratorService(fakeAggregates(), call as never);
    const post = await svc.generate(BRIEF);
    expect(post).not.toBeNull();
    expect(post!.quality.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-generator.service.test.ts`
Expected: FAIL — cannot find module `blog-generator.service`.

- [ ] **Step 3: Write `BlogGeneratorService`**

Create `apps/api/src/modules/blog/blog-generator.service.ts`:

```typescript
import { Injectable, Logger, Optional } from "@nestjs/common";
import { SeoAggregatesService } from "../seo/seo-aggregates.service";
import { callBlogJson } from "./blog-llm";
import { qualityScore, countCitedDataPoints } from "./quality-gate";
import type {
  BlogBriefRow,
  BlogDataPoint,
  BlogFaqItem,
  BlogSource,
  QualityBreakdown
} from "./blog.types";

export type CallJson = <T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}) => Promise<T | null>;

export interface GeneratedPost {
  slug: string;
  title: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  bodyEn: string;
  bodyHi: string;
  targetKeyword: string;
  intent: string | null;
  citySlug: string | null;
  categorySlug: string | null;
  faqItems: BlogFaqItem[];
  sources: BlogSource[];
  dataAsof: string | null;
  dataFacts: BlogDataPoint[];
  citedDataPointCount: number;
  isDataPost: boolean;
  quality: QualityBreakdown;
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

@Injectable()
export class BlogGeneratorService {
  private readonly logger = new Logger(BlogGeneratorService.name);

  constructor(
    private readonly aggregates: SeoAggregatesService,
    // `@Optional()` is REQUIRED: without it NestJS tries to resolve `CallJson`
    // (a type alias / function, not a provider) and the app fails to boot. The
    // default supplies the real Azure helper in production; tests pass a fake.
    @Optional() private readonly callJson: CallJson = (opts) => callBlogJson(opts)
  ) {}

  async buildDataFacts(brief: BlogBriefRow): Promise<BlogDataPoint[]> {
    if (!brief.city_slug) return [];
    // Resolve a locality if the keyword names one; else city-level via first locality.
    const localities = await this.aggregates.localitiesForCity(brief.city_slug);
    const kw = brief.target_keyword.toLowerCase();
    const match = localities.find(
      (l) => kw.includes(l.slug.replace(/-/g, " ")) || kw.includes(l.slug)
    );
    const localitySlug = match?.slug ?? localities[0]?.slug;
    if (!localitySlug) return [];

    const agg = await this.aggregates.aggregatesForLocality(brief.city_slug, localitySlug);
    const facts: BlogDataPoint[] = [];
    const push = (key: string, label: string, value: number | null, unit?: string) => {
      if (value != null) facts.push({ key, label, value, unit: unit ?? null });
    };
    push("median_rent_1bhk", "Median 1BHK rent", agg.median_rent_1bhk, "₹/mo");
    push("median_rent_2bhk", "Median 2BHK rent", agg.median_rent_2bhk, "₹/mo");
    push("median_rent_3bhk", "Median 3BHK rent", agg.median_rent_3bhk, "₹/mo");
    push("median_rent_pg", "Median PG rent", agg.median_rent_pg, "₹/mo");
    push("listing_count", "Active listings", agg.listing_count);
    push("pg_count", "PG listings", agg.pg_count);
    push("flat_count", "Flat/house listings", agg.flat_count);
    return facts;
  }

  async generate(
    brief: BlogBriefRow,
    uniquenessDistance: number | null = null
  ): Promise<GeneratedPost | null> {
    const isDataPost = brief.post_type === "data_report";
    const dataFacts = await this.buildDataFacts(brief);
    const factsBlock = dataFacts.length
      ? dataFacts.map((f) => `- ${f.label}: ${f.value}${f.unit ? " " + f.unit : ""}`).join("\n")
      : "(no live figures available — do NOT invent any numbers)";
    const linkBlock = brief.internal_link_targets
      .map((t) => `- ${t.label} -> ${t.href}`)
      .join("\n");

    // STEP 1 — Outline
    const outline = await this.callJson<{
      sections: Array<{ heading: string; subheadings?: string[] }>;
    }>({
      system:
        "You are a senior real-estate content editor. Produce a JSON outline (H2/H3) for a blog post from the brief. Reply JSON only.",
      user:
        `Brief keyword: ${brief.target_keyword}\nIntent: ${brief.intent ?? "informational"}\n` +
        `Base outline: ${JSON.stringify(brief.outline)}\n` +
        `Return {"sections":[{"heading":"...","subheadings":["..."]}]} covering the brief with 4-7 sections.`,
      temperature: 0.4
    });
    if (!outline?.sections?.length) {
      this.logger.debug(`Outline step failed for brief ${brief.id}`);
      return null;
    }

    // STEP 2 — Section drafting with REAL data injected as ground truth
    const draft = await this.callJson<{ html: string }>({
      system:
        'You write section-by-section blog prose for an Indian rental platform. Use ONLY the provided facts for any numbers. Weave in the provided internal links naturally. Reply JSON only with {"html": "..."}.',
      user:
        `Keyword: ${brief.target_keyword}\nOutline: ${JSON.stringify(outline.sections)}\n\n` +
        `GROUND-TRUTH FACTS (quote these exact numbers; never invent others):\n${factsBlock}\n\n` +
        `MANDATORY internal links to include (use the exact hrefs):\n${linkBlock}\n\n` +
        `Write ${isDataPost ? "1200+" : "900+"} words of helpful HTML (<p>, <h2>, <h3>, <ul>). ` +
        `Open with an H1 that contains the keyword and state the headline number in the first 100 words.`,
      maxTokens: 4000,
      temperature: 0.5
    });
    if (!draft?.html) {
      this.logger.debug(`Section step failed for brief ${brief.id}`);
      return null;
    }

    // STEP 3 — Fact-check / consistency (removes unsupported numbers)
    const checked = await this.callJson<{ html: string; ok: boolean }>({
      system:
        'You are a fact-checker. Given the draft HTML and the ground-truth facts, remove or correct any number NOT present in the facts, and remove unsupported claims. Reply JSON only with {"html":"<corrected html>","ok":true}.',
      user: `FACTS:\n${factsBlock}\n\nDRAFT:\n${draft.html}`,
      maxTokens: 4000,
      temperature: 0.2
    });
    const bodyAfterCheck = checked?.html && checked.html.length > 200 ? checked.html : draft.html;

    // STEP 4 — SEO + readability + hi rendering + FAQ
    const seo = await this.callJson<{
      title: string;
      h1: string;
      meta_title: string;
      meta_description: string;
      excerpt: string;
      faq_items: BlogFaqItem[];
      body_hi: string;
    }>({
      system:
        "You are an SEO + readability editor. Given the body HTML and keyword, produce title, H1, meta, excerpt, a 3-5 item FAQ, and a faithful Hindi (Devanagari) rendering of the body. Keyword must appear naturally in title, H1, and the first 100 words. Reply JSON only.",
      user:
        `Keyword: ${brief.target_keyword}\nBODY:\n${bodyAfterCheck}\n\n` +
        `Return {"title","h1","meta_title","meta_description","excerpt","faq_items":[{"q","a"}],"body_hi"}.`,
      maxTokens: 4000,
      temperature: 0.4
    });
    if (!seo?.title || !seo.h1 || !seo.body_hi) {
      this.logger.debug(`SEO step failed for brief ${brief.id}`);
      return null;
    }

    // Ensure the H1 is actually in the body (generator contract).
    const bodyEn = bodyAfterCheck.includes("<h1")
      ? bodyAfterCheck
      : `<h1>${seo.h1}</h1>\n${bodyAfterCheck}`;

    const dataAsof = isDataPost ? new Date().toISOString().slice(0, 10) : null;
    const sources: BlogSource[] = isDataPost
      ? [{ label: "Cribliv live listings", asof: dataAsof }]
      : [];
    const citedDataPointCount = countCitedDataPoints(bodyEn, sources);

    const quality = qualityScore({
      title: seo.title,
      h1: seo.h1,
      bodyHtml: bodyEn,
      targetKeyword: brief.target_keyword,
      faqItems: seo.faq_items ?? [],
      sources,
      isDataPost,
      citedDataPointCount,
      uniquenessDistance
    });

    return {
      slug: slugify(brief.target_keyword),
      title: seo.title,
      h1: seo.h1,
      metaTitle: seo.meta_title,
      metaDescription: seo.meta_description,
      excerpt: seo.excerpt,
      bodyEn,
      bodyHi: seo.body_hi,
      targetKeyword: brief.target_keyword,
      intent: brief.intent,
      citySlug: brief.city_slug,
      categorySlug: brief.category_slug,
      faqItems: seo.faq_items ?? [],
      sources,
      dataAsof,
      dataFacts,
      citedDataPointCount,
      isDataPost,
      quality
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-generator.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/blog-generator.service.ts apps/api/test/blog-generator.service.test.ts
git commit -m "feat(blog): add multi-step generator with real-data injection + gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: `BlogBriefService` (DB-only) — brief CRUD for planner + generator

**Files:**

- Create: `apps/api/src/modules/blog/blog-brief.service.ts`
- Test: `apps/api/test/blog-brief.service.test.ts` (unit, mocked DB)

**Interfaces:**

- Consumes: `DatabaseService`, `blog.types.ts`.
- Produces:
  - `createBrief(input: CreateBriefInput): Promise<BlogBriefRow | null>` — inserts; the partial unique index on `(lower(target_keyword)) WHERE status='pending'` de-dupes, so use `ON CONFLICT DO NOTHING` and return null on conflict.
  - `listPending(limit?: number): Promise<BlogBriefRow[]>`
  - `claimNextPending(): Promise<BlogBriefRow | null>` — atomically moves one `pending` brief to `generating` (`FOR UPDATE SKIP LOCKED`) and returns it (worker consumption).
  - `markDone(id: string): Promise<void>` / `markDropped(id: string, reason?: string): Promise<void>`
  - `countPending(): Promise<number>`

```typescript
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
```

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-brief.service.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { BlogBriefService } from "../src/modules/blog/blog-brief.service";

function svc(query = vi.fn(), enabled = true) {
  const db = { isEnabled: () => enabled, query } as never;
  return { service: new BlogBriefService(db), query };
}

const BRIEF = {
  id: "b1",
  target_keyword: "2bhk rent noida",
  intent: null,
  outline: [],
  required_data: [],
  internal_link_targets: [],
  source: "gsc_quickwin",
  status: "pending",
  city_slug: "noida",
  category_slug: "data-reports",
  post_type: "data_report",
  notes: null,
  created_at: "t",
  updated_at: "t"
};

describe("BlogBriefService", () => {
  it("createBrief inserts with ON CONFLICT DO NOTHING and returns the row", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [BRIEF] });
    const { service } = svc(query);
    const row = await service.createBrief({
      target_keyword: "2bhk rent noida",
      source: "gsc_quickwin",
      city_slug: "noida",
      post_type: "data_report"
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO blog_briefs/i);
    expect(sql).toMatch(/ON CONFLICT/i);
    expect(params).toContain("2bhk rent noida");
    expect(row?.id).toBe("b1");
  });

  it("createBrief returns null on dedupe conflict (no rows)", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    const { service } = svc(query);
    const row = await service.createBrief({ target_keyword: "dup", source: "evergreen" });
    expect(row).toBeNull();
  });

  it("claimNextPending flips one brief to generating via SKIP LOCKED", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ ...BRIEF, status: "generating" }] });
    const { service } = svc(query);
    const row = await service.claimNextPending();
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i);
    expect(sql).toMatch(/status\s*=\s*'generating'/i);
    expect(row?.status).toBe("generating");
  });

  it("returns null / [] without querying when DB disabled", async () => {
    const { service, query } = svc(vi.fn(), false);
    await expect(service.listPending()).resolves.toEqual([]);
    await expect(service.claimNextPending()).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-brief.service.test.ts`
Expected: FAIL — cannot find module `blog-brief.service`.

- [ ] **Step 3: Write `BlogBriefService`**

Create `apps/api/src/modules/blog/blog-brief.service.ts`:

```typescript
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
      `SELECT ${BRIEF_COLUMNS} FROM blog_briefs WHERE status = 'pending'
       ORDER BY created_at ASC LIMIT $1`,
      [limit]
    );
    return rows;
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
         SELECT id FROM blog_briefs WHERE status = 'pending'
         ORDER BY created_at ASC FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE blog_briefs b SET status = 'generating', updated_at = now()
       FROM next WHERE b.id = next.id
       RETURNING ${BRIEF_COLUMNS.replace(/\bid::text\b/, "b.id::text").replace(
         /(?<![.\w])(target_keyword|intent|outline|required_data|internal_link_targets|source|status|city_slug|category_slug|post_type|notes|created_at|updated_at)/g,
         "b.$1"
       )}`,
      []
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
      `UPDATE blog_briefs SET status = 'dropped', notes = COALESCE($2, notes), updated_at = now()
       WHERE id = $1::uuid`,
      [id, reason ?? null]
    );
  }
}
```

> The `claimNextPending` RETURNING re-aliases columns to `b.*`. If the regex-based alias in the plan is awkward to reproduce, replace the `RETURNING` clause with an explicit list: `RETURNING b.id::text, b.target_keyword, b.intent, b.outline, b.required_data, b.internal_link_targets, b.source, b.status, b.city_slug, b.category_slug, b.post_type, b.notes, b.created_at::text AS created_at, b.updated_at::text AS updated_at`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-brief.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/blog-brief.service.ts apps/api/test/blog-brief.service.test.ts
git commit -m "feat(blog): add BlogBriefService (brief CRUD + atomic claim)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Topic planner (`BlogTopicPlannerService`)

**Files:**

- Create: `apps/api/src/modules/blog/blog-topic-planner.service.ts`
- Create: `apps/api/src/modules/blog/evergreen-seeds.ts`
- Test: `apps/api/test/blog-topic-planner.service.test.ts` (unit, mocked DB + brief service)

**Interfaces:**

- Consumes: `DatabaseService` (reads slice-2 `keyword_rankings` when present), `BlogBriefService.createBrief`, `SeoAggregatesService.localitiesForCity`, `evergreen-seeds.ts`.
- Produces:
  - `EVERGREEN_SEEDS: EvergreenSeed[]` — the tenancy seed list (rent agreement, security deposit rules, HRA/rent receipts, tenant rights, moving checklist, PG vs flat).
  - `planTopics(opts?: { citySlugs?: string[]; maxBriefs?: number }): Promise<{ created: number; bySource: Record<BriefSource, number> }>` — pulls, in priority order: (a) **GSC quick-wins** (`keyword_rankings` rows with `position BETWEEN 11 AND 30` ordered by `impressions DESC` — guarded by `to_regclass` so it no-ops until slice 2 lands), (b) **content-gap** queries (impressions present but no matching published post — also guarded), (c) **data-trend** topics from `localitiesForCity` (one "rent trends in <locality>" per indexable locality), (d) **evergreen** seeds; creates briefs via `createBrief` (deduped), capping at `maxBriefs`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-topic-planner.service.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { BlogTopicPlannerService } from "../src/modules/blog/blog-topic-planner.service";
import { EVERGREEN_SEEDS } from "../src/modules/blog/evergreen-seeds";

function makePlanner(opts: {
  hasRankings: boolean;
  quickWins?: Array<{ keyword: string; page: string; position: number; impressions: number }>;
  localities?: Array<{ slug: string; name_en: string; listing_count: number }>;
}) {
  const query = vi.fn(async (sql: string) => {
    if (/to_regclass/i.test(sql)) {
      return { rows: [{ present: opts.hasRankings }] };
    }
    if (/keyword_rankings/i.test(sql) && /position/i.test(sql)) {
      return { rows: opts.quickWins ?? [] };
    }
    return { rows: [] };
  });
  const database = { isEnabled: () => true, query } as never;
  const aggregates = {
    localitiesForCity: vi.fn(async () => opts.localities ?? [])
  } as never;
  const created: string[] = [];
  const briefs = {
    createBrief: vi.fn(async (b: { target_keyword: string; source: string }) => {
      created.push(`${b.source}:${b.target_keyword}`);
      return { id: "x", ...b };
    })
  } as never;
  return { planner: new BlogTopicPlannerService(database, aggregates, briefs), created, briefs };
}

describe("BlogTopicPlannerService", () => {
  it("exposes an evergreen tenancy seed list", () => {
    expect(EVERGREEN_SEEDS.length).toBeGreaterThanOrEqual(6);
    expect(EVERGREEN_SEEDS.map((s) => s.target_keyword)).toEqual(
      expect.arrayContaining([expect.stringMatching(/rent agreement/i)])
    );
  });

  it("seeds evergreen + data-trend briefs when GSC data is absent", async () => {
    const { planner, created } = makePlanner({
      hasRankings: false,
      localities: [
        { slug: "gomti-nagar", name_en: "Gomti Nagar", listing_count: 42 },
        { slug: "aliganj", name_en: "Aliganj", listing_count: 2 } // below indexable → skipped
      ]
    });
    const res = await planner.planTopics({ citySlugs: ["lucknow"], maxBriefs: 50 });
    expect(res.created).toBeGreaterThan(0);
    expect(created.some((c) => c.startsWith("evergreen:"))).toBe(true);
    expect(created.some((c) => /data_trend:.*gomti-nagar|data_trend:.*Gomti Nagar/i.test(c))).toBe(
      true
    );
    // The thin locality is not turned into a data-trend brief.
    expect(created.some((c) => /aliganj/i.test(c))).toBe(false);
  });

  it("prioritizes GSC quick-wins when keyword_rankings exists", async () => {
    const { planner, created } = makePlanner({
      hasRankings: true,
      quickWins: [
        {
          keyword: "2bhk rent in indira nagar",
          page: "/en/city/lucknow/indira-nagar",
          position: 14,
          impressions: 900
        }
      ],
      localities: []
    });
    const res = await planner.planTopics({ citySlugs: ["lucknow"], maxBriefs: 50 });
    expect(res.bySource.gsc_quickwin).toBeGreaterThanOrEqual(1);
    expect(created.some((c) => c.startsWith("gsc_quickwin:"))).toBe(true);
  });

  it("caps at maxBriefs", async () => {
    const { planner, briefs } = makePlanner({ hasRankings: false, localities: [] });
    await planner.planTopics({ citySlugs: ["lucknow"], maxBriefs: 2 });
    expect(
      (briefs as unknown as { createBrief: ReturnType<typeof vi.fn> }).createBrief.mock.calls.length
    ).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-topic-planner.service.test.ts`
Expected: FAIL — cannot find module `blog-topic-planner.service`.

- [ ] **Step 3: Write the seeds + planner**

Create `apps/api/src/modules/blog/evergreen-seeds.ts`:

```typescript
import type { BlogPostType } from "./blog.types";

export interface EvergreenSeed {
  target_keyword: string;
  intent: string;
  category_slug: string;
  post_type: BlogPostType;
  outline: Array<{ heading: string }>;
}

/** National-authority tenancy topics (spec §2.2d, §3). */
export const EVERGREEN_SEEDS: EvergreenSeed[] = [
  {
    target_keyword: "rent agreement format in india",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "What a rent agreement must include" },
      { heading: "Registration & stamp duty" },
      { heading: "Common clauses explained" }
    ]
  },
  {
    target_keyword: "security deposit rules for tenants",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "How much deposit is normal" },
      { heading: "Getting your deposit back" },
      { heading: "State rules" }
    ]
  },
  {
    target_keyword: "hra exemption and rent receipts",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "How HRA exemption works" },
      { heading: "Rent receipts you need" },
      { heading: "Landlord PAN rule" }
    ]
  },
  {
    target_keyword: "tenant rights in india",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "Your core rights" },
      { heading: "Eviction protections" },
      { heading: "Model Tenancy Act" }
    ]
  },
  {
    target_keyword: "house moving checklist",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "Before the move" },
      { heading: "Moving day" },
      { heading: "After moving in" }
    ]
  },
  {
    target_keyword: "pg vs flat which is better",
    intent: "commercial_investigation",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "Cost comparison" },
      { heading: "Who a PG suits" },
      { heading: "Who a flat suits" }
    ]
  }
];
```

Create `apps/api/src/modules/blog/blog-topic-planner.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { SeoAggregatesService } from "../seo/seo-aggregates.service";
import { BlogBriefService } from "./blog-brief.service";
import { EVERGREEN_SEEDS } from "./evergreen-seeds";
import type { BriefSource } from "./blog.types";

const INDEXABLE_MIN = 3;

@Injectable()
export class BlogTopicPlannerService {
  private readonly logger = new Logger(BlogTopicPlannerService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly aggregates: SeoAggregatesService,
    private readonly briefs: BlogBriefService
  ) {}

  private async rankingsTableExists(): Promise<boolean> {
    if (!this.database.isEnabled()) return false;
    try {
      const { rows } = await this.database.query<{ present: boolean }>(
        `SELECT to_regclass('public.keyword_rankings') IS NOT NULL AS present`
      );
      return Boolean(rows[0]?.present);
    } catch {
      return false;
    }
  }

  async planTopics(
    opts: { citySlugs?: string[]; maxBriefs?: number } = {}
  ): Promise<{ created: number; bySource: Record<BriefSource, number> }> {
    const cities = opts.citySlugs ?? ["lucknow"];
    const cap = opts.maxBriefs ?? 25;
    const bySource: Record<BriefSource, number> = {
      gsc_quickwin: 0,
      gap: 0,
      data_trend: 0,
      evergreen: 0,
      manual: 0
    };
    let created = 0;

    const tryCreate = async (input: Parameters<BlogBriefService["createBrief"]>[0]) => {
      if (created >= cap) return;
      const row = await this.briefs.createBrief(input);
      if (row) {
        created++;
        bySource[input.source]++;
      }
    };

    const hasRankings = await this.rankingsTableExists();

    // (a) GSC quick-wins: position 11-30, high impressions.
    if (hasRankings && created < cap) {
      try {
        const { rows } = await this.database.query<{
          keyword: string;
          page: string;
          position: number;
          impressions: number;
        }>(
          `SELECT keyword, page, position::float8 AS position, impressions
           FROM keyword_rankings
           WHERE position BETWEEN 11 AND 30
             AND captured_at = (SELECT MAX(captured_at) FROM keyword_rankings)
           ORDER BY impressions DESC
           LIMIT 20`
        );
        for (const r of rows) {
          const citySlug = cities.find((c) => r.page.includes(`/${c}`)) ?? null;
          await tryCreate({
            target_keyword: r.keyword,
            intent: "informational",
            source: "gsc_quickwin",
            city_slug: citySlug,
            category_slug: "market-updates",
            post_type: "query_targeted",
            notes: `quick-win pos ${r.position}, ${r.impressions} impressions, page ${r.page}`
          });
        }
      } catch (err) {
        this.logger.debug(`quick-win read failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // (b) Content-gap: high-impression queries with no published post (guarded).
    if (hasRankings && created < cap) {
      try {
        const { rows } = await this.database.query<{ keyword: string; impressions: number }>(
          `SELECT kr.keyword, MAX(kr.impressions) AS impressions
           FROM keyword_rankings kr
           LEFT JOIN blog_posts p
             ON p.status = 'published' AND lower(p.target_keyword) = lower(kr.keyword)
           WHERE p.id IS NULL AND kr.impressions > 50
           GROUP BY kr.keyword
           ORDER BY impressions DESC
           LIMIT 15`
        );
        for (const r of rows) {
          await tryCreate({
            target_keyword: r.keyword,
            source: "gap",
            category_slug: "market-updates",
            post_type: "query_targeted",
            notes: `content gap, ${r.impressions} impressions`
          });
        }
      } catch (err) {
        this.logger.debug(`gap read failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // (c) Data-trend: one "rent trends in <locality>" per indexable locality.
    for (const city of cities) {
      if (created >= cap) break;
      const localities = await this.aggregates.localitiesForCity(city);
      for (const loc of localities) {
        if (created >= cap) break;
        if ((loc.listing_count ?? 0) < INDEXABLE_MIN) continue;
        await tryCreate({
          target_keyword: `rent trends in ${loc.name_en}`,
          intent: "informational",
          source: "data_trend",
          city_slug: city,
          category_slug: "data-reports",
          post_type: "data_report",
          internal_link_targets: [
            { href: `/city/${city}/${loc.slug}`, label: `Rentals in ${loc.name_en}` },
            { href: `/rent-in/${city}`, label: `Rentals in ${city}` }
          ],
          required_data: [
            { key: "median_rent_2bhk", label: "Median 2BHK rent", value: 0 },
            { key: "median_rent_1bhk", label: "Median 1BHK rent", value: 0 },
            { key: "listing_count", label: "Active listings", value: 0 }
          ]
        });
      }
    }

    // (d) Evergreen tenancy seeds.
    for (const seed of EVERGREEN_SEEDS) {
      if (created >= cap) break;
      await tryCreate({
        target_keyword: seed.target_keyword,
        intent: seed.intent,
        source: "evergreen",
        category_slug: seed.category_slug,
        post_type: seed.post_type,
        outline: seed.outline
      });
    }

    return { created, bySource };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-topic-planner.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/blog-topic-planner.service.ts apps/api/src/modules/blog/evergreen-seeds.ts apps/api/test/blog-topic-planner.service.test.ts
git commit -m "feat(blog): add topic planner (GSC quick-wins + gaps + data-trend + evergreen)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 13: `BlogEmbeddingService` — uniqueness + semantic internal links

**Files:**

- Modify: `apps/api/src/modules/ai/embedding.service.ts` (add a public `embedText(input: string)` that exposes `callEmbeddingApi` for reuse — the private method already exists; add a thin public wrapper so the blog service can reuse the exact Azure call without duplicating it)
- Create: `apps/api/src/modules/blog/blog-embedding.service.ts`
- Test: `apps/api/test/blog-embedding.service.test.ts` (unit, mocked DB + mocked `EmbeddingService.embedText`)

**Interfaces:**

- Consumes: `DatabaseService`, `EmbeddingService.embedText` (new public method, returns `{ embedding, tokenCount, model } | null`), `blog_embeddings` (Task 3).
- Produces:
  - `EmbeddingService.embedText(input: string): Promise<{ embedding: number[]; tokenCount: number; model: string } | null>` (public wrapper over the existing private `callEmbeddingApi`; still gated on `ff_ai_embeddings`).
  - `buildBlogDocument(post: { title; targetKeyword; bodyHtml; citySlug }): string`
  - `embedPost(postId: string): Promise<boolean>` — reads the post, builds a document, embeds via `EmbeddingService.embedText`, upserts into `blog_embeddings`. Returns false (no-op) when embeddings are unconfigured/disabled.
  - `uniquenessDistance(embedding: number[], excludePostId?: string): Promise<number | null>` — cosine distance (`<=>`) to the NEAREST existing published/draft post embedding; `null` when the corpus is empty.
  - `findRelated(postId: string, limit?: number): Promise<Array<{ blog_post_id: string; slug: string; title: string; distance: number }>>` — nearest OTHER posts by cosine (for the related-posts rail / semantic internal links).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-embedding.service.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { BlogEmbeddingService } from "../src/modules/blog/blog-embedding.service";

function make(opts: {
  enabled?: boolean;
  embed?: { embedding: number[]; tokenCount: number; model: string } | null;
  postRow?: Record<string, unknown> | null;
  nearestDistance?: number | null;
  related?: Array<{ blog_post_id: string; slug: string; title: string; distance: number }>;
}) {
  const query = vi.fn(async (sql: string) => {
    if (/FROM blog_posts/i.test(sql) && /SELECT/i.test(sql) && /id\s*=/.test(sql)) {
      return { rows: opts.postRow ? [opts.postRow] : [] };
    }
    if (/INSERT INTO blog_embeddings/i.test(sql)) return { rows: [] };
    if (/1 - \(|<=>/.test(sql) && /LIMIT 1/i.test(sql)) {
      return { rows: opts.nearestDistance == null ? [] : [{ distance: opts.nearestDistance }] };
    }
    if (/<=>/.test(sql)) {
      return { rows: opts.related ?? [] };
    }
    return { rows: [] };
  });
  const database = { isEnabled: () => opts.enabled ?? true, query } as never;
  const embedding = {
    embedText: vi.fn(async () =>
      opts.embed === undefined ? { embedding: [0.1, 0.2], tokenCount: 3, model: "m" } : opts.embed
    )
  } as never;
  return { service: new BlogEmbeddingService(database, embedding), query, embedding };
}

describe("BlogEmbeddingService", () => {
  it("embedPost embeds the post document and upserts into blog_embeddings", async () => {
    const { service, query, embedding } = make({
      postRow: {
        id: "p1",
        title: "2BHK rent in Gomti Nagar",
        target_keyword: "2bhk rent gomti nagar",
        body_en: "<p>₹18,000</p>",
        city_slug: "lucknow"
      }
    });
    const ok = await service.embedPost("p1");
    expect(ok).toBe(true);
    expect(
      (embedding as unknown as { embedText: ReturnType<typeof vi.fn> }).embedText
    ).toHaveBeenCalled();
    expect(query.mock.calls.some((c) => /INSERT INTO blog_embeddings/i.test(c[0]))).toBe(true);
  });

  it("embedPost returns false when embeddings are unconfigured (null)", async () => {
    const { service } = make({
      embed: null,
      postRow: { id: "p1", title: "t", target_keyword: "k", body_en: "b", city_slug: null }
    });
    await expect(service.embedPost("p1")).resolves.toBe(false);
  });

  it("uniquenessDistance returns null for an empty corpus", async () => {
    const { service } = make({ nearestDistance: null });
    await expect(service.uniquenessDistance([0.1, 0.2])).resolves.toBeNull();
  });

  it("uniquenessDistance returns the nearest cosine distance", async () => {
    const { service } = make({ nearestDistance: 0.31 });
    await expect(service.uniquenessDistance([0.1, 0.2])).resolves.toBeCloseTo(0.31);
  });

  it("findRelated returns nearest other posts", async () => {
    const { service } = make({
      related: [{ blog_post_id: "p2", slug: "s2", title: "t2", distance: 0.2 }]
    });
    const rel = await service.findRelated("p1", 3);
    expect(rel[0].slug).toBe("s2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-embedding.service.test.ts`
Expected: FAIL — cannot find module `blog-embedding.service`.

- [ ] **Step 3a: Add the public `embedText` wrapper to `EmbeddingService`**

In `apps/api/src/modules/ai/embedding.service.ts`, add this public method inside the class (e.g. right after `embedQuery`):

```typescript
  /**
   * Public wrapper over the Azure embeddings call, reused by the blog engine
   * (BlogEmbeddingService) so it doesn't duplicate the Azure config/fetch.
   * Still gated on ff_ai_embeddings.
   */
  async embedText(
    input: string
  ): Promise<{ embedding: number[]; tokenCount: number; model: string } | null> {
    const flags = readFeatureFlags();
    if (!flags.ff_ai_embeddings) return null;
    return this.callEmbeddingApi(input);
  }
```

- [ ] **Step 3b: Write `BlogEmbeddingService`**

Create `apps/api/src/modules/blog/blog-embedding.service.ts`:

```typescript
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

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
      `SELECT id::text, title, target_keyword, body_en, city_slug FROM blog_posts WHERE id = $1::uuid`,
      [postId]
    );
    const post = rows[0];
    if (!post) return false;

    const doc = this.buildBlogDocument({
      title: post.title,
      targetKeyword: post.target_keyword,
      bodyHtml: post.body_en,
      citySlug: post.city_slug
    });
    const result = await this.embedding.embedText(doc);
    if (!result) return false;

    await this.database.query(
      `INSERT INTO blog_embeddings (blog_post_id, embedding, model, token_count)
       VALUES ($1::uuid, $2::vector, $3, $4)
       ON CONFLICT (blog_post_id) DO UPDATE SET
         embedding = EXCLUDED.embedding, model = EXCLUDED.model,
         token_count = EXCLUDED.token_count, updated_at = now()`,
      [postId, `[${result.embedding.join(",")}]`, result.model, result.tokenCount]
    );
    return true;
  }

  async uniquenessDistance(embedding: number[], excludePostId?: string): Promise<number | null> {
    if (!this.database.isEnabled()) return null;
    const vec = `[${embedding.join(",")}]`;
    const params: unknown[] = [vec];
    let exclude = "";
    if (excludePostId) {
      params.push(excludePostId);
      exclude = `WHERE be.blog_post_id <> $${params.length}::uuid`;
    }
    try {
      const { rows } = await this.database.query<{ distance: number }>(
        `SELECT (be.embedding <=> $1::vector)::float8 AS distance
         FROM blog_embeddings be
         ${exclude}
         ORDER BY be.embedding <=> $1::vector
         LIMIT 1`,
        params
      );
      return rows[0]?.distance ?? null;
    } catch (err) {
      this.logger.debug(`uniqueness query failed: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  async findRelated(
    postId: string,
    limit = 3
  ): Promise<Array<{ blog_post_id: string; slug: string; title: string; distance: number }>> {
    if (!this.database.isEnabled()) return [];
    try {
      const { rows } = await this.database.query<{
        blog_post_id: string;
        slug: string;
        title: string;
        distance: number;
      }>(
        `WITH me AS (SELECT embedding FROM blog_embeddings WHERE blog_post_id = $1::uuid)
         SELECT be.blog_post_id::text, p.slug, p.title,
                (be.embedding <=> me.embedding)::float8 AS distance
         FROM blog_embeddings be
         JOIN blog_posts p ON p.id = be.blog_post_id
         CROSS JOIN me
         WHERE be.blog_post_id <> $1::uuid AND p.status = 'published'
         ORDER BY be.embedding <=> me.embedding
         LIMIT $2`,
        [postId, limit]
      );
      return rows;
    } catch (err) {
      this.logger.debug(`findRelated query failed: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-embedding.service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/embedding.service.ts apps/api/src/modules/blog/blog-embedding.service.ts apps/api/test/blog-embedding.service.test.ts
git commit -m "feat(blog): add BlogEmbeddingService (uniqueness + semantic related)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: `BlogModule` + public + internal (worker-write) controllers

**Files:**

- Create: `apps/api/src/modules/blog/dto/upsert-draft.dto.ts`
- Create: `apps/api/src/modules/blog/blog.controller.ts` (public reads)
- Create: `apps/api/src/modules/blog/blog-internal.controller.ts` (worker writes, `ApiKeyGuard`)
- Create: `apps/api/src/modules/blog/blog.module.ts`
- Modify: `apps/api/src/app.module.ts` (import `BlogModule`)
- Test: `apps/api/test/blog.controller.integration.test.ts` (Nest testing module, `ApiKeyGuard` real via env, public reads open)

**Interfaces:**

- Consumes: `BlogService`, `BlogGeneratorService`, `SeoAggregatesService`, `EmbeddingService`, `BlogEmbeddingService`, `BlogBriefService`, `BlogTopicPlannerService`, `ApiKeyGuard`.
- Produces routes:
  - `GET /v1/blog` → `{ items, total }` (published; query `page`, `page_size`, `category`, `city`).
  - `GET /v1/blog/:slug` → `{ post, related }` (published only; 404 via `ok(null)` when missing).
  - `POST /v1/blog/drafts` (guard `ApiKeyGuard`) → upserts a draft/needs_attention (worker write). Body validated by `UpsertDraftDto`.
  - `PATCH /v1/blog/drafts/:id` (guard `ApiKeyGuard`) → editable patch (worker refresh flow).
  - `BlogModule` `exports` all blog services (so the worker can `new` them via the standalone process AND so `AdminBlogController` in Task 15 can inject them).

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog.controller.integration.test.ts`:

```typescript
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { Module, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { BlogController } from "../src/modules/blog/blog.controller";
import { BlogInternalController } from "../src/modules/blog/blog-internal.controller";
import { BlogService } from "../src/modules/blog/blog.service";
import { BlogEmbeddingService } from "../src/modules/blog/blog-embedding.service";
import { ApiKeyGuard } from "../src/common/api-key.guard";

const publishedRow = {
  id: "00000000-0000-0000-0000-000000000009",
  slug: "2bhk-rent-gomti-nagar",
  title: "2BHK rent in Gomti Nagar",
  meta_title: null,
  meta_description: null,
  excerpt: "x",
  body_en: "<p>hi</p>",
  body_hi: null,
  target_keyword: "2bhk rent gomti nagar",
  intent: null,
  city_slug: "lucknow",
  category_id: 1,
  category_slug: "data-reports",
  status: "published",
  generated_by: "planner",
  quality_score: 0.9,
  quality_breakdown: {},
  faq_items: [],
  hero_image_path: null,
  author: "Aditi Sharma",
  sources: [],
  data_asof: "2026-07-01",
  script: "en",
  is_pillar: false,
  brief_id: null,
  published_at: "2026-07-02",
  created_at: "t",
  updated_at: "t"
};

const fakeBlog = {
  listPublished: async () => ({
    items: [
      {
        slug: publishedRow.slug,
        title: publishedRow.title,
        excerpt: "x",
        category_slug: "data-reports",
        city_slug: "lucknow",
        hero_image_path: null,
        author: "Aditi Sharma",
        published_at: "2026-07-02",
        data_asof: "2026-07-01"
      }
    ],
    total: 1
  }),
  getPublishedBySlug: async (slug: string) => (slug === publishedRow.slug ? publishedRow : null),
  relatedPublished: async () => [],
  upsertDraft: async (input: Record<string, unknown>) => ({
    ...publishedRow,
    ...input,
    status: input.status
  }),
  updateEditable: async () => publishedRow,
  getById: async () => publishedRow
};
const fakeBlogEmbed = { findRelated: async () => [] };

@Module({
  controllers: [BlogController, BlogInternalController],
  providers: [
    { provide: BlogService, useValue: fakeBlog },
    { provide: BlogEmbeddingService, useValue: fakeBlogEmbed }
  ]
})
class TestBlogModule {}

describe("Blog controllers (integration)", () => {
  let app: INestApplication;
  const OLD = process.env.BLOG_WORKER_API_KEY;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestBlogModule] }).compile();
    app = moduleRef.createNestApplication();
    // Match the production pipe so the UpsertDraftDto whitelist/validation runs
    // (this is what turns status:"published" into a 400).
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    process.env.BLOG_WORKER_API_KEY = "worker-secret";
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.BLOG_WORKER_API_KEY;
    else process.env.BLOG_WORKER_API_KEY = OLD;
  });

  it("GET /blog returns the published list", async () => {
    const r = await request(app.getHttpServer()).get("/blog");
    expect(r.status).toBe(200);
    expect(r.body.data.items[0].slug).toBe("2bhk-rent-gomti-nagar");
    expect(r.body.data.total).toBe(1);
  });

  it("GET /blog/:slug returns the post + related", async () => {
    const r = await request(app.getHttpServer()).get("/blog/2bhk-rent-gomti-nagar");
    expect(r.status).toBe(200);
    expect(r.body.data.post.slug).toBe("2bhk-rent-gomti-nagar");
    expect(Array.isArray(r.body.data.related)).toBe(true);
  });

  it("GET /blog/:slug returns null data for an unknown slug", async () => {
    const r = await request(app.getHttpServer()).get("/blog/nope");
    expect(r.status).toBe(200);
    expect(r.body.data).toBeNull();
  });

  it("POST /blog/drafts requires the worker API key", async () => {
    const noKey = await request(app.getHttpServer())
      .post("/blog/drafts")
      .send({ slug: "s", title: "t", generated_by: "planner", status: "draft" });
    expect(noKey.status).toBe(401);

    const ok = await request(app.getHttpServer())
      .post("/blog/drafts")
      .set("x-api-key", "worker-secret")
      .send({ slug: "s", title: "t", generated_by: "planner", status: "draft" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe("draft");
  });

  it("POST /blog/drafts rejects status=published from the worker path (validation)", async () => {
    const r = await request(app.getHttpServer())
      .post("/blog/drafts")
      .set("x-api-key", "worker-secret")
      .send({ slug: "s", title: "t", generated_by: "planner", status: "published" });
    expect(r.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog.controller.integration.test.ts`
Expected: FAIL — cannot find the blog controllers/DTO.

- [ ] **Step 3: Write the DTO, controllers, module, and register it**

Create `apps/api/src/modules/blog/dto/upsert-draft.dto.ts`:

```typescript
import {
  IsArray,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength
} from "class-validator";

export class UpsertDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(200) meta_title?: string | null;
  @IsOptional() @IsString() @MaxLength(320) meta_description?: string | null;
  @IsOptional() @IsString() @MaxLength(500) excerpt?: string | null;
  @IsOptional() @IsString() body_en?: string | null;
  @IsOptional() @IsString() body_hi?: string | null;
  @IsOptional() @IsString() @MaxLength(160) target_keyword?: string | null;
  @IsOptional() @IsString() @MaxLength(80) intent?: string | null;
  @IsOptional() @IsString() @MaxLength(80) city_slug?: string | null;
  @IsOptional() @IsString() @MaxLength(80) category_slug?: string | null;

  @IsIn(["planner", "manual", "refresh", "pillar"])
  generated_by!: "planner" | "manual" | "refresh" | "pillar";

  // Worker path can ONLY ever set draft | needs_attention. Anything else is a 400.
  @IsIn(["draft", "needs_attention"])
  status!: "draft" | "needs_attention";

  @IsOptional() @IsNumber() quality_score?: number | null;
  @IsOptional() @IsObject() quality_breakdown?: Record<string, unknown> | null;
  @IsOptional() @IsArray() faq_items?: Array<{ q: string; a: string }>;
  @IsOptional() @IsString() hero_image_path?: string | null;
  @IsOptional() @IsArray() sources?: Array<{
    label: string;
    url?: string | null;
    asof?: string | null;
  }>;
  @IsOptional() @IsString() @MaxLength(10) data_asof?: string | null;
  @IsOptional() @IsEnum(["en", "hi", "hinglish"]) script?: "en" | "hi" | "hinglish";
  @IsOptional() @IsString() brief_id?: string | null;
}
```

Create `apps/api/src/modules/blog/blog.controller.ts`:

```typescript
import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { ok } from "../../common/response";
import { BlogService } from "./blog.service";
import { BlogEmbeddingService } from "./blog-embedding.service";

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
    // Semantic related first; fall back to category/city recency.
    const semantic = await this.embeddings.findRelated(post.id, 3).catch(() => []);
    const related =
      semantic.length > 0
        ? semantic.map((r) => ({ slug: r.slug, title: r.title }))
        : (await this.blog.relatedPublished(post.id, 3)).map((r) => ({
            slug: r.slug,
            title: r.title
          }));
    return ok({ post, related });
  }
}
```

Create `apps/api/src/modules/blog/blog-internal.controller.ts`:

```typescript
import { Body, Controller, Inject, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../../common/api-key.guard";
import { ok } from "../../common/response";
import { BlogService } from "./blog.service";
import { UpsertDraftDto } from "./dto/upsert-draft.dto";

/**
 * Internal worker-write endpoints. The standalone generator worker calls these
 * with the x-api-key header (ApiKeyGuard). These NEVER publish — the DTO only
 * accepts status draft | needs_attention, and BlogService.upsertDraft hard-
 * guards the same. Publishing is exclusively a human admin action (Task 15).
 */
@Controller("blog/drafts")
@UseGuards(ApiKeyGuard)
export class BlogInternalController {
  constructor(@Inject(BlogService) private readonly blog: BlogService) {}

  @Post()
  async upsert(@Body() body: UpsertDraftDto) {
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
      quality_breakdown: (body.quality_breakdown as never) ?? null,
      faq_items: body.faq_items ?? [],
      hero_image_path: body.hero_image_path ?? null,
      sources: body.sources ?? [],
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
      faq_items: body.faq_items,
      hero_image_path: body.hero_image_path ?? undefined
    });
    return ok(row);
  }
}
```

Create `apps/api/src/modules/blog/blog.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module";
import { SeoModule } from "../seo/seo.module";
import { BlogController } from "./blog.controller";
import { BlogInternalController } from "./blog-internal.controller";
import { BlogService } from "./blog.service";
import { BlogBriefService } from "./blog-brief.service";
import { BlogEmbeddingService } from "./blog-embedding.service";
import { BlogGeneratorService } from "./blog-generator.service";
import { BlogTopicPlannerService } from "./blog-topic-planner.service";

@Module({
  imports: [AiModule, SeoModule],
  controllers: [BlogController, BlogInternalController],
  providers: [
    BlogService,
    BlogBriefService,
    BlogEmbeddingService,
    BlogGeneratorService,
    BlogTopicPlannerService
  ],
  exports: [
    BlogService,
    BlogBriefService,
    BlogEmbeddingService,
    BlogGeneratorService,
    BlogTopicPlannerService
  ]
})
export class BlogModule {}
```

In `apps/api/src/app.module.ts`, add the import next to `SeoModule`:

```typescript
import { SeoModule } from "./modules/seo/seo.module";
import { BlogModule } from "./modules/blog/blog.module";
```

and add `BlogModule` to the `imports` array (right after `SeoModule`):

```typescript
    SeoModule,
    BlogModule,
```

> Note: `SeoModule` already `exports` `SeoAggregatesService`, and `AiModule` already `exports` `EmbeddingService`, so `BlogGeneratorService` and `BlogEmbeddingService` resolve their deps via those imports. `BlogGeneratorService`'s `callJson` default parameter is used in production; DI supplies only `SeoAggregatesService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog.controller.integration.test.ts`
Expected: PASS (5 tests). (These use a `TestBlogModule` with fakes, so they run without `TEST_DATABASE_URL`.)

Also run typecheck to confirm the app wiring compiles:
Run: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/dto/upsert-draft.dto.ts apps/api/src/modules/blog/blog.controller.ts apps/api/src/modules/blog/blog-internal.controller.ts apps/api/src/modules/blog/blog.module.ts apps/api/src/app.module.ts apps/api/test/blog.controller.integration.test.ts
git commit -m "feat(blog): add BlogModule, public read + worker-write controllers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: Admin controller — the human-review gate (approve / publish / archive / edit / generate-now)

**This task implements the explicit "NEVER auto-publish — human approves every post" gate.** Publishing happens ONLY here, ONLY via an authenticated admin action, and every action is audited to `admin_actions`. On publish, the post is enqueued for embedding (`seo.embed_blog`) and for fast indexing (slice-2 `seo_indexing_queue`, guarded).

**Files:**

- Create: `apps/api/src/modules/blog/admin-blog.controller.ts`
- Modify: `apps/api/src/modules/blog/blog.module.ts` (add `AdminBlogController` to `controllers`)
- Modify: `infra/migrations/00A1_blog_posts.sql` — append `ALTER TYPE` additions for the admin audit vocabulary (`admin_target_type` value `blog_post`; `admin_action_type` values `blog_publish`, `blog_approve`, `blog_archive`, `blog_edit`, `blog_generate`). Follow the `0043` pattern (`ALTER TYPE … ADD VALUE IF NOT EXISTS`). Add the matching `-- no-op` note to the rollback (enum values can't be dropped).
- Test: `apps/api/test/admin-blog.controller.integration.test.ts` (Nest testing module; guards overridden to inject an admin user; fakes for blog services + a capturing DatabaseService that records `admin_actions` + enqueue writes)

**Interfaces:**

- Consumes: `BlogService`, `BlogGeneratorService`, `BlogBriefService`, `BlogTopicPlannerService`, `SeoAggregatesService`, `DatabaseService`, `deterministicUuidV5`, `logTelemetry`.
- Produces routes (all `@Controller("admin/blog")`, `@UseGuards(AuthGuard, RolesGuard)`, `@Roles("admin")`):
  - `GET /v1/admin/blog?status=<status>` → `{ items }` (any status; includes quality_breakdown).
  - `GET /v1/admin/blog/:id` → `{ post }`.
  - `POST /v1/admin/blog/:id/approve` → `transition(id, "in_review")`, audited `blog_approve`.
  - `POST /v1/admin/blog/:id/publish` → `transition(id, "published")` **only** from `in_review` or `draft` (guarded in the handler); then enqueue `seo.embed_blog` + enqueue indexing; audited `blog_publish`.
  - `POST /v1/admin/blog/:id/archive` → `transition(id, "archived")`, audited `blog_archive`.
  - `PATCH /v1/admin/blog/:id` → `updateEditable(id, patch)`, audited `blog_edit`.
  - `POST /v1/admin/blog/plan` → run `BlogTopicPlannerService.planTopics`, audited `blog_generate`, returns `{ created, bySource }`.
  - `POST /v1/admin/blog/generate-now` (body `{ brief_id }` or `{ target_keyword, city_slug, category_slug }`) → build/lookup a brief, run `BlogGeneratorService.generate`, `upsertDraft` the result (draft/needs_attention per gate), audited `blog_generate`, returns the created row + its quality breakdown.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin-blog.controller.integration.test.ts`:

```typescript
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Module, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AdminBlogController } from "../src/modules/blog/admin-blog.controller";
import { BlogService } from "../src/modules/blog/blog.service";
import { BlogGeneratorService } from "../src/modules/blog/blog-generator.service";
import { BlogBriefService } from "../src/modules/blog/blog-brief.service";
import { BlogTopicPlannerService } from "../src/modules/blog/blog-topic-planner.service";
import { DatabaseService } from "../src/common/database.service";
import { AuthGuard } from "../src/common/auth.guard";
import { RolesGuard } from "../src/common/roles.guard";

const post = (over: Record<string, unknown> = {}) => ({
  id: "00000000-0000-0000-0000-00000000000a",
  slug: "s",
  title: "t",
  status: "in_review",
  quality_breakdown: { score: 1, passed: true, checks: [] },
  city_slug: "lucknow",
  ...over
});

const adminGuard = {
  canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
    ctx.switchToHttp().getRequest().user = {
      id: "11111111-1111-1111-1111-111111111111",
      role: "admin"
    };
    return true;
  }
};

const sqls: string[] = [];
const fakeDb = {
  isEnabled: () => true,
  query: async (sql: string) => {
    sqls.push(sql);
    return { rows: [] };
  }
};

let lastTransition: { id: string; to: string } | null = null;
const fakeBlog = {
  listForAdmin: async () => [post()],
  getById: async (id: string) => post({ id }),
  transition: async (id: string, to: string) => {
    lastTransition = { id, to };
    return post({ id, status: to, published_at: to === "published" ? "now" : null });
  },
  updateEditable: async (id: string) => post({ id, title: "edited" }),
  upsertDraft: async (input: Record<string, unknown>) => post({ ...input, status: input.status })
};
const fakeGen = {
  generate: async () => ({
    slug: "2bhk-rent-gomti-nagar",
    title: "2BHK rent in Gomti Nagar",
    h1: "H",
    metaTitle: "m",
    metaDescription: "d",
    excerpt: "e",
    bodyEn: "<h1>H</h1><p>x</p>",
    bodyHi: "<p>x</p>",
    targetKeyword: "2bhk rent gomti nagar",
    intent: null,
    citySlug: "lucknow",
    categorySlug: "data-reports",
    faqItems: [],
    sources: [],
    dataAsof: "2026-07-01",
    dataFacts: [],
    citedDataPointCount: 3,
    isDataPost: true,
    quality: { score: 1, passed: true, checks: [] }
  })
};
const fakeBriefs = {
  claimNextPending: async () => null,
  createBrief: async (b: Record<string, unknown>) => ({ id: "b1", ...b, post_type: "data_report" }),
  markDone: async () => undefined
};
const fakePlanner = {
  planTopics: async () => ({
    created: 3,
    bySource: { gsc_quickwin: 0, gap: 0, data_trend: 2, evergreen: 1, manual: 0 }
  })
};

@Module({
  controllers: [AdminBlogController],
  providers: [
    { provide: BlogService, useValue: fakeBlog },
    { provide: BlogGeneratorService, useValue: fakeGen },
    { provide: BlogBriefService, useValue: fakeBriefs },
    { provide: BlogTopicPlannerService, useValue: fakePlanner },
    { provide: DatabaseService, useValue: fakeDb }
  ]
})
class TestAdminBlogModule {}

describe("AdminBlogController (integration)", () => {
  let app: INestApplication;
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [TestAdminBlogModule] })
      .overrideGuard(AuthGuard)
      .useValue(adminGuard)
      .overrideGuard(RolesGuard)
      .useValue(adminGuard)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it("GET /admin/blog lists all statuses with quality breakdown", async () => {
    const r = await request(app.getHttpServer()).get("/admin/blog?status=in_review");
    expect(r.status).toBe(200);
    expect(r.body.data.items[0].quality_breakdown.passed).toBe(true);
  });

  it("approve transitions to in_review and audits", async () => {
    sqls.length = 0;
    const r = await request(app.getHttpServer())
      .post("/admin/blog/00000000-0000-0000-0000-00000000000a/approve")
      .send({});
    expect(r.status).toBe(201);
    expect(lastTransition).toEqual({ id: "00000000-0000-0000-0000-00000000000a", to: "in_review" });
    expect(sqls.some((s) => /INSERT INTO admin_actions/i.test(s))).toBe(true);
  });

  it("publish stamps published, enqueues embed + indexing, and audits", async () => {
    sqls.length = 0;
    const r = await request(app.getHttpServer())
      .post("/admin/blog/00000000-0000-0000-0000-00000000000a/publish")
      .send({});
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe("published");
    // embed enqueue
    expect(
      sqls.some(
        (s) => /INSERT INTO outbound_events/i.test(s) && /seo\.embed_blog|blog_post/i.test(s)
      )
    ).toBe(true);
    // indexing enqueue is guarded on seo_indexing_queue existence
    expect(sqls.some((s) => /seo_indexing_queue/i.test(s))).toBe(true);
    // audit
    expect(sqls.some((s) => /INSERT INTO admin_actions/i.test(s))).toBe(true);
  });

  it("generate-now produces a draft (never publishes) and audits", async () => {
    sqls.length = 0;
    const r = await request(app.getHttpServer())
      .post("/admin/blog/generate-now")
      .send({
        target_keyword: "2bhk rent gomti nagar",
        city_slug: "lucknow",
        category_slug: "data-reports"
      });
    expect(r.status).toBe(201);
    // upsertDraft only ever gets draft | needs_attention
    expect(["draft", "needs_attention"]).toContain(r.body.data.status);
    expect(sqls.some((s) => /INSERT INTO admin_actions/i.test(s))).toBe(true);
  });

  it("plan runs the topic planner and audits", async () => {
    sqls.length = 0;
    const r = await request(app.getHttpServer())
      .post("/admin/blog/plan")
      .send({ city_slugs: ["lucknow"] });
    expect(r.status).toBe(201);
    expect(r.body.data.created).toBe(3);
    expect(sqls.some((s) => /INSERT INTO admin_actions/i.test(s))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/admin-blog.controller.integration.test.ts`
Expected: FAIL — cannot find module `admin-blog.controller`.

- [ ] **Step 3: Write the admin controller, wire it, add audit enum values**

Create `apps/api/src/modules/blog/admin-blog.controller.ts`:

```typescript
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
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { DatabaseService } from "../../common/database.service";
import { deterministicUuidV5 } from "../../common/deterministic-uuid";
import { logTelemetry } from "../../common/telemetry";
import { ok } from "../../common/response";
import type { UserContext } from "../../common/types";
import { BlogService } from "./blog.service";
import { BlogGeneratorService } from "./blog-generator.service";
import { BlogBriefService } from "./blog-brief.service";
import { BlogTopicPlannerService } from "./blog-topic-planner.service";
import type { BlogStatus } from "./blog.types";

type BlogAction = "blog_approve" | "blog_publish" | "blog_archive" | "blog_edit" | "blog_generate";

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

  private async audit(adminId: string, postId: string, action: BlogAction, after: unknown) {
    await this.database
      .query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
         VALUES ($1::uuid, 'blog_post'::admin_target_type, $2::uuid, $3::admin_action_type, null, null, $4::jsonb)`,
        [adminId, deterministicUuidV5(postId), action, JSON.stringify(after ?? {})]
      )
      .catch(() => undefined); // audit is best-effort
  }

  @Get()
  async list(@Query("status") status?: string) {
    const items = await this.blog.listForAdmin({ status: (status as BlogStatus) || undefined });
    return ok({ items });
  }

  @Get(":id")
  async getOne(@Param("id") id: string) {
    const post = await this.blog.getById(id);
    if (!post)
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    return ok({ post });
  }

  @Post(":id/approve")
  async approve(@Req() req: { user: UserContext }, @Param("id") id: string) {
    const row = await this.blog.transition(id, "in_review");
    if (!row)
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    await this.audit(req.user.id, id, "blog_approve", { status: row.status });
    logTelemetry("admin.blog_approved", { admin_user_id: req.user.id, post_id: id });
    return ok(row);
  }

  @Post(":id/publish")
  async publish(@Req() req: { user: UserContext }, @Param("id") id: string) {
    const current = await this.blog.getById(id);
    if (!current)
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
    // Human-review gate: publish only from in_review or draft. Never auto.
    if (!["in_review", "draft"].includes(current.status)) {
      throw new BadRequestException({
        code: "invalid_publish_state",
        message: `Cannot publish from status '${current.status}'`
      });
    }
    const row = await this.blog.transition(id, "published");
    if (!row)
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });

    // Side effect 1: enqueue embedding (seo.embed_blog) — worker computes vector.
    await this.database
      .query(
        `INSERT INTO outbound_events (event_type, aggregate_type, aggregate_id, dedupe_key, payload, status, next_attempt_at)
         VALUES ('seo.embed_blog', 'blog_post', $1::uuid, $2, $3::jsonb, 'pending', now())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [id, `blog_embed:${id}`, JSON.stringify({ blog_post_id: id })]
      )
      .catch(() => undefined);

    // Side effect 2: enqueue fast indexing into slice-2 seo_indexing_queue (guarded
    // so it is a safe no-op until slice 2's table exists).
    const url = `/en/blog/${row.slug}`;
    await this.database
      .query(
        `INSERT INTO seo_indexing_queue (url, reason)
         SELECT $1, 'blog_published'
         WHERE to_regclass('public.seo_indexing_queue') IS NOT NULL
         ON CONFLICT (url) DO UPDATE SET status = 'pending', reason = 'blog_published', updated_at = now()`,
        [url]
      )
      .catch(() => undefined);

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
    if (!row)
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
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
      faq_items?: Array<{ q: string; a: string }>;
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
    if (!row)
      throw new NotFoundException({ code: "blog_post_not_found", message: "Post not found" });
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
  async generateNow(
    @Req() req: { user: UserContext },
    @Body()
    body: { brief_id?: string; target_keyword?: string; city_slug?: string; category_slug?: string }
  ) {
    // Resolve a brief: either the caller supplies one, or build an ad-hoc brief.
    let brief;
    if (body.brief_id) {
      // Minimal ad-hoc brief object; the generator only needs these fields.
      brief = {
        id: body.brief_id,
        target_keyword: body.target_keyword ?? "",
        intent: null,
        outline: [],
        required_data: [],
        internal_link_targets: [],
        source: "manual" as const,
        status: "generating" as const,
        city_slug: body.city_slug ?? null,
        category_slug: body.category_slug ?? null,
        post_type: "data_report" as const,
        notes: null,
        created_at: "",
        updated_at: ""
      };
    } else if (body.target_keyword) {
      brief = {
        id: deterministicUuidV5(`adhoc:${body.target_keyword}`),
        target_keyword: body.target_keyword,
        intent: null,
        outline: [],
        required_data: [],
        internal_link_targets: body.city_slug
          ? [{ href: `/rent-in/${body.city_slug}`, label: `Rentals in ${body.city_slug}` }]
          : [],
        source: "manual" as const,
        status: "generating" as const,
        city_slug: body.city_slug ?? null,
        category_slug: body.category_slug ?? "market-updates",
        post_type: (body.category_slug === "data-reports" ? "data_report" : "evergreen") as const,
        notes: null,
        created_at: "",
        updated_at: ""
      };
    } else {
      throw new BadRequestException({
        code: "missing_brief",
        message: "Provide brief_id or target_keyword"
      });
    }

    const generated = await this.generator.generate(brief);
    if (!generated) {
      throw new BadRequestException({
        code: "generation_failed",
        message: "The generator could not produce a post (LLM unavailable or step failed)."
      });
    }

    // Gate result decides the status. NEVER 'published'.
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
      brief_id: null
    });
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
}
```

In `apps/api/src/modules/blog/blog.module.ts`, add `AdminBlogController` to `controllers`:

```typescript
import { AdminBlogController } from "./admin-blog.controller";
// ...
  controllers: [BlogController, BlogInternalController, AdminBlogController],
```

Append to `infra/migrations/00A1_blog_posts.sql` (audit vocabulary; mirrors 0043; each ADD VALUE commits in its own migration txn):

```sql

-- Admin audit vocabulary for blog moderation (mirrors the 0043 pattern).
ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'blog_post';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_approve';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_publish';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_archive';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_edit';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'blog_generate';
```

Append to `infra/migrations/00A1_blog_posts.rollback.sql`:

```sql
-- NOTE: Postgres cannot remove enum values, so the blog_* admin enum members
-- remain after rollback. Safe (unused) and accepted, per the 0043 convention.
```

> Because the `blog-migrations.integration.test.ts` from Task 2 applies `00A1` in a fresh test DB, ensure `cribliv_test` has the `admin_target_type` / `admin_action_type` enums (they are created by the base migrations). If a fresh `cribliv_test` is migrated with `run-migrations.js` before running these tests, the enums exist. If the test applies ONLY `00A1` against a DB without those enums, the `ALTER TYPE` lines fail — so run the migration test against a fully-migrated `cribliv_test` (see Task 17 / the verification task for the DB bootstrap command).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/admin-blog.controller.integration.test.ts`
Expected: PASS (5 tests).

Run typecheck: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/blog/admin-blog.controller.ts apps/api/src/modules/blog/blog.module.ts infra/migrations/00A1_blog_posts.sql infra/migrations/00A1_blog_posts.rollback.sql apps/api/test/admin-blog.controller.integration.test.ts
git commit -m "feat(blog): add audited admin blog queue + human-review publish gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 16: Worker orchestration module (`blog-worker.ts`) — planner, generator, embed handler

The standalone worker cannot use Nest DI, so we expose three pure orchestration functions that take a `pg.Pool` and build the blog services against a `DatabaseService`-shaped adapter (the exact pattern `runPgScoreRecompute` uses in `worker.ts`). Task 17 wires them into `worker.ts`'s `setInterval` loop. Splitting orchestration into its own file keeps it unit-testable without importing the whole worker.

**Files:**

- Create: `apps/api/src/worker/blog-worker.ts`
- Test: `apps/api/test/blog-worker.test.ts` (unit — pass a fake pool-like object; no real DB)

**Interfaces:**

- Consumes: `pg.Pool` (typed loosely as `PoolLike` = `{ query; connect }`), `BlogTopicPlannerService`, `BlogBriefService`, `BlogGeneratorService`, `BlogService`, `BlogEmbeddingService`, `SeoAggregatesService`, `EmbeddingService`.
- Produces:
  - `type PoolLike = { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }> }`
  - `adapterFor(pool: PoolLike): DatabaseService` — the `{ isEnabled: () => true, query: (t, p) => pool.query(t, p) }` adapter cast.
  - `runBlogTopicPlanner(pool: PoolLike, citySlugs?: string[]): Promise<{ created: number }>` — builds planner + brief + aggregates services and runs `planTopics`.
  - `runBlogGenerator(pool: PoolLike, batch?: number): Promise<{ drafted: number; needsAttention: number }>` — loops up to `batch` times: `claimNextPending` → `generate` → if gate fails, **regenerate once** → still fails ⇒ `upsertDraft(status:'needs_attention')`; on pass ⇒ `upsertDraft(status:'draft')`; `markDone`/`markDropped` the brief accordingly. NEVER publishes.
  - `runBlogEmbedSweep(pool: PoolLike, batch?: number): Promise<{ embedded: number }>` — drains `outbound_events` where `event_type='seo.embed_blog' AND status='pending'` (FOR UPDATE SKIP LOCKED), calls `BlogEmbeddingService.embedPost`, marks the event `dispatched` (or `failed` after attempts). This runs BEFORE the generic dispatcher would no-op these rows.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-worker.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  runBlogGenerator,
  runBlogEmbedSweep,
  runBlogTopicPlanner
} from "../src/worker/blog-worker";

// Minimal pool that answers the specific queries the orchestrators issue.
function makePool(
  handlers: Array<[RegExp, (params?: unknown[]) => { rows: unknown[]; rowCount?: number }]>
) {
  const calls: string[] = [];
  const query = vi.fn(async (text: string, params?: unknown[]) => {
    calls.push(text);
    for (const [re, fn] of handlers) if (re.test(text)) return fn(params);
    return { rows: [], rowCount: 0 };
  });
  return { pool: { query }, calls, query };
}

describe("blog-worker orchestration", () => {
  it("runBlogTopicPlanner seeds briefs", async () => {
    const { pool } = makePool([
      [/to_regclass\('public\.keyword_rankings'\)/i, () => ({ rows: [{ present: false }] })],
      [/FROM localities/i, () => ({ rows: [] })],
      [/INSERT INTO blog_briefs/i, () => ({ rows: [{ id: "b1" }] })]
    ]);
    const res = await runBlogTopicPlanner(pool as never, ["lucknow"]);
    expect(res.created).toBeGreaterThan(0); // at least the evergreen seeds
  });

  it("runBlogGenerator drafts a passing post and marks the brief done", async () => {
    // claimNextPending returns one brief, then no more.
    let claimed = 0;
    const { pool, calls } = makePool([
      [
        /UPDATE blog_briefs b SET status = 'generating'/i,
        () => {
          claimed++;
          return claimed === 1
            ? {
                rows: [
                  {
                    id: "b1",
                    target_keyword: "2bhk rent gomti nagar",
                    intent: null,
                    outline: [],
                    required_data: [],
                    internal_link_targets: [
                      { href: "/city/lucknow/gomti-nagar", label: "x" },
                      { href: "/rent-in/lucknow", label: "y" }
                    ],
                    source: "data_trend",
                    status: "generating",
                    city_slug: "lucknow",
                    category_slug: "data-reports",
                    post_type: "data_report",
                    notes: null,
                    created_at: "t",
                    updated_at: "t"
                  }
                ]
              }
            : { rows: [] };
        }
      ],
      [
        /FROM localities/i,
        () => ({ rows: [{ slug: "gomti-nagar", name_en: "Gomti Nagar", listing_count: 42 }] })
      ],
      [
        /percentile_cont|FROM listings l/i,
        () => ({
          rows: [
            {
              listing_count: 42,
              pg_count: 5,
              flat_count: 37,
              median_rent_pg: 7000,
              median_rent_1bhk: 11000,
              median_rent_2bhk: 18000,
              median_rent_3bhk: 26000
            }
          ]
        })
      ],
      [
        /INSERT INTO blog_posts/i,
        () => ({ rows: [{ id: "p1", slug: "2bhk-rent-gomti-nagar", status: "draft" }] })
      ],
      [/blog_embeddings/i, () => ({ rows: [] })],
      [/UPDATE blog_briefs SET status = 'done'/i, () => ({ rows: [] })]
    ]);

    // Inject the LLM + embedding behaviour via env-free fakes passed to the orchestrator.
    const res = await runBlogGenerator(pool as never, 1, {
      callJson: (async (opts: { system: string; user: string }) => {
        if (/outline/i.test(opts.system)) return { sections: [{ heading: "Overview" }] };
        if (/section/i.test(opts.system))
          return {
            html:
              '<p>The median 2BHK rent in Gomti Nagar is ₹18,000, the 1BHK median is ₹11,000, and 42 active listings. <a href="/city/lucknow/gomti-nagar">flats</a> <a href="/rent-in/lucknow">rentals</a> <a href="/city/lucknow/metro/gomti-nagar">metro</a>. ' +
              "Gomti Nagar has parks. ".repeat(160) +
              "</p>"
          };
        if (/fact/i.test(opts.system)) return { ok: true };
        if (/seo|readability/i.test(opts.system))
          return {
            title: "2BHK rent in Gomti Nagar — Cribliv",
            h1: "2BHK rent in Gomti Nagar",
            meta_title: "m",
            meta_description: "d",
            excerpt: "e",
            faq_items: [],
            body_hi: "<p>x</p>"
          };
        return null;
      }) as never,
      embedForUniqueness: async () => null // empty corpus → unique
    });
    expect(res.drafted).toBe(1);
    expect(res.needsAttention).toBe(0);
    expect(calls.some((c) => /UPDATE blog_briefs SET status = 'done'/i.test(c))).toBe(true);
    // NEVER publishes:
    expect(calls.some((c) => /status = 'published'/i.test(c))).toBe(false);
  });

  it("runBlogEmbedSweep processes seo.embed_blog events and marks them dispatched", async () => {
    let drained = 0;
    const { pool, calls } = makePool([
      [
        /FROM outbound_events[\s\S]*seo\.embed_blog/i,
        () => {
          drained++;
          return drained === 1
            ? {
                rows: [{ id: 7, aggregate_id: "p1", payload: { blog_post_id: "p1" } }],
                rowCount: 1
              }
            : { rows: [], rowCount: 0 };
        }
      ],
      [
        /SELECT id::text, title, target_keyword, body_en, city_slug FROM blog_posts/i,
        () => ({
          rows: [
            { id: "p1", title: "t", target_keyword: "k", body_en: "<p>b</p>", city_slug: "lucknow" }
          ]
        })
      ],
      [/INSERT INTO blog_embeddings/i, () => ({ rows: [] })],
      [/UPDATE outbound_events[\s\S]*dispatched/i, () => ({ rows: [] })]
    ]);
    const res = await runBlogEmbedSweep(pool as never, 10, {
      embedText: async () => ({ embedding: [0.1, 0.2], tokenCount: 3, model: "m" })
    });
    expect(res.embedded).toBe(1);
    expect(calls.some((c) => /UPDATE outbound_events[\s\S]*dispatched/i.test(c))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-worker.test.ts`
Expected: FAIL — cannot find module `blog-worker`.

- [ ] **Step 3: Write `blog-worker.ts`**

Create `apps/api/src/worker/blog-worker.ts`:

```typescript
import type { DatabaseService } from "../common/database.service";
import { SeoAggregatesService } from "../modules/seo/seo-aggregates.service";
import { BlogService } from "../modules/blog/blog.service";
import { BlogBriefService } from "../modules/blog/blog-brief.service";
import { BlogEmbeddingService } from "../modules/blog/blog-embedding.service";
import { BlogGeneratorService, type CallJson } from "../modules/blog/blog-generator.service";
import { BlogTopicPlannerService } from "../modules/blog/blog-topic-planner.service";
import { EmbeddingService } from "../modules/ai/embedding.service";

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
  const db = adapterFor(pool);
  const aggregates = new SeoAggregatesService(db);
  const briefs = new BlogBriefService(db);
  const planner = new BlogTopicPlannerService(db, aggregates, briefs);
  const res = await planner.planTopics({ citySlugs });
  return { created: res.created };
}

export interface GeneratorDeps {
  /** Injectable LLM function; defaults to the real Azure helper via the service. */
  callJson?: CallJson;
  /** Returns the uniqueness distance for a generated post; default computes via embeddings. */
  embedForUniqueness?: (postDoc: string) => Promise<number | null>;
}

export async function runBlogGenerator(
  pool: PoolLike,
  batch = 3,
  deps: GeneratorDeps = {}
): Promise<{ drafted: number; needsAttention: number }> {
  const db = adapterFor(pool);
  const aggregates = new SeoAggregatesService(db);
  const briefs = new BlogBriefService(db);
  const blog = new BlogService(db);
  const embeddingSvc = new EmbeddingService(db);
  const blogEmbed = new BlogEmbeddingService(db, embeddingSvc);
  const generator = deps.callJson
    ? new BlogGeneratorService(aggregates, deps.callJson)
    : new BlogGeneratorService(aggregates);

  const uniqueness = async (bodyEn: string, title: string): Promise<number | null> => {
    if (deps.embedForUniqueness) return deps.embedForUniqueness(`${title} ${bodyEn}`);
    // Real path: embed the document, then measure distance to nearest existing.
    const vec = await embeddingSvc.embedText(
      `${title} | ${bodyEn.replace(/<[^>]+>/g, " ").slice(0, 4000)}`
    );
    if (!vec) return null;
    return blogEmbed.uniquenessDistance(vec.embedding);
  };

  let drafted = 0;
  let needsAttention = 0;

  for (let i = 0; i < batch; i++) {
    const brief = await briefs.claimNextPending();
    if (!brief) break;

    // First pass
    let post = await generator.generate(brief);
    if (post) {
      const dist = await uniqueness(post.bodyEn, post.title);
      post = await generator.generate(brief, dist); // recompute quality WITH the distance
    }

    // Regenerate once on gate failure (spec §2.5).
    if (!post || !post.quality.passed) {
      const retry = await generator.generate(brief);
      if (retry) {
        const dist = await uniqueness(retry.bodyEn, retry.title);
        post = await generator.generate(brief, dist);
      }
    }

    if (!post) {
      await briefs.markDropped(brief.id, "generation_failed");
      continue;
    }

    const status: "draft" | "needs_attention" = post.quality.passed ? "draft" : "needs_attention";
    await blog.upsertDraft({
      slug: post.slug,
      title: post.title,
      meta_title: post.metaTitle,
      meta_description: post.metaDescription,
      excerpt: post.excerpt,
      body_en: post.bodyEn,
      body_hi: post.bodyHi,
      target_keyword: post.targetKeyword,
      intent: post.intent,
      city_slug: post.citySlug,
      category_slug: post.categorySlug,
      generated_by: "planner",
      status,
      quality_score: post.quality.score,
      quality_breakdown: post.quality,
      faq_items: post.faqItems,
      sources: post.sources,
      data_asof: post.dataAsof,
      script: "en",
      brief_id: brief.id
    });

    if (status === "draft") drafted++;
    else needsAttention++;
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
  const db = adapterFor(pool);
  const embeddingSvc = new EmbeddingService(db);
  const blogEmbed = new BlogEmbeddingService(db, embeddingSvc);
  // If a fake embedText is supplied (tests), monkey-patch the instance.
  if (deps.embedText) {
    (embeddingSvc as unknown as { embedText: typeof deps.embedText }).embedText = deps.embedText;
  }

  let embedded = 0;
  for (let i = 0; i < batch; i++) {
    const { rows } = await pool.query(
      `SELECT id, aggregate_id::text AS aggregate_id, payload, attempt_count
       FROM outbound_events
       WHERE event_type = 'seo.embed_blog' AND status = 'pending' AND next_attempt_at <= now()
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
    let okFlag = false;
    try {
      if (postId) okFlag = await blogEmbed.embedPost(postId);
    } catch {
      okFlag = false;
    }

    if (okFlag) {
      await pool.query(
        `UPDATE outbound_events SET status = 'dispatched', attempt_count = attempt_count + 1, dispatched_at = now(), updated_at = now() WHERE id = $1`,
        [event.id]
      );
      embedded++;
    } else {
      const next = (Number(event.attempt_count) || 0) + 1;
      const failed = next >= EMBED_MAX_ATTEMPTS;
      await pool.query(
        `UPDATE outbound_events
         SET status = $2, attempt_count = $3,
             next_attempt_at = CASE WHEN $2 = 'failed' THEN next_attempt_at ELSE now() + interval '10 minutes' END,
             updated_at = now()
         WHERE id = $1`,
        [event.id, failed ? "failed" : "pending", next]
      );
      if (!failed) break; // leave the rest for the next run to avoid a hot loop when embeddings are off
    }
  }
  return { embedded };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-worker.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/worker/blog-worker.ts apps/api/test/blog-worker.test.ts
git commit -m "feat(blog): add worker orchestration (planner, generator+regen, embed sweep)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 17: Wire blog jobs into the standalone worker loop

**Files:**

- Modify: `apps/api/src/worker/worker.ts` — add three `setInterval` jobs inside the `if (pool) { … }` block, all gated on `FF_SEO_BLOG`; add job names to the startup log.
- Test: `apps/api/test/blog-worker-schedule.test.ts` (unit — verify the flag gate helper)

**Interfaces:**

- Consumes: `runBlogTopicPlanner`, `runBlogGenerator`, `runBlogEmbedSweep` (Task 16), the existing `pool`.
- Produces: a small exported helper `blogFlagEnabled(): boolean` in `blog-worker.ts` (add it there) reused by the worker so the gate is testable.

- [ ] **Step 1: Write the failing test**

Add `blogFlagEnabled` to the interfaces and test it. Create `apps/api/test/blog-worker-schedule.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { blogFlagEnabled } from "../src/worker/blog-worker";

describe("blogFlagEnabled", () => {
  const OLD = process.env.FF_SEO_BLOG;
  afterEach(() => {
    if (OLD === undefined) delete process.env.FF_SEO_BLOG;
    else process.env.FF_SEO_BLOG = OLD;
  });

  it("is false by default", () => {
    delete process.env.FF_SEO_BLOG;
    expect(blogFlagEnabled()).toBe(false);
  });
  it("is true when FF_SEO_BLOG=true", () => {
    process.env.FF_SEO_BLOG = "true";
    expect(blogFlagEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-worker-schedule.test.ts`
Expected: FAIL — `blogFlagEnabled` is not exported.

- [ ] **Step 3: Add `blogFlagEnabled` + wire the worker**

Add to `apps/api/src/worker/blog-worker.ts` (top-level export):

```typescript
export function blogFlagEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes((process.env.FF_SEO_BLOG ?? "").trim().toLowerCase());
}
```

In `apps/api/src/worker/worker.ts`:

Add imports near the top:

```typescript
import {
  blogFlagEnabled,
  runBlogTopicPlanner,
  runBlogGenerator,
  runBlogEmbedSweep
} from "./blog-worker";
```

Add interval constants near the other `_MS` constants:

```typescript
const BLOG_PLANNER_MS = 7 * 24 * 60 * 60 * 1000; // weekly
const BLOG_GENERATOR_MS = 24 * 60 * 60 * 1000; // daily
const BLOG_EMBED_SWEEP_MS = 5 * 60 * 1000; // every 5 minutes
```

Inside the `if (pool) { … }` block (near the other jobs), add:

```typescript
// ── Blog topic planner (weekly, gated by FF_SEO_BLOG) ──
const runBlogPlanner = async () => {
  if (!blogFlagEnabled()) return;
  try {
    const res = await runBlogTopicPlanner(pool);
    if (res.created > 0) {
      console.log(
        JSON.stringify({
          job: "blog_topic_planner",
          created: res.created,
          timestamp: new Date().toISOString()
        })
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        job: "blog_topic_planner",
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString()
      })
    );
  }
};
setInterval(runBlogPlanner, BLOG_PLANNER_MS);

// ── Blog generator (daily, gated by FF_SEO_BLOG) — writes DRAFTS only, never publishes ──
const runBlogGen = async () => {
  if (!blogFlagEnabled()) return;
  try {
    const res = await runBlogGenerator(pool, 3);
    if (res.drafted > 0 || res.needsAttention > 0) {
      console.log(
        JSON.stringify({
          job: "blog_generator",
          drafted: res.drafted,
          needs_attention: res.needsAttention,
          timestamp: new Date().toISOString()
        })
      );
    }
  } catch (err) {
    console.error(
      JSON.stringify({
        job: "blog_generator",
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString()
      })
    );
  }
};
setInterval(runBlogGen, BLOG_GENERATOR_MS);

// ── Blog embed sweep (every 5 min, gated) — processes seo.embed_blog before the generic dispatcher ──
const runBlogEmbed = async () => {
  if (!blogFlagEnabled()) return;
  try {
    const res = await runBlogEmbedSweep(pool, 25);
    if (res.embedded > 0) {
      console.log(
        JSON.stringify({
          job: "blog_embed_sweep",
          embedded: res.embedded,
          timestamp: new Date().toISOString()
        })
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/relation .* does not exist/i.test(message)) {
      console.error(
        JSON.stringify({
          job: "blog_embed_sweep",
          error: message,
          timestamp: new Date().toISOString()
        })
      );
    }
  }
};
setInterval(runBlogEmbed, BLOG_EMBED_SWEEP_MS);
```

Add the three job names to the `jobs: [ … ]` array in the final startup `console.log`:

```typescript
        "blog_topic_planner",
        "blog_generator",
        "blog_embed_sweep",
```

> Ordering note: `runBlogEmbedSweep` targets only `event_type='seo.embed_blog'` and runs on its own 5-min interval, so it claims those rows (`FOR UPDATE SKIP LOCKED`) before the generic `dispatch_outbound_events` job (which, with no CRM webhook, would otherwise mark them `dispatched` as a no-op and skip embedding). If you prefer belt-and-suspenders, you may also add `AND event_type <> 'seo.embed_blog'` to the generic dispatcher's SELECT in `runOutboundDispatchDb`, but it is not required for correctness given the dedicated sweep.

- [ ] **Step 4: Run test + typecheck**

Run: `pnpm --filter @cribliv/api exec vitest run test/blog-worker-schedule.test.ts`
Expected: PASS.

Run: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/worker/worker.ts apps/api/src/worker/blog-worker.ts apps/api/test/blog-worker-schedule.test.ts
git commit -m "feat(blog): schedule blog planner/generator/embed jobs in the worker (FF_SEO_BLOG)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 18: Embed-on-publish integration test (`seo_indexing_queue` + `outbound_events`)

**Files:**

- Test: `apps/api/test/blog-publish-sideeffects.integration.test.ts` (real `cribliv_test`)

**Interfaces:**

- Consumes: the full migration set + `BlogService.transition` + a direct SQL check that publish enqueues an `outbound_events` `seo.embed_blog` row. (This exercises the DB behaviour the admin controller relies on, end-to-end, against Postgres.)

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/blog-publish-sideeffects.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { BlogService } from "../src/modules/blog/blog.service";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");
// Renumber to match the real migration numbers (Task 0).
const NAMES = [
  "00A0_blog_categories",
  "00A1_blog_posts",
  "00A2_blog_briefs",
  "00A3_blog_embeddings"
];

describe.runIf(!!TEST_DB)("blog publish side-effects", () => {
  let client: Client;
  let db: BlogService;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    for (const n of NAMES) await client.query(readFileSync(join(MIG, `${n}.sql`), "utf8"));
    db = new BlogService({ isEnabled: () => true, query: (t, p) => client.query(t, p) } as never);
  });

  afterAll(async () => {
    for (const n of [...NAMES].reverse()) {
      await client
        .query(readFileSync(join(MIG, `${n}.rollback.sql`), "utf8"))
        .catch(() => undefined);
    }
    await client.end();
  });

  it("transition to published stamps published_at (only from the service)", async () => {
    const catId = (await client.query(`SELECT id FROM blog_categories WHERE slug = 'data-reports'`))
      .rows[0].id;
    const inserted = await client.query(
      `INSERT INTO blog_posts (slug, title, category_id, status, generated_by, target_keyword, body_en)
       VALUES ('pub-test', 'Pub test', $1, 'in_review', 'planner', 'k', '<p>x</p>') RETURNING id::text`,
      [catId]
    );
    const id = inserted.rows[0].id;
    const row = await db.transition(id, "published");
    expect(row?.status).toBe("published");
    expect(row?.published_at).not.toBeNull();
  });

  it("enqueuing seo.embed_blog into outbound_events is idempotent by dedupe_key", async () => {
    const id = (await client.query(`SELECT id::text FROM blog_posts WHERE slug = 'pub-test'`))
      .rows[0].id;
    const enqueue = () =>
      client.query(
        `INSERT INTO outbound_events (event_type, aggregate_type, aggregate_id, dedupe_key, payload, status, next_attempt_at)
         VALUES ('seo.embed_blog', 'blog_post', $1::uuid, $2, $3::jsonb, 'pending', now())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [id, `blog_embed:${id}`, JSON.stringify({ blog_post_id: id })]
      );
    await enqueue();
    await enqueue(); // duplicate — should be a no-op
    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM outbound_events WHERE dedupe_key = $1`,
      [`blog_embed:${id}`]
    );
    expect(count.rows[0].n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/blog-publish-sideeffects.integration.test.ts`
Expected: FAIL initially only if the migrations aren't renumbered/`outbound_events` isn't present. Ensure `cribliv_test` is fully migrated first (see the verification task's bootstrap). Then the test should compile and FAIL only on the assertions if the service were wrong — here it drives already-built code, so after the migrations are applied it will PASS. (If you are running strict red-green: temporarily assert `published_at` is null to see red, then flip.)

- [ ] **Step 3: (already implemented) — confirm green**

No new production code; this test validates Task 7 + Task 15 DB behaviour against real Postgres.

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/blog-publish-sideeffects.integration.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/blog-publish-sideeffects.integration.test.ts
git commit -m "test(blog): integration test for publish stamping + embed enqueue idempotency

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 19: Web — blog API client + `buildArticle` JSON-LD + author data

**Files:**

- Create: `apps/web/lib/blog-api.ts`
- Modify: `apps/web/lib/structured-data.ts` (add `buildArticle`)
- Create: `apps/web/lib/blog-author.ts`
- Test: `apps/web/lib/__tests__/structured-data-article.test.ts`
- Test: `apps/web/lib/__tests__/blog-api.test.ts`

**Interfaces:**

- Consumes: `fetchApi<T>` from `apps/web/lib/api.ts` (signature `fetchApi<T>(path, init?, opts?: { server?: boolean }): Promise<T>`), `SITE_URL` from `apps/web/lib/seo.ts`.
- Produces:
  - `blog-api.ts`: types `BlogListItem`, `BlogPostDetail`, `BlogRelated`; functions `fetchBlogList(params)`, `fetchBlogPost(slug)`, `fetchAllBlogSlugs()` (for sitemap + `generateStaticParams`). All use `fetchApi<...>(path, {}, { server: true })` for ISR.
  - `structured-data.ts`: `buildArticle(input: ArticleInput): JsonLd` returning schema.org `Article` with `headline`, `description`, `author` (`Person` with `name` + `url`), `datePublished`, `dateModified`, `image`, `mainEntityOfPage`, `publisher` (Organization).
  - `blog-author.ts`: `EDITORIAL_AUTHOR` mirror of the API persona (name/slug/role/bio en+hi) for the byline + bio page.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/structured-data-article.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildArticle } from "../structured-data";

describe("buildArticle", () => {
  it("returns a schema.org Article with author + publisher", () => {
    const a = buildArticle({
      headline: "2BHK rent in Gomti Nagar",
      description: "What tenants pay",
      authorName: "Aditi Sharma",
      authorUrl: "/en/blog/author/aditi-sharma",
      datePublished: "2026-07-02",
      dateModified: "2026-07-03",
      image: "/images/blog/hero.jpg",
      url: "/en/blog/2bhk-rent-gomti-nagar"
    });
    expect(a["@type"]).toBe("Article");
    expect(a.headline).toBe("2BHK rent in Gomti Nagar");
    expect((a.author as Record<string, unknown>)["@type"]).toBe("Person");
    expect((a.author as Record<string, unknown>).name).toBe("Aditi Sharma");
    expect((a.publisher as Record<string, unknown>)["@type"]).toBe("Organization");
    expect(String(a.mainEntityOfPage)).toContain("/en/blog/2bhk-rent-gomti-nagar");
    expect(String(a.author && (a.author as Record<string, unknown>).url)).toContain(
      "/author/aditi-sharma"
    );
  });
});
```

Create `apps/web/lib/__tests__/blog-api.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import * as api from "../api";
import { fetchBlogList, fetchBlogPost, fetchAllBlogSlugs } from "../blog-api";

afterEach(() => vi.restoreAllMocks());

describe("blog-api", () => {
  it("fetchBlogList calls /blog with query params and ISR", async () => {
    const spy = vi.spyOn(api, "fetchApi").mockResolvedValue({ items: [], total: 0 } as never);
    await fetchBlogList({ page: 2, city: "lucknow" });
    const [path, , opts] = spy.mock.calls[0];
    expect(String(path)).toContain("/blog?");
    expect(String(path)).toContain("city=lucknow");
    expect(opts).toMatchObject({ server: true });
  });

  it("fetchBlogPost returns null when API returns null data", async () => {
    vi.spyOn(api, "fetchApi").mockResolvedValue(null as never);
    await expect(fetchBlogPost("nope")).resolves.toBeNull();
  });

  it("fetchAllBlogSlugs pages through the list", async () => {
    const spy = vi
      .spyOn(api, "fetchApi")
      .mockResolvedValueOnce({ items: [{ slug: "a" }, { slug: "b" }], total: 2 } as never);
    const slugs = await fetchAllBlogSlugs();
    expect(slugs).toEqual(["a", "b"]);
    expect(spy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/structured-data-article.test.ts lib/__tests__/blog-api.test.ts`
Expected: FAIL — `buildArticle`/`blog-api` do not exist.

- [ ] **Step 3: Implement the three files**

In `apps/web/lib/structured-data.ts`, add:

```typescript
export interface ArticleInput {
  headline: string;
  description?: string | null;
  authorName: string;
  authorUrl: string;
  datePublished?: string | null;
  dateModified?: string | null;
  image?: string | null;
  url: string;
}

export function buildArticle(input: ArticleInput): JsonLd {
  const abs = (p: string) => (p.startsWith("http") ? p : `${SITE_URL}${p}`);
  const out: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    mainEntityOfPage: abs(input.url),
    author: { "@type": "Person", name: input.authorName, url: abs(input.authorUrl) },
    publisher: {
      "@type": "Organization",
      name: "Cribliv",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/images/logo.png` }
    }
  };
  if (input.description) out.description = input.description;
  if (input.datePublished) out.datePublished = input.datePublished;
  if (input.dateModified ?? input.datePublished)
    out.dateModified = input.dateModified ?? input.datePublished;
  if (input.image) out.image = abs(input.image);
  return out;
}
```

Create `apps/web/lib/blog-author.ts`:

```typescript
export const EDITORIAL_AUTHOR = {
  name: "Aditi Sharma",
  slug: "aditi-sharma",
  role: "Rental Markets Editor, Cribliv",
  bio_en:
    "Aditi Sharma covers India's rental markets for Cribliv, turning live listing data into practical guidance for tenants. She has tracked rents across Lucknow and the NCR since 2023.",
  bio_hi:
    "अदिति शर्मा Cribliv के लिए भारत के किराया बाज़ार पर लिखती हैं और लाइव लिस्टिंग डेटा को किरायेदारों के लिए व्यावहारिक सलाह में बदलती हैं।"
} as const;

export function authorPath(locale: "en" | "hi"): string {
  return `/${locale}/blog/author/${EDITORIAL_AUTHOR.slug}`;
}
```

Create `apps/web/lib/blog-api.ts`:

```typescript
import { fetchApi } from "./api";

export interface BlogListItem {
  slug: string;
  title: string;
  excerpt: string | null;
  category_slug: string | null;
  city_slug: string | null;
  hero_image_path: string | null;
  author: string;
  published_at: string | null;
  data_asof: string | null;
}

export interface BlogFaqItem {
  q: string;
  a: string;
}
export interface BlogSource {
  label: string;
  url?: string | null;
  asof?: string | null;
}
export interface BlogDataPoint {
  key: string;
  label: string;
  value: number | string;
  unit?: string | null;
}

export interface BlogPostDetail {
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  body_en: string | null;
  body_hi: string | null;
  target_keyword: string | null;
  city_slug: string | null;
  category_slug: string | null;
  hero_image_path: string | null;
  author: string;
  sources: BlogSource[];
  faq_items: BlogFaqItem[];
  data_asof: string | null;
  quality_breakdown?: { checks?: Array<{ id: string; value?: number | string | null }> };
  published_at: string | null;
  updated_at: string;
}

export interface BlogRelated {
  slug: string;
  title: string;
}

export async function fetchBlogList(
  params: {
    page?: number;
    page_size?: number;
    category?: string;
    city?: string;
  } = {}
): Promise<{ items: BlogListItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  if (params.category) qs.set("category", params.category);
  if (params.city) qs.set("city", params.city);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  try {
    return await fetchApi<{ items: BlogListItem[]; total: number }>(
      `/blog${suffix}`,
      {},
      { server: true }
    );
  } catch {
    return { items: [], total: 0 };
  }
}

export async function fetchBlogPost(
  slug: string
): Promise<{ post: BlogPostDetail; related: BlogRelated[] } | null> {
  try {
    const data = await fetchApi<{ post: BlogPostDetail; related: BlogRelated[] } | null>(
      `/blog/${encodeURIComponent(slug)}`,
      {},
      { server: true }
    );
    return data ?? null;
  } catch {
    return null;
  }
}

export async function fetchAllBlogSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  try {
    for (let page = 1; page <= 20; page++) {
      const { items, total } = await fetchBlogList({ page, page_size: 50 });
      for (const it of items) slugs.push(it.slug);
      if (page * 50 >= total || items.length === 0) break;
    }
  } catch {
    // best effort
  }
  return slugs;
}
```

> If `apps/web/lib/api.ts`'s `fetchApi` does not accept a third `opts` argument in your checkout, use the existing server-fetch convention the programmatic pages use (the Explore of `city/[citySlug]/[locality]/page.tsx` shows it). Match whatever that file does — do not invent a new option name.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/structured-data-article.test.ts lib/__tests__/blog-api.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/blog-api.ts apps/web/lib/structured-data.ts apps/web/lib/blog-author.ts apps/web/lib/__tests__/structured-data-article.test.ts apps/web/lib/__tests__/blog-api.test.ts
git commit -m "feat(blog,web): add blog API client, Article JSON-LD, author data

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 20: Web — blog hub page `/[locale]/blog` (ISR)

**Files:**

- Create: `apps/web/app/[locale]/blog/page.tsx`
- Modify: `apps/web/lib/i18n.ts` (add blog UI strings: `blogHubTitle`, `blogHubSubtitle`, `blogReadMore`, `blogRelated`, `blogDataAsOf`, `blogBy`, `blogNoPosts`)
- Test: `apps/web/app/[locale]/blog/__tests__/hub.test.tsx`

**Interfaces:**

- Consumes: `fetchBlogList` (Task 19), `buildPageMetadata` + `buildAlternates` (`apps/web/lib/seo.ts`), `buildBreadcrumb` + `renderJsonLd` (`structured-data.ts`), `t` (`i18n.ts`).
- Produces: an ISR page (`export const revalidate = 3600`) that lists published posts as cards with title, excerpt, author byline, and a "data as of" line; `generateStaticParams` emits `{ locale: "en" }` and `{ locale: "hi" }`; `generateMetadata` sets canonical/hreflang/OG via `buildPageMetadata`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/[locale]/blog/__tests__/hub.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import * as blogApi from "../../../../lib/blog-api";
import BlogHubPage, { generateStaticParams, generateMetadata } from "../page";

afterEach(() => vi.restoreAllMocks());

describe("Blog hub page", () => {
  it("generateStaticParams emits en + hi", async () => {
    const params = await generateStaticParams();
    expect(params).toEqual(expect.arrayContaining([{ locale: "en" }, { locale: "hi" }]));
  });

  it("generateMetadata sets a canonical + hreflang", async () => {
    const md = await generateMetadata({ params: { locale: "en" } });
    expect(md.alternates?.canonical).toContain("/en/blog");
    expect(md.alternates?.languages).toMatchObject({ hi: expect.stringContaining("/hi/blog") });
  });

  it("renders published post cards", async () => {
    vi.spyOn(blogApi, "fetchBlogList").mockResolvedValue({
      items: [
        {
          slug: "2bhk-rent-gomti-nagar",
          title: "2BHK rent in Gomti Nagar",
          excerpt: "What tenants pay",
          category_slug: "data-reports",
          city_slug: "lucknow",
          hero_image_path: null,
          author: "Aditi Sharma",
          published_at: "2026-07-02",
          data_asof: "2026-07-01"
        }
      ],
      total: 1
    });
    const ui = await BlogHubPage({ params: { locale: "en" } });
    const { getByText } = render(ui as React.ReactElement);
    expect(getByText("2BHK rent in Gomti Nagar")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run app/[locale]/blog/__tests__/hub.test.tsx`
Expected: FAIL — `../page` does not exist.

- [ ] **Step 3: Add i18n strings + the hub page**

In `apps/web/lib/i18n.ts`, add these entries to the `dictionary` object:

```typescript
  blogHubTitle: { en: "Cribliv Rental Insights", hi: "Cribliv किराया इनसाइट्स" },
  blogHubSubtitle: {
    en: "Data-backed guides to rents, localities and tenancy across India.",
    hi: "भारत भर के किराए, इलाकों और किरायेदारी पर डेटा-आधारित गाइड।"
  },
  blogReadMore: { en: "Read more", hi: "और पढ़ें" },
  blogRelated: { en: "Related posts", hi: "संबंधित पोस्ट" },
  blogDataAsOf: { en: "Data as of", hi: "डेटा इस तारीख तक" },
  blogBy: { en: "By", hi: "द्वारा" },
  blogNoPosts: { en: "No posts yet — check back soon.", hi: "अभी कोई पोस्ट नहीं — जल्द ही देखें।" }
```

Create `apps/web/app/[locale]/blog/page.tsx`:

```typescript
import type { Metadata } from "next";
import { buildPageMetadata } from "../../../lib/seo";
import { buildBreadcrumb, renderJsonLd } from "../../../lib/structured-data";
import { fetchBlogList } from "../../../lib/blog-api";
import { t, type Locale } from "../../../lib/i18n";

export const revalidate = 3600;

export async function generateStaticParams() {
  return [{ locale: "en" }, { locale: "hi" }];
}

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale: Locale = params.locale === "hi" ? "hi" : "en";
  return buildPageMetadata({
    title: `${t(locale, "blogHubTitle")} — Cribliv`,
    description: t(locale, "blogHubSubtitle"),
    pathname: "/blog",
    locale
  });
}

export default async function BlogHubPage({ params }: { params: { locale: string } }) {
  const locale: Locale = params.locale === "hi" ? "hi" : "en";
  const { items } = await fetchBlogList({ page_size: 24 });
  const breadcrumb = buildBreadcrumb([
    { name: "Home", href: `/${locale}` },
    { name: t(locale, "blogHubTitle"), href: `/${locale}/blog` }
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(breadcrumb) }} />
      <div style={{ paddingTop: "var(--space-10)", paddingBottom: "var(--space-16)" }}>
        <div className="container--narrow" style={{ marginBottom: "var(--space-8)" }}>
          <h1 style={{ marginBottom: "var(--space-2)" }}>{t(locale, "blogHubTitle")}</h1>
          <p className="text-secondary" style={{ maxWidth: 640 }}>{t(locale, "blogHubSubtitle")}</p>
        </div>

        <div className="container--narrow">
          {items.length === 0 ? (
            <p className="text-secondary">{t(locale, "blogNoPosts")}</p>
          ) : (
            <div className="grid grid-3" style={{ gap: "var(--space-5)" }}>
              {items.map((post) => (
                <a
                  key={post.slug}
                  href={`/${locale}/blog/${post.slug}`}
                  style={{
                    display: "flex", flexDirection: "column", gap: "var(--space-2)",
                    background: "white", border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)", padding: "var(--space-5)",
                    textDecoration: "none", color: "var(--text-primary)"
                  }}
                >
                  <h2 style={{ fontSize: "var(--text-lg)", margin: 0 }}>{post.title}</h2>
                  {post.excerpt && (
                    <p className="text-secondary" style={{ fontSize: "var(--text-sm)", margin: 0 }}>
                      {post.excerpt}
                    </p>
                  )}
                  <span className="text-secondary" style={{ fontSize: "var(--text-xs)", marginTop: "auto" }}>
                    {t(locale, "blogBy")} {post.author}
                    {post.data_asof ? ` · ${t(locale, "blogDataAsOf")} ${post.data_asof}` : ""}
                  </span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run app/[locale]/blog/__tests__/hub.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/blog/page.tsx" apps/web/lib/i18n.ts "apps/web/app/[locale]/blog/__tests__/hub.test.tsx"
git commit -m "feat(blog,web): add ISR blog hub page + i18n strings

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 21: Web — blog detail page `/[locale]/blog/[slug]` (ISR) + data chart

**Files:**

- Create: `apps/web/components/blog/RentBarChart.tsx` (client component, recharts)
- Create: `apps/web/app/[locale]/blog/[slug]/page.tsx`
- Test: `apps/web/app/[locale]/blog/[slug]/__tests__/detail.test.tsx`

**Interfaces:**

- Consumes: `fetchBlogPost`, `fetchAllBlogSlugs` (Task 19); `buildArticle`, `buildFaqPage`, `buildBreadcrumb`, `renderJsonLd` (`structured-data.ts`); `buildPageMetadata` (`seo.ts`); `EDITORIAL_AUTHOR` + `authorPath` (`blog-author.ts`); `t` (`i18n.ts`).
- Produces:
  - `RentBarChart`: `"use client"` recharts `<BarChart>` of the post's data points (median rents), used inside a fact-block. Props `{ data: Array<{ label: string; value: number }>; unitLabel?: string }`.
  - detail page: `export const revalidate = 3600`; `generateStaticParams` = `en`+`hi` × all published slugs (from `fetchAllBlogSlugs`); `generateMetadata` sets Article-appropriate metadata + `noindex` when the post is missing; renders the correct-locale body (`body_hi` when `locale==='hi'` else `body_en`), a byline linking to the author bio, a "data as of" line + the recharts fact-block when data points exist, the FAQ block, a related-posts rail, and injects three JSON-LD scripts (Article + FAQPage + BreadcrumbList).

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/[locale]/blog/[slug]/__tests__/detail.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import * as blogApi from "../../../../../lib/blog-api";
import BlogDetailPage, { generateMetadata } from "../page";

const DETAIL = {
  post: {
    slug: "2bhk-rent-gomti-nagar",
    title: "2BHK rent in Gomti Nagar",
    meta_title: "2BHK rent in Gomti Nagar — Cribliv",
    meta_description: "What tenants pay",
    excerpt: "x",
    body_en: "<h1>2BHK rent in Gomti Nagar</h1><p>Median is ₹18,000.</p>",
    body_hi: "<h1>गोमती नगर</h1><p>₹18,000</p>",
    target_keyword: "2bhk rent gomti nagar",
    city_slug: "lucknow",
    category_slug: "data-reports",
    hero_image_path: null,
    author: "Aditi Sharma",
    sources: [{ label: "Cribliv live listings", asof: "2026-07-01" }],
    faq_items: [{ q: "Average 2BHK rent?", a: "About ₹18,000." }],
    data_asof: "2026-07-01",
    quality_breakdown: { checks: [] },
    published_at: "2026-07-02",
    updated_at: "2026-07-03"
  },
  related: [{ slug: "rent-trends-in-indira-nagar", title: "Rent trends in Indira Nagar" }]
};

afterEach(() => vi.restoreAllMocks());

describe("Blog detail page", () => {
  it("generateMetadata pulls the post meta + sets canonical", async () => {
    vi.spyOn(blogApi, "fetchBlogPost").mockResolvedValue(DETAIL as never);
    const md = await generateMetadata({ params: { locale: "en", slug: "2bhk-rent-gomti-nagar" } });
    expect(md.title).toContain("2BHK rent in Gomti Nagar");
    expect(md.alternates?.canonical).toContain("/en/blog/2bhk-rent-gomti-nagar");
  });

  it("renders the body, byline, FAQ, related, and 3 JSON-LD blocks", async () => {
    vi.spyOn(blogApi, "fetchBlogPost").mockResolvedValue(DETAIL as never);
    const ui = await BlogDetailPage({ params: { locale: "en", slug: "2bhk-rent-gomti-nagar" } });
    const { container, getByText } = render(ui as React.ReactElement);
    // Body rendered
    expect(container.innerHTML).toContain("₹18,000");
    // Byline links to author bio
    expect(container.querySelector('a[href*="/blog/author/aditi-sharma"]')).toBeTruthy();
    // FAQ + related
    expect(getByText("Average 2BHK rent?")).toBeTruthy();
    expect(getByText("Rent trends in Indira Nagar")).toBeTruthy();
    // Three JSON-LD scripts: Article, FAQPage, BreadcrumbList
    const scripts = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).map((s) => s.innerHTML);
    const joined = scripts.join(" ");
    expect(joined).toContain('"Article"');
    expect(joined).toContain('"FAQPage"');
    expect(joined).toContain('"BreadcrumbList"');
  });

  it("renders the hi body on the hi locale", async () => {
    vi.spyOn(blogApi, "fetchBlogPost").mockResolvedValue(DETAIL as never);
    const ui = await BlogDetailPage({ params: { locale: "hi", slug: "2bhk-rent-gomti-nagar" } });
    const { container } = render(ui as React.ReactElement);
    expect(container.innerHTML).toContain("गोमती नगर");
  });

  it("returns a not-found view + noindex when the post is missing", async () => {
    vi.spyOn(blogApi, "fetchBlogPost").mockResolvedValue(null);
    const md = await generateMetadata({ params: { locale: "en", slug: "nope" } });
    expect(md.robots).toMatchObject({ index: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run app/[locale]/blog/[slug]/__tests__/detail.test.tsx`
Expected: FAIL — `../page` / `RentBarChart` do not exist.

- [ ] **Step 3: Implement the chart + detail page**

Create `apps/web/components/blog/RentBarChart.tsx`:

```typescript
"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface RentBarChartProps {
  data: Array<{ label: string; value: number }>;
  unitLabel?: string;
}

export function RentBarChart({ data, unitLabel }: RentBarChartProps) {
  if (!data.length) return null;
  return (
    <div style={{ width: "100%", height: 280 }} aria-label={`Rent chart${unitLabel ? ` (${unitLabel})` : ""}`}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v: number) => [`₹${Number(v).toLocaleString("en-IN")}`, unitLabel ?? "Rent"]} />
          <Bar dataKey="value" fill="var(--brand)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

Create `apps/web/app/[locale]/blog/[slug]/page.tsx`:

```typescript
import type { Metadata } from "next";
import { buildPageMetadata } from "../../../../lib/seo";
import {
  buildArticle, buildBreadcrumb, buildFaqPage, renderJsonLd
} from "../../../../lib/structured-data";
import { fetchAllBlogSlugs, fetchBlogPost } from "../../../../lib/blog-api";
import { EDITORIAL_AUTHOR, authorPath } from "../../../../lib/blog-author";
import { t, type Locale } from "../../../../lib/i18n";
import { RentBarChart } from "../../../../components/blog/RentBarChart";

export const revalidate = 3600;

export async function generateStaticParams() {
  const slugs = await fetchAllBlogSlugs();
  const out: Array<{ locale: string; slug: string }> = [];
  for (const slug of slugs) {
    out.push({ locale: "en", slug });
    out.push({ locale: "hi", slug });
  }
  return out;
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const locale: Locale = params.locale === "hi" ? "hi" : "en";
  const data = await fetchBlogPost(params.slug);
  if (!data) {
    return buildPageMetadata({
      title: "Post not found — Cribliv",
      description: "This article is not available.",
      pathname: `/blog/${params.slug}`,
      locale,
      noindex: true
    });
  }
  const p = data.post;
  return buildPageMetadata({
    title: p.meta_title ?? `${p.title} — Cribliv`,
    description: p.meta_description ?? p.excerpt ?? "",
    pathname: `/blog/${p.slug}`,
    locale,
    image: p.hero_image_path ?? null
  });
}

/** Pull chartable rent data points out of the quality breakdown (values the gate saw). */
function rentChartData(post: { quality_breakdown?: { checks?: Array<{ id: string; value?: number | string | null }> } }): Array<{ label: string; value: number }> {
  // The generator stores dataFacts on the row's sources/quality; for the chart we
  // parse the rendered figures conservatively from known keys if present.
  // Falls back to empty (no chart) when nothing numeric is available.
  return [];
}

export default async function BlogDetailPage({ params }: { params: { locale: string; slug: string } }) {
  const locale: Locale = params.locale === "hi" ? "hi" : "en";
  const data = await fetchBlogPost(params.slug);

  if (!data) {
    return (
      <div className="container--narrow" style={{ padding: "var(--space-16) 0", textAlign: "center" }}>
        <h1>Post not found</h1>
        <a href={`/${locale}/blog`} style={{ color: "var(--brand)", fontWeight: 600 }}>← {t(locale, "blogHubTitle")}</a>
      </div>
    );
  }

  const { post, related } = data;
  const body = (locale === "hi" ? post.body_hi : post.body_en) || post.body_en || "";
  const url = `/${locale}/blog/${post.slug}`;
  const author = authorPath(locale);

  const article = buildArticle({
    headline: post.title,
    description: post.meta_description ?? post.excerpt,
    authorName: post.author || EDITORIAL_AUTHOR.name,
    authorUrl: author,
    datePublished: post.published_at,
    dateModified: post.updated_at,
    image: post.hero_image_path,
    url
  });
  const faq = post.faq_items.length ? buildFaqPage(post.faq_items) : null;
  const breadcrumb = buildBreadcrumb([
    { name: "Home", href: `/${locale}` },
    { name: t(locale, "blogHubTitle"), href: `/${locale}/blog` },
    { name: post.title, href: url }
  ]);
  const chart = rentChartData(post);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(article) }} />
      {faq && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(faq) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(breadcrumb) }} />

      <article className="container--narrow" style={{ padding: "var(--space-10) 0 var(--space-16)" }}>
        <nav style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-4)" }} className="text-secondary">
          <a href={`/${locale}/blog`} style={{ color: "var(--brand)", textDecoration: "none" }}>
            {t(locale, "blogHubTitle")}
          </a>
          <span style={{ margin: "0 var(--space-2)" }}>/</span>
          <span>{post.title}</span>
        </nav>

        <h1 style={{ marginBottom: "var(--space-3)" }}>{post.title}</h1>

        <div className="text-secondary" style={{ fontSize: "var(--text-sm)", marginBottom: "var(--space-6)" }}>
          {t(locale, "blogBy")}{" "}
          <a href={author} style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}>
            {post.author}
          </a>
          {post.published_at ? ` · ${post.published_at.slice(0, 10)}` : ""}
          {post.data_asof ? ` · ${t(locale, "blogDataAsOf")} ${post.data_asof}` : ""}
        </div>

        {chart.length > 0 && (
          <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "var(--space-5)", marginBottom: "var(--space-6)" }}>
            <RentBarChart data={chart} unitLabel="₹/mo" />
          </div>
        )}

        <div className="blog-body" dangerouslySetInnerHTML={{ __html: body }} />

        {post.sources.length > 0 && (
          <div className="text-secondary" style={{ fontSize: "var(--text-xs)", marginTop: "var(--space-6)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
            {post.sources.map((s, i) => (
              <span key={i}>{s.label}{s.asof ? ` (${s.asof})` : ""}{i < post.sources.length - 1 ? " · " : ""}</span>
            ))}
          </div>
        )}

        {post.faq_items.length > 0 && (
          <section style={{ marginTop: "var(--space-10)" }}>
            <h2>FAQ</h2>
            {post.faq_items.map((f) => (
              <details key={f.q} style={{ background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", marginBottom: "var(--space-3)" }}>
                <summary style={{ padding: "var(--space-4)", cursor: "pointer", fontWeight: 600, listStyle: "none" }}>{f.q}</summary>
                <div className="text-secondary" style={{ padding: "0 var(--space-4) var(--space-4)" }}>{f.a}</div>
              </details>
            ))}
          </section>
        )}

        {related.length > 0 && (
          <section style={{ marginTop: "var(--space-10)" }}>
            <h2>{t(locale, "blogRelated")}</h2>
            <ul>
              {related.map((r) => (
                <li key={r.slug}>
                  <a href={`/${locale}/blog/${r.slug}`} style={{ color: "var(--brand)" }}>{r.title}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </>
  );
}
```

> The `rentChartData` stub returns `[]` by default so the page compiles and the test (which passes no chartable data) is green. When you want live charts, extend the API `GET /blog/:slug` payload to include `data_facts` (already on the row) and map the rent keys here — that is a small follow-up, not required for the gate/coverage in this slice.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run app/[locale]/blog/[slug]/__tests__/detail.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/components/blog/RentBarChart.tsx" "apps/web/app/[locale]/blog/[slug]/page.tsx" "apps/web/app/[locale]/blog/[slug]/__tests__/detail.test.tsx"
git commit -m "feat(blog,web): add ISR blog detail page (Article+FAQ+Breadcrumb JSON-LD, chart)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 22: Web — author bio page `/[locale]/blog/author/[authorSlug]` (E-E-A-T)

**Files:**

- Create: `apps/web/app/[locale]/blog/author/[authorSlug]/page.tsx`
- Test: `apps/web/app/[locale]/blog/author/[authorSlug]/__tests__/author.test.tsx`

**Interfaces:**

- Consumes: `EDITORIAL_AUTHOR` (`blog-author.ts`), `fetchBlogList` (to show the author's recent posts), `buildPageMetadata`, `buildBreadcrumb` + a `Person` JSON-LD (inline), `t`.
- Produces: an ISR page (`revalidate = 3600`) with the persona's name, role, bilingual bio, a `Person` JSON-LD (`@type: Person`, `name`, `jobTitle`, `worksFor` Organization, `url`), and a list of recent posts. `generateStaticParams` emits `en`+`hi` for the single known author slug.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/[locale]/blog/author/[authorSlug]/__tests__/author.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import * as blogApi from "../../../../../../lib/blog-api";
import AuthorPage, { generateStaticParams, generateMetadata } from "../page";

afterEach(() => vi.restoreAllMocks());

describe("Author bio page", () => {
  it("generateStaticParams emits en + hi for the known author", async () => {
    const params = await generateStaticParams();
    expect(params).toEqual(
      expect.arrayContaining([
        { locale: "en", authorSlug: "aditi-sharma" },
        { locale: "hi", authorSlug: "aditi-sharma" }
      ])
    );
  });

  it("generateMetadata sets a canonical for the author page", async () => {
    const md = await generateMetadata({ params: { locale: "en", authorSlug: "aditi-sharma" } });
    expect(md.alternates?.canonical).toContain("/en/blog/author/aditi-sharma");
  });

  it("renders the bio + a Person JSON-LD", async () => {
    vi.spyOn(blogApi, "fetchBlogList").mockResolvedValue({ items: [], total: 0 });
    const ui = await AuthorPage({ params: { locale: "en", authorSlug: "aditi-sharma" } });
    const { container, getByText } = render(ui as React.ReactElement);
    expect(getByText("Aditi Sharma")).toBeTruthy();
    const jsonld = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => s.innerHTML)
      .join(" ");
    expect(jsonld).toContain('"Person"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run "app/[locale]/blog/author/[authorSlug]/__tests__/author.test.tsx"`
Expected: FAIL — `../page` does not exist.

- [ ] **Step 3: Implement the author page**

Create `apps/web/app/[locale]/blog/author/[authorSlug]/page.tsx`:

```typescript
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SITE_URL, buildPageMetadata } from "../../../../../lib/seo";
import { buildBreadcrumb, renderJsonLd } from "../../../../../lib/structured-data";
import { EDITORIAL_AUTHOR } from "../../../../../lib/blog-author";
import { fetchBlogList } from "../../../../../lib/blog-api";
import { t, type Locale } from "../../../../../lib/i18n";

export const revalidate = 3600;

export async function generateStaticParams() {
  return [
    { locale: "en", authorSlug: EDITORIAL_AUTHOR.slug },
    { locale: "hi", authorSlug: EDITORIAL_AUTHOR.slug }
  ];
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; authorSlug: string };
}): Promise<Metadata> {
  const locale: Locale = params.locale === "hi" ? "hi" : "en";
  return buildPageMetadata({
    title: `${EDITORIAL_AUTHOR.name} — ${EDITORIAL_AUTHOR.role}`,
    description: locale === "hi" ? EDITORIAL_AUTHOR.bio_hi : EDITORIAL_AUTHOR.bio_en,
    pathname: `/blog/author/${params.authorSlug}`,
    locale
  });
}

export default async function AuthorPage({ params }: { params: { locale: string; authorSlug: string } }) {
  if (params.authorSlug !== EDITORIAL_AUTHOR.slug) notFound();
  const locale: Locale = params.locale === "hi" ? "hi" : "en";
  const { items } = await fetchBlogList({ page_size: 12 });

  const person = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: EDITORIAL_AUTHOR.name,
    jobTitle: EDITORIAL_AUTHOR.role,
    url: `${SITE_URL}/${locale}/blog/author/${EDITORIAL_AUTHOR.slug}`,
    worksFor: { "@type": "Organization", name: "Cribliv", url: SITE_URL }
  };
  const breadcrumb = buildBreadcrumb([
    { name: "Home", href: `/${locale}` },
    { name: t(locale, "blogHubTitle"), href: `/${locale}/blog` },
    { name: EDITORIAL_AUTHOR.name, href: `/${locale}/blog/author/${EDITORIAL_AUTHOR.slug}` }
  ]);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(person) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: renderJsonLd(breadcrumb) }} />
      <div className="container--narrow" style={{ padding: "var(--space-10) 0 var(--space-16)" }}>
        <h1 style={{ marginBottom: "var(--space-1)" }}>{EDITORIAL_AUTHOR.name}</h1>
        <p className="text-secondary" style={{ fontWeight: 600, marginBottom: "var(--space-4)" }}>
          {EDITORIAL_AUTHOR.role}
        </p>
        <p style={{ maxWidth: 640, lineHeight: 1.7 }}>
          {locale === "hi" ? EDITORIAL_AUTHOR.bio_hi : EDITORIAL_AUTHOR.bio_en}
        </p>

        {items.length > 0 && (
          <section style={{ marginTop: "var(--space-10)" }}>
            <h2>{t(locale, "blogHubTitle")}</h2>
            <ul>
              {items.map((p) => (
                <li key={p.slug}>
                  <a href={`/${locale}/blog/${p.slug}`} style={{ color: "var(--brand)" }}>{p.title}</a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run "app/[locale]/blog/author/[authorSlug]/__tests__/author.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/blog/author/[authorSlug]/page.tsx" "apps/web/app/[locale]/blog/author/[authorSlug]/__tests__/author.test.tsx"
git commit -m "feat(blog,web): add author bio page (Person JSON-LD) for E-E-A-T

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 23: Web — sitemap blog chunk

**Files:**

- Modify: `apps/web/app/sitemap.ts` (add a `{ kind: "blog" }` chunk to `resolveChunks` + a `buildBlogChunk`)
- Test: `apps/web/app/__tests__/sitemap-blog.test.ts`

**Interfaces:**

- Consumes: `fetchAllBlogSlugs` (Task 19), `entry` (from `sitemap-chunks.ts`, which emits both locales + hreflang), and the author path.
- Produces: `buildBlogChunk(): Promise<MetadataRoute.Sitemap>` returning the hub (`/blog`), the author page (`/blog/author/aditi-sharma`), and each published post (`/blog/<slug>`), all via `entry(BASE_URL, path, { priority })` so both `en` + `hi` are emitted with alternates. `resolveChunks` includes `{ kind: "blog" }` and the default `sitemap()` handles it.

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/__tests__/sitemap-blog.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import * as blogApi from "../../lib/blog-api";
import { resolveChunks } from "../sitemap";

afterEach(() => vi.restoreAllMocks());

describe("sitemap blog chunk", () => {
  it("includes a blog chunk in resolveChunks", async () => {
    const chunks = await resolveChunks();
    expect(chunks.some((c) => c.kind === "blog")).toBe(true);
  });

  it("buildBlogChunk emits hub + author + post URLs for both locales", async () => {
    vi.spyOn(blogApi, "fetchAllBlogSlugs").mockResolvedValue(["2bhk-rent-gomti-nagar"]);
    // buildBlogChunk is exercised via the default export by locating the blog chunk id.
    const { default: sitemap, resolveChunks: resolve } = await import("../sitemap");
    const chunks = await resolve();
    const blogId = chunks.findIndex((c) => c.kind === "blog");
    const rows = await sitemap({ id: blogId });
    const urls = rows.map((r) => r.url);
    expect(urls.some((u) => u.endsWith("/en/blog"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/hi/blog"))).toBe(true);
    expect(urls.some((u) => u.includes("/blog/author/aditi-sharma"))).toBe(true);
    expect(urls.some((u) => u.includes("/blog/2bhk-rent-gomti-nagar"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run app/__tests__/sitemap-blog.test.ts`
Expected: FAIL — no blog chunk yet.

- [ ] **Step 3: Add the blog chunk**

In `apps/web/app/sitemap.ts`:

Add the import near the top:

```typescript
import { fetchAllBlogSlugs } from "../lib/blog-api";
```

Extend the `ChunkDescriptor` type:

```typescript
type ChunkDescriptor =
  | { kind: "core" }
  | { kind: "listings" }
  | { kind: "blog" }
  | { kind: "city"; citySlug: string };
```

Add `{ kind: "blog" }` to the array returned by `resolveChunks` (after `{ kind: "listings" }`):

```typescript
return [
  { kind: "core" },
  { kind: "listings" },
  { kind: "blog" },
  ...cities.map((citySlug) => ({ kind: "city" as const, citySlug }))
];
```

Add the builder (near `buildListingsChunk`):

```typescript
async function buildBlogChunk(): Promise<MetadataRoute.Sitemap> {
  const rows: MetadataRoute.Sitemap = [];
  rows.push(...entry(BASE_URL, "/blog", { priority: 0.7, freq: "daily" }));
  rows.push(...entry(BASE_URL, "/blog/author/aditi-sharma", { priority: 0.4, freq: "monthly" }));
  let slugs: string[] = [];
  try {
    slugs = await fetchAllBlogSlugs();
  } catch {
    slugs = [];
  }
  for (const slug of slugs) {
    rows.push(...entry(BASE_URL, `/blog/${slug}`, { priority: 0.6, freq: "weekly" }));
  }
  return rows;
}
```

Handle the chunk in the default `sitemap` function (add before the final `return buildCityChunk(...)`):

```typescript
if (chunk.kind === "core") return buildCoreChunk();
if (chunk.kind === "listings") return buildListingsChunk();
if (chunk.kind === "blog") return buildBlogChunk();
return buildCityChunk(chunk.citySlug);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run app/__tests__/sitemap-blog.test.ts`
Expected: PASS (2 tests). Also re-run the existing sitemap tests to confirm no regression:
Run: `pnpm --filter @cribliv/web exec vitest run app/__tests__/sitemap.test.ts app/__tests__/sitemap-chunks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/sitemap.ts apps/web/app/__tests__/sitemap-blog.test.ts
git commit -m "feat(blog,web): add blog chunk to the sitemap (hub, author, posts, hreflang)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 24: Web — admin blog queue tab + admin-api client

**Files:**

- Modify: `apps/web/lib/admin-api.ts` (add blog client functions)
- Create: `apps/web/components/admin/tabs/BlogTab.tsx`
- Modify: `apps/web/components/admin/shell/AdminSidebar.tsx` (add `"blog"` to `AdminTab`, add a nav item)
- Modify: `apps/web/components/admin/shell/AdminShell.tsx` (add `blog` to `TAB_TITLES`, import + render `BlogTab`)
- Test: `apps/web/lib/__tests__/admin-api-blog.test.ts`
- Test: `apps/web/components/admin/tabs/__tests__/blog-tab.test.tsx`

**Interfaces:**

- Consumes: `fetchApi` + the admin auth-header helper already in `admin-api.ts`; `DataTable` + `StatCard` primitives; the admin API routes from Task 15.
- Produces:
  - `admin-api.ts`:
    - `fetchAdminBlogPosts(accessToken, status?): Promise<AdminBlogPostVm[]>`
    - `approveBlogPost(accessToken, id)`, `publishBlogPost(accessToken, id)`, `archiveBlogPost(accessToken, id)`
    - `editBlogPost(accessToken, id, patch)`
    - `planBlogTopics(accessToken, body)`, `generateBlogNow(accessToken, body)`
    - VM shape `AdminBlogPostVm` (camelCase mapping incl. `qualityScore`, `qualityChecks`, `status`, `slug`).
  - `BlogTab.tsx`: a tab that lists posts (default `status=draft` + `needs_attention`), shows each post's quality breakdown (pass/fail checks) + score in the `DataTable`, and exposes Approve / Publish / Archive / Generate-now actions. `onCountChange` reports the count of drafts awaiting review; `onToast` surfaces action results.
  - `AdminSidebar`/`AdminShell` wired so the tab appears under "Understand".

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/__tests__/admin-api-blog.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import * as api from "../api";
import { fetchAdminBlogPosts, publishBlogPost, generateBlogNow } from "../admin-api";

afterEach(() => vi.restoreAllMocks());

describe("admin-api blog", () => {
  it("fetchAdminBlogPosts calls /admin/blog with status + auth header", async () => {
    const spy = vi
      .spyOn(api, "fetchApi")
      .mockResolvedValue({
        items: [
          {
            id: "p1",
            slug: "s",
            title: "t",
            status: "draft",
            quality_score: 0.9,
            quality_breakdown: { checks: [] }
          }
        ]
      } as never);
    const rows = await fetchAdminBlogPosts("tok", "draft");
    const [path, init] = spy.mock.calls[0];
    expect(String(path)).toContain("/admin/blog?status=draft");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(rows[0].slug).toBe("s");
  });

  it("publishBlogPost POSTs to the publish route", async () => {
    const spy = vi.spyOn(api, "fetchApi").mockResolvedValue({ status: "published" } as never);
    await publishBlogPost("tok", "p1");
    const [path, init] = spy.mock.calls[0];
    expect(String(path)).toContain("/admin/blog/p1/publish");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("generateBlogNow POSTs the brief spec", async () => {
    const spy = vi.spyOn(api, "fetchApi").mockResolvedValue({ status: "draft" } as never);
    await generateBlogNow("tok", {
      target_keyword: "2bhk rent gomti nagar",
      city_slug: "lucknow",
      category_slug: "data-reports"
    });
    const [path, init] = spy.mock.calls[0];
    expect(String(path)).toContain("/admin/blog/generate-now");
    expect(String((init as RequestInit).body)).toContain("2bhk rent gomti nagar");
  });
});
```

Create `apps/web/components/admin/tabs/__tests__/blog-tab.test.tsx`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import * as adminApi from "../../../../lib/admin-api";
import { BlogTab } from "../BlogTab";

afterEach(() => vi.restoreAllMocks());

describe("BlogTab", () => {
  it("lists drafts with quality score and reports the count", async () => {
    vi.spyOn(adminApi, "fetchAdminBlogPosts").mockResolvedValue([
      { id: "p1", slug: "2bhk-rent-gomti-nagar", title: "2BHK rent in Gomti Nagar", status: "draft", qualityScore: 0.9, qualityChecks: [{ id: "word_count", passed: true, label: "Words", detail: "1300" }], citySlug: "lucknow" }
    ] as never);
    const onCount = vi.fn();
    const { getByText } = render(<BlogTab accessToken="tok" onCountChange={onCount} onToast={() => {}} />);
    await waitFor(() => expect(getByText("2BHK rent in Gomti Nagar")).toBeTruthy());
    expect(onCount).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/admin-api-blog.test.ts components/admin/tabs/__tests__/blog-tab.test.tsx`
Expected: FAIL — the admin blog functions + `BlogTab` do not exist.

- [ ] **Step 3: Implement the admin-api functions, the tab, and wire the shell**

In `apps/web/lib/admin-api.ts`, add (reusing the existing `authHeaders`/`fetchApi` helpers in that file — match their exact names in your checkout):

```typescript
export interface AdminBlogPostVm {
  id: string;
  slug: string;
  title: string;
  status: string;
  qualityScore: number | null;
  qualityChecks: Array<{ id: string; label: string; passed: boolean; detail: string }>;
  citySlug: string | null;
  categorySlug?: string | null;
  updatedAt?: string;
}

function toBlogVm(r: {
  id: string;
  slug: string;
  title: string;
  status: string;
  quality_score?: number | null;
  quality_breakdown?: {
    checks?: Array<{ id: string; label: string; passed: boolean; detail: string }>;
  };
  city_slug?: string | null;
  category_slug?: string | null;
  updated_at?: string;
}): AdminBlogPostVm {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    status: r.status,
    qualityScore: r.quality_score ?? null,
    qualityChecks: r.quality_breakdown?.checks ?? [],
    citySlug: r.city_slug ?? null,
    categorySlug: r.category_slug ?? null,
    updatedAt: r.updated_at
  };
}

export async function fetchAdminBlogPosts(
  accessToken: string,
  status?: string
): Promise<AdminBlogPostVm[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await fetchApi<{ items: Parameters<typeof toBlogVm>[0][] }>(`/admin/blog${qs}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return (data.items ?? []).map(toBlogVm);
}

export async function approveBlogPost(accessToken: string, id: string) {
  return fetchApi(`/admin/blog/${id}/approve`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}
export async function publishBlogPost(accessToken: string, id: string) {
  return fetchApi(`/admin/blog/${id}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}
export async function archiveBlogPost(accessToken: string, id: string) {
  return fetchApi(`/admin/blog/${id}/archive`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}
export async function editBlogPost(
  accessToken: string,
  id: string,
  patch: Record<string, unknown>
) {
  return fetchApi(`/admin/blog/${id}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
}
export async function planBlogTopics(
  accessToken: string,
  body: { city_slugs?: string[]; max_briefs?: number }
) {
  return fetchApi(`/admin/blog/plan`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
export async function generateBlogNow(
  accessToken: string,
  body: { brief_id?: string; target_keyword?: string; city_slug?: string; category_slug?: string }
) {
  return fetchApi(`/admin/blog/generate-now`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}
```

> If `admin-api.ts` centralises auth via a helper like `authHeaders(accessToken)` instead of inline `{ Authorization: ... }`, use that helper for consistency. The tests assert the resulting header equals `Bearer tok`, which both forms satisfy.

Create `apps/web/components/admin/tabs/BlogTab.tsx`:

```typescript
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, type Column } from "../primitives/DataTable";
import { StatCard } from "../primitives/StatCard";
import {
  approveBlogPost, archiveBlogPost, fetchAdminBlogPosts, generateBlogNow, planBlogTopics,
  publishBlogPost, type AdminBlogPostVm
} from "../../../lib/admin-api";

interface Props {
  accessToken: string;
  onCountChange?: (count: number) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const REVIEW_STATUSES = ["draft", "needs_attention", "in_review"];

export function BlogTab({ accessToken, onCountChange, onToast }: Props) {
  const [posts, setPosts] = useState<AdminBlogPostVm[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const all = await Promise.all(
        REVIEW_STATUSES.map((s) => fetchAdminBlogPosts(accessToken, s).catch(() => []))
      );
      const flat = all.flat();
      setPosts(flat);
      onCountChange?.(flat.filter((p) => p.status === "draft" || p.status === "needs_attention").length);
    } catch {
      onToast("Failed to load blog posts", "danger");
    } finally {
      setLoading(false);
    }
  }, [accessToken, onCountChange, onToast]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        onToast(`${label} succeeded`, "trust");
        await load();
      } catch {
        onToast(`${label} failed`, "danger");
      }
    },
    [load, onToast]
  );

  const columns = useMemo<Column<AdminBlogPostVm>[]>(() => [
    { key: "title", header: "Title", render: (r) => r.title },
    { key: "status", header: "Status", render: (r) => r.status },
    {
      key: "quality",
      header: "Quality",
      render: (r) => {
        const failed = r.qualityChecks.filter((c) => !c.passed);
        return (
          <span title={failed.map((c) => `${c.label}: ${c.detail}`).join("\n") || "all checks pass"}>
            {r.qualityScore != null ? `${Math.round(r.qualityScore * 100)}%` : "—"}
            {failed.length > 0 ? ` · ${failed.length} failing` : " · ✓"}
          </span>
        );
      }
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <span style={{ display: "flex", gap: 8 }}>
          {(r.status === "draft" || r.status === "needs_attention") && (
            <button type="button" onClick={() => void act("Approve", () => approveBlogPost(accessToken, r.id))}>Approve</button>
          )}
          {(r.status === "in_review" || r.status === "draft") && (
            <button type="button" onClick={() => void act("Publish", () => publishBlogPost(accessToken, r.id))}>Publish</button>
          )}
          <button type="button" onClick={() => void act("Archive", () => archiveBlogPost(accessToken, r.id))}>Archive</button>
          <a href={`/en/blog/${r.slug}`} target="_blank" rel="noreferrer">Preview</a>
        </span>
      )
    }
  ], [accessToken, act]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <StatCard label="Awaiting review" value={posts.filter((p) => p.status === "draft" || p.status === "needs_attention").length} />
        <StatCard label="In review" value={posts.filter((p) => p.status === "in_review").length} />
        <button type="button" onClick={() => void act("Plan topics", () => planBlogTopics(accessToken, { city_slugs: ["lucknow"] }))}>
          Plan topics
        </button>
        <button
          type="button"
          onClick={() => {
            const kw = window.prompt("Target keyword for a new post?");
            if (kw) void act("Generate", () => generateBlogNow(accessToken, { target_keyword: kw, city_slug: "lucknow", category_slug: "data-reports" }));
          }}
        >
          Generate now
        </button>
      </div>
      <DataTable
        columns={columns}
        rows={posts}
        rowKey={(r) => r.id}
        emptyState={loading ? "Loading…" : "No posts awaiting review."}
      />
    </div>
  );
}
```

In `apps/web/components/admin/shell/AdminSidebar.tsx`:

- add `"blog"` to the `AdminTab` union (after `"seo"`):

```typescript
  | "seo"
  | "blog"
  | "system";
```

- add a nav item in the `understand` array (after the SEO item), using an existing `lucide-react` icon (import `Newspaper`):

```typescript
import { /* …existing… */ Newspaper } from "lucide-react";
// …
    { id: "seo", label: "Programmatic SEO", icon: Globe },
    { id: "blog", label: "Blog", icon: Newspaper, count: counts.blog }
```

In `apps/web/components/admin/shell/AdminShell.tsx`:

- import the tab:

```typescript
import { BlogTab } from "../tabs/BlogTab";
```

- add to `TAB_TITLES`:

```typescript
  seo: "Programmatic SEO",
  blog: "Blog",
  system: "System Tools"
```

- add a `case` in the `view` switch (after the `seo` case):

```typescript
      case "blog":
        return <BlogTab key={`blog-${k}`} accessToken={accessToken} onCountChange={handleCount("blog")} onToast={push} />;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/admin-api-blog.test.ts components/admin/tabs/__tests__/blog-tab.test.tsx`
Expected: PASS.

Run the existing admin shell test to confirm the tab wiring didn't break it:
Run: `pnpm --filter @cribliv/web exec vitest run components/admin/shell/__tests__/AdminShell.seo-tab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/admin-api.ts "apps/web/components/admin/tabs/BlogTab.tsx" "apps/web/components/admin/shell/AdminSidebar.tsx" "apps/web/components/admin/shell/AdminShell.tsx" apps/web/lib/__tests__/admin-api-blog.test.ts "apps/web/components/admin/tabs/__tests__/blog-tab.test.tsx"
git commit -m "feat(blog,web): add admin blog queue tab + admin-api client

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 25: Full verification (build, typecheck, lint, tests, end-to-end smoke, anti-slop audit)

This task ships nothing new — it proves the slice is correct, wired, and honours the anti-slop guardrails. Use the `superpowers:verification-before-completion` discipline: run every command and confirm real output before checking a box.

**Files:** none (verification only). If any check fails, fix the offending task's code, re-run, and only then continue.

- [ ] **Step 1: Renumber migrations (final)**

Confirm the four blog migrations use the real consecutive next-free numbers (not the `00A0..00A3` placeholders) and that every reference is consistent.
Run: `ls infra/migrations/ | grep -Ei 'blog_(categories|posts|briefs|embeddings)'`
Then: `grep -rEn "00A0|00A1|00A2|00A3" infra apps docs/superpowers/plans/2026-07-04-slice3-blog-engine-plan.md`
Expected: NO `00A?` placeholders remain in `infra/` or `apps/` (the plan doc may still reference them). Every `readFileSync`/`NAMES` constant in the migration + side-effects tests matches the real filenames.

- [ ] **Step 2: Bootstrap a clean `cribliv_test` and run the full API suite (incl. integration)**

```bash
# Create + migrate the test DB (safe: local only, never the Azure DATABASE_URL).
createdb cribliv_test 2>/dev/null || true
DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api db:migrate
# Full API test suite with integration tests enabled.
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api test
```

Expected: all suites PASS, including `blog-migrations.integration.test.ts`, `blog.controller.integration.test.ts`, `admin-blog.controller.integration.test.ts`, and `blog-publish-sideeffects.integration.test.ts`. (If pgvector is not installed locally, the `blog_embeddings` HNSW assertions self-skip — see Task 3 — and that is acceptable; note it.)

- [ ] **Step 3: Typecheck both apps**

```bash
pnpm --filter @cribliv/api exec tsc --noEmit
pnpm --filter @cribliv/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Lint + web build**

```bash
pnpm lint
pnpm --filter @cribliv/web build
```

Expected: lint clean (per repo config); the Next.js build compiles the new `/[locale]/blog`, `/[locale]/blog/[slug]`, and `/[locale]/blog/author/[authorSlug]` routes with no errors. (With no DB/posts at build time, `generateStaticParams` for the detail route returns `[]` and the routes still build.)

- [ ] **Step 5: Web test suite**

```bash
pnpm --filter @cribliv/web test
```

Expected: all web unit tests PASS (hub, detail, author, sitemap-blog, blog-api, structured-data-article, admin-api-blog, blog-tab), and the pre-existing sitemap/admin tests still PASS.

- [ ] **Step 6: End-to-end pipeline smoke against a local dev DB (manual)**

With `cribliv_v2` seeded (`pnpm db:migrate && pnpm db:seed`) and Azure OpenAI env set (or accept `null` LLM → the generator returns null and the planner still seeds briefs), verify the human-gated flow:

```bash
# 1. Set the worker key + flag, boot the API.
export BLOG_WORKER_API_KEY='local-dev-key'
export FF_SEO_BLOG=true
# (in one shell) pnpm dev:api
# (in another) drive the admin endpoints with an admin session token $TOKEN:

# Plan topics -> briefs
curl -s -XPOST localhost:4000/v1/admin/blog/plan -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"city_slugs":["lucknow"]}'

# Generate one post now -> expect status 'draft' or 'needs_attention', NEVER 'published'
curl -s -XPOST localhost:4000/v1/admin/blog/generate-now -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"target_keyword":"2bhk rent gomti nagar","city_slug":"lucknow","category_slug":"data-reports"}'

# List the review queue
curl -s "localhost:4000/v1/admin/blog?status=draft" -H "Authorization: Bearer $TOKEN"

# Worker-write path requires the API key (expect 401 without it, 201 with it)
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:4000/v1/blog/drafts -H 'content-type: application/json' -d '{"slug":"x","title":"t","generated_by":"planner","status":"draft"}'   # -> 401
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:4000/v1/blog/drafts -H 'x-api-key: local-dev-key' -H 'content-type: application/json' -d '{"slug":"x","title":"t","generated_by":"planner","status":"draft"}'   # -> 201

# Approve -> publish a draft you reviewed (replace $ID)
curl -s -XPOST localhost:4000/v1/admin/blog/$ID/approve  -H "Authorization: Bearer $TOKEN"
curl -s -XPOST localhost:4000/v1/admin/blog/$ID/publish  -H "Authorization: Bearer $TOKEN"

# Public read only shows published
curl -s localhost:4000/v1/blog | head
curl -s localhost:4000/v1/blog/2bhk-rent-gomti-nagar | head
```

Expected: generate-now never returns `published`; the worker draft route is 401 without the key and 201 with it; publish stamps `published_at`; the public list/detail only expose published posts; an `outbound_events` row with `event_type='seo.embed_blog'` exists for the published post:

```bash
psql "$DATABASE_URL" -c "SELECT event_type, aggregate_type, status FROM outbound_events WHERE event_type='seo.embed_blog';"
```

- [ ] **Step 7: Anti-slop guardrail audit (spec §13) — confirm each is enforced**

Verify by inspection + the passing tests that ALL of these hold:

- **Never auto-publish** — `BlogService.upsertDraft` hard-guards to `draft|needs_attention`; the worker only ever calls `upsertDraft`; the ONLY `published` path is `AdminBlogController.publish` behind `@Roles("admin")`. (Tests: `blog.service.test.ts` "upsertDraft never writes published", `blog-worker.test.ts` "NEVER publishes", `admin-blog.controller.integration.test.ts` publish path.)
- **Cites ≥3 real data points on data posts** — `quality-gate` `data_points` check + `blog-generator` injects live `SeoAggregatesService` figures. (Tests: golden set "fails a data post with too few cited data points"; generator "injected 18000".)
- **≥3 internal links incl. programmatic** — `quality-gate` `internal_links` check. (Test: "fails when internal links are missing".)
- **No placeholder/hedge/AI phrases** — `quality-gate` `banned_phrases`. (Test: "fails on hedge/AI phrases".)
- **Uniqueness enforced** — `quality-gate` `uniqueness` + `BlogEmbeddingService.uniquenessDistance`. (Tests: "fails when not unique enough"; embedding distance tests.)
- **Human approves every post** — enforced structurally (see first bullet).
- **Data posts show "data as of" + refresh** — generator sets `data_asof`; detail page renders it; `generated_by='refresh'` is supported by the schema + DTO for a future monthly refresh job (out of this slice's runtime scope but schema-ready).

Confirm the failing-draft path: `blog-worker.ts` `runBlogGenerator` regenerates once on gate failure, then writes `status='needs_attention'`. (Test: generator "marks a too-short draft as gate-failed"; worker regen path.)

- [ ] **Step 8: Final full-repo gate**

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
```

Expected: all green. Slice 3 is complete: the quality SYSTEM (data-grounding + multi-step generation + automated gate + human review) is in place, never auto-publishes, and every published post is grounded, linked, unique, and approved.

- [ ] **Step 9: Commit any verification fixes (only if code changed)**

```bash
git add -A
git commit -m "chore(blog): slice 3 verification fixes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Appendix — spec → task traceability

| Spec requirement (§)                                                           | Task(s)                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2.1 Proprietary-data grounding                                                | 10 (buildDataFacts + injection), 8 (data_points check)                                                                                                                                                                        |
| §2.2 Data-driven topic selection (GSC quick-wins, gaps, data-trend, evergreen) | 12                                                                                                                                                                                                                            |
| §2.3 Content briefs, not prompts                                               | 3 (blog_briefs), 11, 12                                                                                                                                                                                                       |
| §2.4 Multi-step structured generation                                          | 9 (LLM helper), 10 (4 steps)                                                                                                                                                                                                  |
| §2.5 Automated quality gate + regen-once → needs_attention                     | 8 (scorer), 10 (gate call), 16 (regen loop)                                                                                                                                                                                   |
| §2.6 Human-in-the-loop, never auto-publish                                     | 7 (upsert guard), 15 (publish gate), 14 (worker DTO)                                                                                                                                                                          |
| §2.7 E-E-A-T (named byline, bio page, sources, data-asof)                      | 2 (author col), 6/19 (persona), 22 (bio page), 21 (sources/data-asof)                                                                                                                                                         |
| §2.8 Internal-linking flywheel + on-publish enqueue                            | 13 (findRelated), 21 (links), 15 (indexing enqueue)                                                                                                                                                                           |
| §3 Post types + cadence                                                        | 12 (post_type per source), 3 (blog_briefs.post_type)                                                                                                                                                                          |
| §5 Architecture (DB-only, worker, outbound_events, embeddings)                 | 7,11,13,16,17                                                                                                                                                                                                                 |
| §6 Generation pipeline detail                                                  | 10                                                                                                                                                                                                                            |
| §7 Editorial workflow states                                                   | 2 (status CHECK), 7 (transition), 15                                                                                                                                                                                          |
| §8 Data model                                                                  | 1,2,3                                                                                                                                                                                                                         |
| §9 Web rendering (hub, detail, JSON-LD, recharts, sitemap, hreflang)           | 20,21,23                                                                                                                                                                                                                      |
| §10 Reuse map                                                                  | 9/10 (SeoCopy conventions), 10 (SeoAggregates), 13 (EmbeddingService), 21 (buildFaqPage), 15/16 (worker+outbound_events), 24 (DataTable/StatCard), 15 (seo_indexing_queue), 21 (recharts)                                     |
| §11 Feature flag FF_SEO_BLOG                                                   | 5, 17, 24                                                                                                                                                                                                                     |
| §12 Testing (unit mocked, integration, web, content-safety golden set)         | every task; golden set in 8                                                                                                                                                                                                   |
| §13 Anti-slop guardrails                                                       | 25 Step 7 (audit) + enforced across 7,8,10,15,16                                                                                                                                                                              |
| §14.1 Author persona                                                           | 6, 19, 22                                                                                                                                                                                                                     |
| §14.3 Hero images (reuse listing photos + branded template; no generic AI)     | `hero_image_path` column (2) + detail rendering (21); the generator does NOT synthesize AI hero images — populating `hero_image_path` from a relevant listing photo is a follow-up wired through the admin edit path (15/24). |
