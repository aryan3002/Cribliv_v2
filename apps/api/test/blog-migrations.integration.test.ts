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
