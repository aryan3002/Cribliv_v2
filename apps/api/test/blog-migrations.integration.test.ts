import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");
const CATEGORIES = "0046_blog_categories";
const POSTS = "0047_blog_posts";
const BRIEFS = "0048_blog_briefs";
const EMBEDDINGS = "0049_blog_embeddings";
const LISTING_EMBEDDINGS_REPAIR = "0051_repair_listing_embeddings";
const BLOG_MIGRATION_TEST_LOCK = 30460049;

function sql(name: string): string {
  return readFileSync(join(MIG, `${name}.sql`), "utf8");
}

function rollback(name: string): string {
  return readFileSync(join(MIG, `${name}.rollback.sql`), "utf8");
}

async function cleanBlogTables(client: Client): Promise<void> {
  await client.query(rollback(EMBEDDINGS)).catch(() => undefined);
  await client.query(rollback(BRIEFS)).catch(() => undefined);
  await client.query(rollback(POSTS)).catch(() => undefined);
  await client.query(rollback(CATEGORIES)).catch(() => undefined);
}

async function lockBlogMigrations(client: Client): Promise<void> {
  await client.query(`SELECT pg_advisory_lock($1)`, [BLOG_MIGRATION_TEST_LOCK]);
}

async function unlockBlogMigrations(client: Client): Promise<void> {
  await client.query(`SELECT pg_advisory_unlock($1)`, [BLOG_MIGRATION_TEST_LOCK]);
}

describe.runIf(!!TEST_DB)("blog migrations", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await lockBlogMigrations(client);
    await cleanBlogTables(client);
    await client.query(sql(CATEGORIES));
  });

  afterAll(async () => {
    await cleanBlogTables(client);
    await unlockBlogMigrations(client);
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

describe.runIf(!!TEST_DB)("blog_posts migration", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await lockBlogMigrations(client);
    await cleanBlogTables(client);
    await client.query(sql(CATEGORIES));
    await client.query(sql(POSTS));
  });

  afterAll(async () => {
    await cleanBlogTables(client);
    await unlockBlogMigrations(client);
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

    const catId = (await client.query(`SELECT id FROM blog_categories LIMIT 1`)).rows[0].id;
    const bad = client.query(
      `INSERT INTO blog_posts (slug, title, category_id, status)
       VALUES ('x', 'X', $1, 'bogus')`,
      [catId]
    );
    await expect(bad).rejects.toThrow();

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

describe.runIf(!!TEST_DB)("blog_briefs migration", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await lockBlogMigrations(client);
    await cleanBlogTables(client);
    await client.query(sql(BRIEFS));
  });

  afterAll(async () => {
    await cleanBlogTables(client);
    await unlockBlogMigrations(client);
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
    await lockBlogMigrations(client);
    await cleanBlogTables(client);
    await client.query(sql(CATEGORIES));
    await client.query(sql(POSTS));
    await client.query(sql(EMBEDDINGS));
  });

  afterAll(async () => {
    await cleanBlogTables(client);
    await unlockBlogMigrations(client);
    await client.end();
  });

  it("creates blog_embeddings keyed by blog_post_id when pgvector is present", async () => {
    const hasVector = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`);
    if (hasVector.rowCount === 0) return;

    const tbl = await client.query(`SELECT to_regclass('public.blog_embeddings') AS t`);
    expect(tbl.rows[0].t).toBe("blog_embeddings");

    const idx = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'blog_embeddings'`
    );
    expect(idx.rows.map((r) => r.indexdef).join(" ")).toMatch(/hnsw/i);
  });
});

describe("listing_embeddings repair migration", () => {
  it("installs pgvector and recreates the listing embedding table/index when 0006 was already recorded", () => {
    const migration = sql(LISTING_EMBEDDINGS_REPAIR);

    expect(migration).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS listing_embeddings/i);
    expect(migration).toMatch(/embedding\s+vector\(1536\)/i);
    expect(migration).toMatch(/idx_listing_embeddings_hnsw/i);
    expect(migration).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/i);
  });
});
