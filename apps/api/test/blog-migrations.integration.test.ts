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
