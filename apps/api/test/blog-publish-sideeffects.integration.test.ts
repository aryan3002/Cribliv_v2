import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { BlogService } from "../src/modules/blog/blog.service";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");
const NAMES = [
  "0046_blog_categories",
  "0047_blog_posts",
  "0048_blog_briefs",
  "0049_blog_embeddings"
];
const BLOG_MIGRATION_TEST_LOCK = 30460049;

function migration(name: string): string {
  return readFileSync(join(MIG, `${name}.sql`), "utf8");
}

function rollback(name: string): string {
  return readFileSync(join(MIG, `${name}.rollback.sql`), "utf8");
}

async function cleanBlogTables(client: Client): Promise<void> {
  for (const name of [...NAMES].reverse()) {
    await client.query(rollback(name)).catch(() => undefined);
  }
}

describe.runIf(!!TEST_DB)("blog publish side-effects", () => {
  let client: Client;
  let blog: BlogService;

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(`SELECT pg_advisory_lock($1)`, [BLOG_MIGRATION_TEST_LOCK]);
    await cleanBlogTables(client);
    for (const name of NAMES) {
      await client.query(migration(name));
    }
    blog = new BlogService({
      isEnabled: () => true,
      query: (text, params) => client.query(text, params)
    } as never);
  });

  afterAll(async () => {
    if (client) {
      await cleanBlogTables(client);
      await client.query(`SELECT pg_advisory_unlock($1)`, [BLOG_MIGRATION_TEST_LOCK]);
      await client.end();
    }
  });

  it("transition to published stamps published_at", async () => {
    const catId = (await client.query(`SELECT id FROM blog_categories WHERE slug = 'data-reports'`))
      .rows[0].id;
    const inserted = await client.query(
      `INSERT INTO blog_posts (slug, title, category_id, status, generated_by, target_keyword, body_en)
       VALUES ('pub-test', 'Pub test', $1, 'in_review', 'planner', 'k', '<p>x</p>')
       RETURNING id::text`,
      [catId]
    );

    const row = await blog.transition(inserted.rows[0].id, "published");
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
    await enqueue();

    const count = await client.query(
      `SELECT COUNT(*)::int AS n FROM outbound_events WHERE dedupe_key = $1`,
      [`blog_embed:${id}`]
    );
    expect(count.rows[0].n).toBe(1);
  });
});
