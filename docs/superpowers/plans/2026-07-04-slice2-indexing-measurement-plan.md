# Slice 2 — Indexing + Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build (behind flags, all Google calls mocked in tests) the layer that submits new/enabled Cribliv URLs to Google fast via the Indexing API and polls Google Search Console weekly for rank/impression data, surfaced to admins in a "Search Performance" tab, so slice 3 and beyond are aimed by real query data instead of guesses.

**Architecture:** Two new standalone-worker jobs (`indexing_submitter` every ~15 min, `gsc_poller` weekly) reuse the existing `apps/api/src/worker/worker.ts` `setInterval` pattern and DB pooling; a shared `GoogleServiceAuth` helper mints/caches an OAuth2 token from a service-account JWT (signed with Node's built-in `crypto`, no new dependency) for both jobs. Enqueue paths write to a new `seo_indexing_queue` table via a new `outbound_events` handler (`seo.queue_indexing`) plus direct calls from `SeoCityConfigService.setEnabled(true)`; the GSC poller upserts `keyword_rankings`. A new DB-only `SeoSearchService` + `AdminSeoSearchController` (`@Roles("admin")`, audited) exposes both tables to a new web admin "Search Performance" tab that reuses `DataTable`/`StatCard` exactly like `SeoProgrammaticPages.tsx`.

**Tech Stack:** NestJS, Postgres, standalone worker, Google Search Console + Indexing APIs, Next.js 14.2.13 admin, Vitest.

## Global Constraints

- DB-only SEO services: every new service checks `DatabaseService.isEnabled()` and returns safe empty/no-op values when false — no `AppStateService` fallback, per the slice-1 `SeoCityConfigService` pattern.
- Migrations are raw SQL under `infra/migrations/`, each forward file paired with a `.rollback.sql`; **confirm the next free number at build time** by running `ls infra/migrations | sort | tail -5` — do not hardcode a number from this plan or the spec (master is at `0043`, this checkout's branch already has `0044`; treat `0045` as this plan's working assumption only, verify before writing).
- Admin routes: `@Controller("admin/seo/...")`, `@UseGuards(AuthGuard, RolesGuard)`, `@Roles("admin")`, every mutation writes an audited row to `admin_actions` (best-effort `.catch(() => undefined)`, matching `AdminSeoController.toggleCity`).
- Feature flags `FF_SEO_INDEXING` and `FF_SEO_GSC` default **OFF**; follow the exact `readFeatureFlags()` / `parseBooleanEnv` pattern in `apps/api/src/config/feature-flags.ts` — never inline env reads elsewhere.
- All Google HTTP calls (`oauth2.googleapis.com`, `searchconsole.googleapis.com`, `indexing.googleapis.com`) are mocked in every test via `vi.stubGlobal("fetch", ...)` or injected fetch — **no live Google calls in any test, ever**.
- DB-safety: never run `db:migrate` / `db:seed` / integration tests against the default Azure `DATABASE_URL`. Local dev/test always overrides to `postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2` (dev) or `cribliv_test` (integration, via `TEST_DATABASE_URL`).
- Worker jobs never throw out of the `setInterval` callback — every job body is wrapped in `try/catch`, logs via `console.error(JSON.stringify({...}))`, and continues the next tick, matching every existing job in `worker.ts`.
- Keep all new/edited files plain UTF-8, no BOM, no smart quotes.

---

## Task 0: Confirm the next free migration number

**Files:** none (verification only, informs every later task's file names)
**Interfaces:** Consumes: `infra/migrations/` directory listing. Produces: the two-digit migration number `NNNN` used by Task 1 (e.g. `0045`) — write it down before continuing.

- [ ] Run `ls /Users/aryantripathi/Developer/Cribliv_v2-master/infra/migrations | sort | grep -E '^[0-9]{4}_' | tail -5` and note the highest number present.
- [ ] Add 1 to get the next free number `NNNN` (zero-padded to 4 digits). At the time this plan was written the working checkout was at `0044`, making `0045` the expected value — but the branch this plan lands on may differ (parallel work may have advanced it further). **Use whatever `ls` actually reports, not the number written here.**
- [ ] Confirm no file named `infra/migrations/<NNNN>_*.sql` already exists: `ls infra/migrations/<NNNN>_* 2>/dev/null` must print nothing.
- [ ] Substitute `<NNNN>` literally into every file path in Task 1 below before creating files. Do not proceed to Task 1 until this number is fixed.

---

## Task 1: Migration — `seo_indexing_queue` + `keyword_rankings`

**Files:**

- Create: `infra/migrations/<NNNN>_seo_indexing_measurement.sql`
- Create: `infra/migrations/<NNNN>_seo_indexing_measurement.rollback.sql`
- Test: `apps/api/test/migration-<NNNN>-seo-indexing-measurement.integration.test.ts`

**Interfaces:**

- Produces: table `seo_indexing_queue(id uuid PK, url text UNIQUE NOT NULL, status text CHECK IN ('pending','submitted','failed','skipped'), reason text, attempts int DEFAULT 0, submitted_at timestamptz, response jsonb, created_at timestamptz, updated_at timestamptz)` with partial index `idx_seo_indexing_queue_pending` on `status='pending'`.
- Produces: table `keyword_rankings(id bigserial PK, keyword text NOT NULL, page text NOT NULL, locale text NOT NULL, city_slug text NULL, position numeric, impressions int, clicks int, ctr numeric, source text DEFAULT 'gsc', captured_at date NOT NULL, is_target bool DEFAULT false, is_ignored bool DEFAULT false)` with unique index on `(keyword, page, locale, captured_at)`, index on `(position)`, index on `(city_slug)`.
- Produces: new `admin_target_type` enum value `'seo_indexing_queue'`, new `admin_action_type` enum values `'submit_indexing_url'`, `'retry_indexing_url'` (consumed by Task 8's audit rows).
- Consumed by: Task 3 (`IndexingService` reads/writes `seo_indexing_queue`), Task 5 (`GscService` upserts `keyword_rankings`), Task 7 (`SeoSearchService` reads both).

Steps:

- [ ] Confirm `<NNNN>` from Task 0 is fixed (e.g. `0045`). All commands below use that literal number.
- [ ] Write the failing integration test first at `apps/api/test/migration-<NNNN>-seo-indexing-measurement.integration.test.ts`:

  ```ts
  import { describe, it, expect, beforeAll, afterAll } from "vitest";
  import { readFileSync } from "node:fs";
  import { join } from "node:path";
  import { Client } from "pg";

  const TEST_DB = process.env.TEST_DATABASE_URL;
  const MIG = join(__dirname, "../../../infra/migrations");
  const FILE = "0045_seo_indexing_measurement.sql";
  const ROLLBACK_FILE = "0045_seo_indexing_measurement.rollback.sql";

  describe.runIf(!!TEST_DB)("migration 0045_seo_indexing_measurement", () => {
    let client: Client;
    beforeAll(async () => {
      client = new Client({ connectionString: TEST_DB! });
      await client.connect();
      await client.query(readFileSync(join(MIG, FILE), "utf8"));
    });
    afterAll(async () => {
      await client.query(readFileSync(join(MIG, ROLLBACK_FILE), "utf8"));
      await client.end();
    });

    it("creates seo_indexing_queue with a unique url and a status check constraint", async () => {
      const cols = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns WHERE table_name = 'seo_indexing_queue' ORDER BY column_name`);
      const by = Object.fromEntries(cols.rows.map((c) => [c.column_name, c]));
      expect(by.url.is_nullable).toBe("NO");
      expect(by.status.column_default).toContain("pending");
      expect(by.attempts.column_default).toContain("0");
      expect(by.created_at.is_nullable).toBe("NO");
      expect(by.updated_at.is_nullable).toBe("NO");

      const uniq = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'seo_indexing_queue'::regclass AND contype = 'u'`);
      expect(uniq.rowCount).toBeGreaterThanOrEqual(1);

      const chk = await client.query(`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'seo_indexing_queue'::regclass AND contype = 'c'`);
      expect(chk.rows.some((r) => /status/.test(r.def))).toBe(true);
    });

    it("creates the partial pending index on seo_indexing_queue", async () => {
      const r = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_seo_indexing_queue_pending'`
      );
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].indexdef).toContain("WHERE");
      expect(r.rows[0].indexdef).toContain("pending");
    });

    it("upserts on url and re-queues on conflict (ON CONFLICT DO UPDATE)", async () => {
      await client.query(
        `INSERT INTO seo_indexing_queue(url, reason) VALUES ('https://cribliv.com/a', 'new_listing')`
      );
      await client.query(
        `INSERT INTO seo_indexing_queue(url, reason, status)
         VALUES ('https://cribliv.com/a', 'content_changed', 'pending')
         ON CONFLICT (url) DO UPDATE SET reason = EXCLUDED.reason, status = 'pending', updated_at = now()`
      );
      const r = await client.query(
        `SELECT reason, status FROM seo_indexing_queue WHERE url = 'https://cribliv.com/a'`
      );
      expect(r.rowCount).toBe(1);
      expect(r.rows[0].reason).toBe("content_changed");
      await client.query(`DELETE FROM seo_indexing_queue WHERE url = 'https://cribliv.com/a'`);
    });

    it("creates keyword_rankings with the (keyword, page, locale, captured_at) unique key", async () => {
      const cols = await client.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns WHERE table_name = 'keyword_rankings' ORDER BY column_name`);
      const by = Object.fromEntries(cols.rows.map((c) => [c.column_name, c]));
      expect(by.keyword.is_nullable).toBe("NO");
      expect(by.page.is_nullable).toBe("NO");
      expect(by.locale.is_nullable).toBe("NO");
      expect(by.captured_at.data_type).toBe("date");
      expect(by.city_slug.is_nullable).toBe("YES");

      const uniq = await client.query(`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'keyword_rankings' AND indexdef ILIKE '%UNIQUE%'`);
      expect(uniq.rowCount).toBe(1);
      expect(uniq.rows[0].indexdef).toContain("keyword");
      expect(uniq.rows[0].indexdef).toContain("page");
      expect(uniq.rows[0].indexdef).toContain("locale");
      expect(uniq.rows[0].indexdef).toContain("captured_at");
    });

    it("idempotently upserts keyword_rankings per captured_at (re-poll updates the day's row)", async () => {
      await client.query(
        `INSERT INTO keyword_rankings(keyword, page, locale, position, impressions, clicks, ctr, captured_at)
         VALUES ('2bhk noida', '/en/city/noida', 'en', 14, 100, 5, 0.05, '2026-07-06')`
      );
      await client.query(
        `INSERT INTO keyword_rankings(keyword, page, locale, position, impressions, clicks, ctr, captured_at)
         VALUES ('2bhk noida', '/en/city/noida', 'en', 12, 140, 9, 0.064, '2026-07-06')
         ON CONFLICT (keyword, page, locale, captured_at)
         DO UPDATE SET position = EXCLUDED.position, impressions = EXCLUDED.impressions,
                        clicks = EXCLUDED.clicks, ctr = EXCLUDED.ctr`
      );
      const r = await client.query(
        `SELECT position, impressions FROM keyword_rankings
         WHERE keyword = '2bhk noida' AND page = '/en/city/noida' AND locale = 'en' AND captured_at = '2026-07-06'`
      );
      expect(r.rowCount).toBe(1);
      expect(Number(r.rows[0].position)).toBe(12);
      expect(r.rows[0].impressions).toBe(140);
      await client.query(`DELETE FROM keyword_rankings WHERE keyword = '2bhk noida'`);
    });

    it("creates the position index and the city_slug index on keyword_rankings", async () => {
      const idx = await client.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'keyword_rankings'`
      );
      const names = idx.rows.map((r) => r.indexname);
      expect(names).toContain("idx_keyword_rankings_position");
      expect(names).toContain("idx_keyword_rankings_city_slug");
    });

    it("adds the admin enum values used by the audited indexing endpoints", async () => {
      const tgt = await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'admin_target_type' AND e.enumlabel = 'seo_indexing_queue'`);
      const submit =
        await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'submit_indexing_url'`);
      const retry =
        await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'retry_indexing_url'`);
      expect(tgt.rowCount).toBe(1);
      expect(submit.rowCount).toBe(1);
      expect(retry.rowCount).toBe(1);
    });

    it("is idempotent (re-applying the forward migration does not error)", async () => {
      await expect(client.query(readFileSync(join(MIG, FILE), "utf8"))).resolves.toBeDefined();
    });
  });
  ```

- [ ] Run it and confirm it fails because the migration file does not exist yet:
      `cd /Users/aryantripathi/Developer/Cribliv_v2-master && docker compose -f infra/docker-compose.yml up -d && createdb -h 127.0.0.1 -U postgres cribliv_test 2>/dev/null; TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/migration-0045-seo-indexing-measurement.integration.test.ts`
      Expected: `ENOENT: no such file or directory, open '.../infra/migrations/0045_seo_indexing_measurement.sql'`.
- [ ] Write `infra/migrations/0045_seo_indexing_measurement.sql`:

  ```sql
  -- Migration 0045: SEO indexing + measurement (Slice 2).
  -- seo_indexing_queue: URLs to submit to Google's Indexing API (fast discovery
  -- only — the sitemap remains the durable source of truth). Upsert-on-url so a
  -- re-enqueue (content changed) re-queues instead of duplicating rows.
  -- keyword_rankings: weekly snapshot from GSC searchanalytics.query, keyed so a
  -- re-poll for the same day updates in place (idempotent per captured_at).

  CREATE TABLE IF NOT EXISTS seo_indexing_queue (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    url           text NOT NULL,
    status        text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'submitted', 'failed', 'skipped')),
    reason        text,
    attempts      int NOT NULL DEFAULT 0,
    submitted_at  timestamptz,
    response      jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (url)
  );

  CREATE INDEX IF NOT EXISTS idx_seo_indexing_queue_pending
    ON seo_indexing_queue (created_at)
    WHERE status = 'pending';

  CREATE OR REPLACE FUNCTION seo_indexing_queue_touch_updated_at() RETURNS trigger AS $$
  BEGIN
    NEW.updated_at := now();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP TRIGGER IF EXISTS trg_seo_indexing_queue_touch ON seo_indexing_queue;
  CREATE TRIGGER trg_seo_indexing_queue_touch
    BEFORE UPDATE ON seo_indexing_queue
    FOR EACH ROW EXECUTE FUNCTION seo_indexing_queue_touch_updated_at();

  CREATE TABLE IF NOT EXISTS keyword_rankings (
    id           bigserial PRIMARY KEY,
    keyword      text NOT NULL,
    page         text NOT NULL,
    locale       text NOT NULL,
    city_slug    text,
    position     numeric,
    impressions  int,
    clicks       int,
    ctr          numeric,
    source       text NOT NULL DEFAULT 'gsc',
    captured_at  date NOT NULL,
    is_target    boolean NOT NULL DEFAULT false,
    is_ignored   boolean NOT NULL DEFAULT false,
    UNIQUE (keyword, page, locale, captured_at)
  );

  CREATE INDEX IF NOT EXISTS idx_keyword_rankings_position
    ON keyword_rankings (position);

  CREATE INDEX IF NOT EXISTS idx_keyword_rankings_city_slug
    ON keyword_rankings (city_slug);

  -- Admin audit vocabulary for the indexing-queue endpoints (manual submit +
  -- retry). ADD VALUE is safe here — run-migrations.js wraps each file in its
  -- own txn and the API only casts to these values after this file commits.
  ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'seo_indexing_queue';
  ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'submit_indexing_url';
  ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'retry_indexing_url';
  ```

- [ ] Write `infra/migrations/0045_seo_indexing_measurement.rollback.sql`:
  ```sql
  -- Rollback for 0045_seo_indexing_measurement.sql
  -- NOTE: Postgres cannot remove enum values, so 'seo_indexing_queue' /
  -- 'submit_indexing_url' / 'retry_indexing_url' remain on the admin enums
  -- after rollback. This is safe (unused) and accepted, matching 0043's note.
  DROP TRIGGER IF EXISTS trg_seo_indexing_queue_touch ON seo_indexing_queue;
  DROP FUNCTION IF EXISTS seo_indexing_queue_touch_updated_at();
  DROP INDEX IF EXISTS idx_seo_indexing_queue_pending;
  DROP TABLE IF EXISTS seo_indexing_queue;
  DROP INDEX IF EXISTS idx_keyword_rankings_position;
  DROP INDEX IF EXISTS idx_keyword_rankings_city_slug;
  DROP TABLE IF EXISTS keyword_rankings;
  ```
- [ ] Run the test again and confirm it passes:
      `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/migration-0045-seo-indexing-measurement.integration.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  8 passed (8)`.
- [ ] Apply it to local dev DB too (so later tasks' services can be smoke-tested against `cribliv_v2`):
      `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2' node infra/migrations/run-migrations.js`
      Expected output includes: `Applied 0045_seo_indexing_measurement.sql`.
- [ ] Commit:

  ```
  git add infra/migrations/0045_seo_indexing_measurement.sql infra/migrations/0045_seo_indexing_measurement.rollback.sql apps/api/test/migration-0045-seo-indexing-measurement.integration.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add seo_indexing_queue + keyword_rankings migration (slice 2)

  Lays the DB foundation for Indexing-API submission and weekly GSC rank
  polling, paired with a rollback and integration test per repo convention.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2: `GoogleServiceAuth` — service-account JWT → cached OAuth2 token

**Files:**

- Create: `apps/api/src/modules/seo/google/google-service-auth.ts`
- Test: `apps/api/src/modules/seo/google/__tests__/google-service-auth.test.ts`

**Interfaces:**

- Produces: `class GoogleServiceAuth { constructor(fetchImpl?: typeof fetch); async getAccessToken(scopes: string[]): Promise<string>; }` — mints a signed JWT from `GSC_SERVICE_ACCOUNT_JSON`, POSTs it to `https://oauth2.googleapis.com/token`, caches the resulting `access_token` in-memory keyed by the sorted scopes string until 5 minutes before `expires_in` elapses.
- Consumes: env `GSC_SERVICE_ACCOUNT_JSON` (raw JSON string OR a filesystem path to a JSON file — try `JSON.parse` first, fall back to `readFileSync` + `JSON.parse` if that throws and the value looks like a path).
- Consumed by: Task 3 (`IndexingService`, scope `https://www.googleapis.com/auth/indexing`) and Task 5 (`GscService`, scope `https://www.googleapis.com/auth/webmasters.readonly`).

Steps:

- [ ] Write the failing unit test at `apps/api/src/modules/seo/google/__tests__/google-service-auth.test.ts`:

  ```ts
  import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
  import { GoogleServiceAuth } from "../google-service-auth";

  const FAKE_KEY = {
    type: "service_account",
    project_id: "cribliv-seo",
    private_key_id: "abc123",
    // A syntactically valid PKCS#8 RSA private key generated purely for this
    // test fixture (not a real credential). crypto.createSign only needs a
    // parseable PEM to exercise the signing code path; the mocked fetch below
    // never talks to a real Google endpoint that would verify the signature.
    private_key:
      "-----BEGIN PRIVATE KEY-----\n" +
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\n" +
      "MzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu\n" +
      "NMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCdPEovGhLa0VzMaQ8s+CLOyS56YyCFGeJZ\n" +
      "qgtzJ6GR3eqoYSW9b9UMvkBpZODSctWSNGj3P7jRFDO5VoTwCQAWbFnOjDfH5Ulg\n" +
      "p2PKSQnSJP3AJLQNFNe7br1XbrhV//eO+t51mIpGSDCUv3E0DDFcWDTH9cXDTTlR\n" +
      "ZVEiR2BwpZOOkE/Z0/BVnhZYL721itYuwEuY9RSmnGXGjBqzhskn3fV0aME21XFB\n" +
      "l87yWyR6AgMBAAECggEAB4wsz5S9SBHnJj0j2Ubx3RpcJz9SnYDBqW0LfLLRUS3q\n" +
      "8mLzRzOENfXW5xJKRvKZoYCLmr9Aq+Kj3IhV1BbHUXO1L4L1Vh4nY9RtV2Nl+SF3\n" +
      "u+HrfF+O1TKtF5nUL2sSw8OiGgxDx8bA3T0GaZ0X9WCCEXGnzY6R0TZlEwR+3Ncy\n" +
      "SdKZHhAWlSc0K1zNaEfBhK1r9wY0XKzY0hDkOyIzuRZ4b2v9wNwTL1w9RaJXtQMt\n" +
      "z+8OtSaX0m+8FhLtFm/rqSAkK/DrDPWScS6UunOd3PDOn6IzhZgVIn41BblT6uH9\n" +
      "6/z6X7pxZP1QDXxa5nCiLXWQ4gDXaZmPWfy+r0MCkQKBgQD3Zj7iZbmYlKq7t0nQ\n" +
      "3TCLl0y4d0h5oj6iP0G9jGflQ+8mSFHf6qJvFTOPaVQOswiy5jNZ48OTCzM4v+Z9\n" +
      "N6YRc4x+7NglTOWZjXKQmpP3EEGVh7dcQwZK9m+YFV9MFwrLGKfQpTXsHgAyRuUv\n" +
      "hj1jbiHnh1nUeXXOb2xKX6yPRQKBgQDBk8DzYqEXQfL6vqDdOFXaTPnMoypq3/EW\n" +
      "wLLGH+xEDPB2rTQOsHrpJqp4c9gyiZAV+bwrDQnwaZeYIrx8OZ5S0v7yiV1x1XkN\n" +
      "R7WhtAb0+Sc5FQ6/9GnT8kJZXW/CZ+X2XblT4tOzTJP2h0i1LKcTqAyq1cVoW1z9\n" +
      "0AjhqZzKlwKBgQDMDPNQduWnpU4Yl0OwsOEnR1U9C+iuFy5rIkOTr0XpMwzcCzHR\n" +
      "K91efQoyj2rWnW7ekaZlF6dEz+7L3fY8ejqRCXwSbHEjS1AeqTk49WluPHkNlY0K\n" +
      "OK8XecT2NqiFcv8fGm6c6DR6E5cGbn9laX0e8mYcnq1Xz9NIe9DzOEyx8QKBgFf5\n" +
      "3g3GvGZOZOe6PA9pOFmWq0YB9wG08cVUM1E4/gNjWFyUBqk9ynnpc5g2WcVLTU5C\n" +
      "6bxdyPYEqxE4M1Y3kW9jH5emhU4M42R7lm/wGmjTELsB6zXlU/UO0EMWr6oIQvXY\n" +
      "TzEeZjD/DhY+KgJZY0EhVXk3AGYXFOEtc+FvVjfLAoGAJvE6d1MZoLbF/DFvS20u\n" +
      "6nzsC1zLb0Q9RmYYQMwvVGvY0kdN9tPd6VJqEfMHqLxSWJ6Ta6P4CJn+0Xg9BjKt\n" +
      "kZLcUx24LGiF3rUp0FVspBpF8KTHOcW3l0Z9dJ0AqzP0z3paQwsWEG5nOgfKLu9C\n" +
      "wEWgOJyPzXcvzR2z+7pcaX0=\n" +
      "-----END PRIVATE KEY-----\n",
    client_email: "seo-worker@cribliv-seo.iam.gserviceaccount.com",
    client_id: "111222333444"
  };

  describe("GoogleServiceAuth", () => {
    const originalEnv = process.env.GSC_SERVICE_ACCOUNT_JSON;

    beforeEach(() => {
      process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_KEY);
    });

    afterEach(() => {
      if (originalEnv === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON;
      else process.env.GSC_SERVICE_ACCOUNT_JSON = originalEnv;
    });

    it("mints an access token by POSTing a signed JWT to the Google token endpoint", async () => {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe("https://oauth2.googleapis.com/token");
        expect(init?.method).toBe("POST");
        const body = new URLSearchParams(init?.body as string);
        expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
        expect(body.get("assertion")).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/); // header.payload.signature
        return {
          ok: true,
          json: async () => ({ access_token: "ya29.fake-token", expires_in: 3600 })
        } as Response;
      });

      const auth = new GoogleServiceAuth(fetchMock as unknown as typeof fetch);
      const token = await auth.getAccessToken(["https://www.googleapis.com/auth/indexing"]);

      expect(token).toBe("ya29.fake-token");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("caches the token for the same scopes and does not re-fetch until near expiry", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: "ya29.fake-token", expires_in: 3600 })
      })) as unknown as typeof fetch;

      const auth = new GoogleServiceAuth(fetchMock);
      const scopes = ["https://www.googleapis.com/auth/indexing"];

      await auth.getAccessToken(scopes);
      await auth.getAccessToken(scopes);
      await auth.getAccessToken(scopes);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("re-fetches for a different scope set (separate cache key)", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: "ya29.fake-token", expires_in: 3600 })
      })) as unknown as typeof fetch;

      const auth = new GoogleServiceAuth(fetchMock);
      await auth.getAccessToken(["https://www.googleapis.com/auth/indexing"]);
      await auth.getAccessToken(["https://www.googleapis.com/auth/webmasters.readonly"]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("throws a clear error when GSC_SERVICE_ACCOUNT_JSON is missing", async () => {
      delete process.env.GSC_SERVICE_ACCOUNT_JSON;
      const auth = new GoogleServiceAuth(vi.fn() as unknown as typeof fetch);

      await expect(auth.getAccessToken(["scope"])).rejects.toThrow(
        /GSC_SERVICE_ACCOUNT_JSON is not configured/
      );
    });

    it("throws when the token endpoint returns a non-OK response", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => "invalid_grant"
      })) as unknown as typeof fetch;

      const auth = new GoogleServiceAuth(fetchMock);

      await expect(
        auth.getAccessToken(["https://www.googleapis.com/auth/indexing"])
      ).rejects.toThrow(/token_status_401/);
    });
  });
  ```

- [ ] Run it and confirm it fails because the module does not exist:
      `cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run src/modules/seo/google/__tests__/google-service-auth.test.ts`
      Expected: `Cannot find module '../google-service-auth'`.
- [ ] Write `apps/api/src/modules/seo/google/google-service-auth.ts`:

  ```ts
  import { createSign } from "node:crypto";
  import { readFileSync } from "node:fs";

  interface ServiceAccountKey {
    client_email: string;
    private_key: string;
    private_key_id: string;
  }

  interface CachedToken {
    accessToken: string;
    expiresAtMs: number;
  }

  const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
  const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before real expiry

  function base64url(input: Buffer | string): string {
    const buf = typeof input === "string" ? Buffer.from(input) : input;
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /**
   * Mints OAuth2 access tokens for a Google service account using the
   * JWT-bearer grant (RFC 7523) — no google-auth-library dependency needed.
   * Signs a JWT with the service account's RSA private key (RS256) and
   * exchanges it at the token endpoint. Caches per sorted-scope-set until
   * ~5 min before expiry. Used by both IndexingService and GscService so the
   * two never mint separate tokens for overlapping calls.
   */
  export class GoogleServiceAuth {
    private readonly cache = new Map<string, CachedToken>();
    private readonly fetchImpl: typeof fetch;

    constructor(fetchImpl: typeof fetch = fetch) {
      this.fetchImpl = fetchImpl;
    }

    async getAccessToken(scopes: string[]): Promise<string> {
      const cacheKey = [...scopes].sort().join(" ");
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAtMs > Date.now()) {
        return cached.accessToken;
      }

      const key = this.loadServiceAccountKey();
      const assertion = this.signJwt(key, cacheKey);

      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      });

      const response = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Google token exchange failed: token_status_${response.status} ${detail}`);
      }

      const json = (await response.json()) as { access_token: string; expires_in: number };
      this.cache.set(cacheKey, {
        accessToken: json.access_token,
        expiresAtMs: Date.now() + json.expires_in * 1000 - EXPIRY_SAFETY_MARGIN_MS
      });

      return json.access_token;
    }

    private loadServiceAccountKey(): ServiceAccountKey {
      const raw = process.env.GSC_SERVICE_ACCOUNT_JSON;
      if (!raw) {
        throw new Error("GSC_SERVICE_ACCOUNT_JSON is not configured");
      }

      try {
        return JSON.parse(raw) as ServiceAccountKey;
      } catch {
        // Not raw JSON — try treating it as a path to a JSON key file.
        const fileContents = readFileSync(raw, "utf8");
        return JSON.parse(fileContents) as ServiceAccountKey;
      }
    }

    private signJwt(key: ServiceAccountKey, scope: string): string {
      const nowSec = Math.floor(Date.now() / 1000);
      const header = { alg: "RS256", typ: "JWT", kid: key.private_key_id };
      const payload = {
        iss: key.client_email,
        scope,
        aud: TOKEN_ENDPOINT,
        iat: nowSec,
        exp: nowSec + 3600
      };

      const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
      const signer = createSign("RSA-SHA256");
      signer.update(unsigned);
      signer.end();
      const signature = base64url(signer.sign(key.private_key));

      return `${unsigned}.${signature}`;
    }
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/google/__tests__/google-service-auth.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.
- [ ] Commit:

  ```
  git add apps/api/src/modules/seo/google/google-service-auth.ts apps/api/src/modules/seo/google/__tests__/google-service-auth.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add GoogleServiceAuth — service-account JWT to cached OAuth2 token

  Shared helper for the Indexing API + GSC pollers: signs a JWT with the
  service-account RSA key and exchanges it for a bearer token, cached per
  scope set. No google-auth-library dependency; uses node:crypto directly.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3: Feature flags `FF_SEO_INDEXING` + `FF_SEO_GSC`

**Files:**

- Modify: `apps/api/src/config/feature-flags.ts`
- Test: `apps/api/test/feature-flags.seo-slice2.test.ts`

**Interfaces:**

- Produces: `FeatureFlags.ff_seo_indexing: boolean`, `FeatureFlags.ff_seo_gsc: boolean`, both read via `parseBooleanEnv("FF_SEO_INDEXING", false)` / `parseBooleanEnv("FF_SEO_GSC", false)`, both `false` in `defaultFeatureFlags`.
- Consumed by: Task 4 (`IndexingService.enqueue` no-ops when off), Task 6 (worker `indexing_submitter` job skips when off), Task 7/8 (`GscService` + `gsc_poller` job skip when off).

Steps:

- [ ] Write the failing test at `apps/api/test/feature-flags.seo-slice2.test.ts`:

  ```ts
  import { afterEach, beforeEach, describe, expect, it } from "vitest";
  import { defaultFeatureFlags, readFeatureFlags } from "../src/config/feature-flags";

  describe("FF_SEO_INDEXING / FF_SEO_GSC", () => {
    const keys = ["FF_SEO_INDEXING", "FF_SEO_GSC"] as const;
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const k of keys) saved[k] = process.env[k];
    });
    afterEach(() => {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it("default OFF for both flags", () => {
      expect(defaultFeatureFlags.ff_seo_indexing).toBe(false);
      expect(defaultFeatureFlags.ff_seo_gsc).toBe(false);
      delete process.env.FF_SEO_INDEXING;
      delete process.env.FF_SEO_GSC;
      const flags = readFeatureFlags();
      expect(flags.ff_seo_indexing).toBe(false);
      expect(flags.ff_seo_gsc).toBe(false);
    });

    it("flips on via env var", () => {
      process.env.FF_SEO_INDEXING = "true";
      process.env.FF_SEO_GSC = "1";
      const flags = readFeatureFlags();
      expect(flags.ff_seo_indexing).toBe(true);
      expect(flags.ff_seo_gsc).toBe(true);
    });

    it("treats 'false'/'0'/'off' as off even if set", () => {
      process.env.FF_SEO_INDEXING = "false";
      process.env.FF_SEO_GSC = "off";
      const flags = readFeatureFlags();
      expect(flags.ff_seo_indexing).toBe(false);
      expect(flags.ff_seo_gsc).toBe(false);
    });
  });
  ```

- [ ] Run it and confirm it fails:
      `pnpm --filter @cribliv/api exec vitest run test/feature-flags.seo-slice2.test.ts`
      Expected: `TypeError: Cannot read properties of undefined` or a type error on `ff_seo_indexing` (property does not exist on the returned object).
- [ ] Add the two flags to the `FeatureFlags` interface in `apps/api/src/config/feature-flags.ts`, appending after `ff_programmatic_seo_cities_enabled: boolean;`:
  ```ts
  ff_programmatic_seo_cities_enabled: boolean;
  /** Slice 2 – Indexing + Measurement (default OFF; flip at v1→v2 cutover) */
  ff_seo_indexing: boolean;
  ff_seo_gsc: boolean;
  ```
- [ ] Add both to `defaultFeatureFlags`, appending after `ff_programmatic_seo_cities_enabled: true`:
  ```ts
  ff_programmatic_seo_cities_enabled: true,
  ff_seo_indexing: false,
  ff_seo_gsc: false
  ```
- [ ] Add both to `readFeatureFlags()`'s returned object, appending after the `ff_programmatic_seo_cities_enabled` entry:
  ```ts
  ff_programmatic_seo_cities_enabled: parseBooleanEnv(
    "FF_PROGRAMMATIC_SEO_CITIES_ENABLED",
    defaultFeatureFlags.ff_programmatic_seo_cities_enabled
  ),
  ff_seo_indexing: parseBooleanEnv("FF_SEO_INDEXING", defaultFeatureFlags.ff_seo_indexing),
  ff_seo_gsc: parseBooleanEnv("FF_SEO_GSC", defaultFeatureFlags.ff_seo_gsc)
  ```
- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run test/feature-flags.seo-slice2.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  3 passed (3)`.
- [ ] Run the full existing feature-flags-adjacent suite to confirm nothing else broke:
      `pnpm --filter @cribliv/api exec vitest run test/ --reporter=dot 2>&1 | tail -20`
      Expected: no new failures (pre-existing quarantined suites aside, per `vitest.config.ts`'s `CI` exclude list).
- [ ] Add both vars, commented, to `.env.example` right after the `FF_PROGRAMMATIC_SEO_CITIES_ENABLED`-adjacent block (find it with `grep -n FF_PROGRAMMATIC .env.example` first, insert below whatever else is near the SEO flags):
  ```
  # Slice 2 – Indexing + Measurement (default OFF; flip at v1->v2 cutover)
  FF_SEO_INDEXING=false
  FF_SEO_GSC=false
  GSC_SITE_URL=sc-domain:cribliv.com
  GSC_SERVICE_ACCOUNT_JSON=
  GOOGLE_INDEXING_DAILY_QUOTA=200
  ```
- [ ] Commit:

  ```
  git add apps/api/src/config/feature-flags.ts apps/api/test/feature-flags.seo-slice2.test.ts .env.example
  git commit -m "$(cat <<'EOF'
  feat(seo): add FF_SEO_INDEXING + FF_SEO_GSC flags (default off)

  Both default off; flipped on at the v1->v2 cutover per the slice-2 runbook.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4: `IndexingService` — enqueue + drain-to-Google logic

**Files:**

- Create: `apps/api/src/modules/seo/indexing.service.ts`
- Test: `apps/api/src/modules/seo/__tests__/indexing.service.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface SeoIndexingQueueRow {
    id: string;
    url: string;
    status: "pending" | "submitted" | "failed" | "skipped";
    reason: string | null;
    attempts: number;
    submitted_at: string | null;
    response: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  }

  export class IndexingService {
    constructor(database: DatabaseService, auth: GoogleServiceAuth, fetchImpl?: typeof fetch);
    async enqueue(url: string, reason: string): Promise<SeoIndexingQueueRow | null>;
    async drainPending(
      quota: number,
      submittedToday: number
    ): Promise<{ submitted: number; failed: number; skippedQuota: number }>;
    async submittedCountToday(): Promise<number>;
    async listQueue(params: {
      status?: string;
      limit?: number;
      offset?: number;
    }): Promise<{ items: SeoIndexingQueueRow[]; total: number }>;
    async retry(id: string): Promise<SeoIndexingQueueRow | null>;
  }
  ```

- Consumes: `DatabaseService` (SEO's DB-only pattern), `GoogleServiceAuth.getAccessToken(["https://www.googleapis.com/auth/indexing"])`, env `GOOGLE_INDEXING_DAILY_QUOTA` (read by the caller, passed in as `quota` — the service itself is quota-agnostic so tests can control it directly), flag `FF_SEO_INDEXING` (checked inside `drainPending`; `enqueue` always writes regardless of the flag so nothing is lost while the flag is off — draining is what's gated).
- Consumed by: Task 5 (outbound_events handler + `SeoCityConfigService.setEnabled` call `enqueue`), Task 6 (worker job calls `drainPending` + `submittedCountToday`), Task 9 (`SeoSearchService` composes `listQueue`), Task 10 (admin controller calls `enqueue`/`retry`/`listQueue` directly).
- Max backoff: after `attempts >= 5`, a failed submission stops retrying automatically and stays `status='failed'` (visible to admin for manual retry) — this cap lives inside `drainPending`'s failure branch.

Steps:

- [ ] Write the failing unit test at `apps/api/src/modules/seo/__tests__/indexing.service.test.ts`:

  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest";
  import { IndexingService } from "../indexing.service";

  describe("IndexingService", () => {
    let query: ReturnType<typeof vi.fn>;
    let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
    let auth: { getAccessToken: ReturnType<typeof vi.fn> };
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      query = vi.fn();
      database = { isEnabled: () => true, query };
      auth = { getAccessToken: vi.fn(async () => "ya29.fake") };
      fetchMock = vi.fn();
    });

    describe("enqueue", () => {
      it("no-ops without querying when DB is disabled", async () => {
        database = { isEnabled: () => false, query };
        const service = new IndexingService(database as never, auth as never, fetchMock as never);

        await expect(service.enqueue("https://cribliv.com/a", "new_listing")).resolves.toBeNull();
        expect(query).not.toHaveBeenCalled();
      });

      it("upserts by url, re-queuing to pending on conflict", async () => {
        const row = {
          id: "q1",
          url: "https://cribliv.com/a",
          status: "pending",
          reason: "new_listing",
          attempts: 0,
          submitted_at: null,
          response: null,
          created_at: "2026-07-06T00:00:00.000Z",
          updated_at: "2026-07-06T00:00:00.000Z"
        };
        query.mockResolvedValueOnce({ rows: [row] });
        const service = new IndexingService(database as never, auth as never, fetchMock as never);

        await expect(service.enqueue("https://cribliv.com/a", "new_listing")).resolves.toEqual(row);

        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain("INSERT INTO seo_indexing_queue");
        expect(sql).toContain("ON CONFLICT (url) DO UPDATE");
        expect(sql).toContain("status = 'pending'");
        expect(params).toEqual(["https://cribliv.com/a", "new_listing"]);
      });
    });

    describe("drainPending", () => {
      it("does nothing when FF_SEO_INDEXING is off", async () => {
        const original = process.env.FF_SEO_INDEXING;
        process.env.FF_SEO_INDEXING = "false";
        try {
          const service = new IndexingService(database as never, auth as never, fetchMock as never);
          await expect(service.drainPending(200, 0)).resolves.toEqual({
            submitted: 0,
            failed: 0,
            skippedQuota: 0
          });
          expect(query).not.toHaveBeenCalled();
          expect(fetchMock).not.toHaveBeenCalled();
        } finally {
          if (original === undefined) delete process.env.FF_SEO_INDEXING;
          else process.env.FF_SEO_INDEXING = original;
        }
      });

      it("submits pending rows up to the remaining quota, newest first, and marks them submitted", async () => {
        process.env.FF_SEO_INDEXING = "true";
        const pendingRows = [
          { id: "q1", url: "https://cribliv.com/a", attempts: 0 },
          { id: "q2", url: "https://cribliv.com/b", attempts: 0 }
        ];
        query
          .mockResolvedValueOnce({ rows: pendingRows }) // SELECT pending
          .mockResolvedValueOnce({ rows: [] }) // UPDATE q1 submitted
          .mockResolvedValueOnce({ rows: [] }); // UPDATE q2 submitted
        fetchMock
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ urlNotificationMetadata: { url: "https://cribliv.com/a" } })
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ urlNotificationMetadata: { url: "https://cribliv.com/b" } })
          });

        const service = new IndexingService(database as never, auth as never, fetchMock as never);
        const result = await service.drainPending(200, 0);

        expect(result).toEqual({ submitted: 2, failed: 0, skippedQuota: 0 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://indexing.googleapis.com/v3/urlNotifications:publish");
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBe("Bearer ya29.fake");
        expect(JSON.parse(init.body)).toEqual({
          url: "https://cribliv.com/a",
          type: "URL_UPDATED"
        });

        const [updateSql, updateParams] = query.mock.calls[1];
        expect(updateSql).toContain("SET status = 'submitted'");
        expect(updateParams[0]).toBe("q1");

        delete process.env.FF_SEO_INDEXING;
      });

      it("respects the remaining quota (skips rows beyond it, leaves them pending)", async () => {
        process.env.FF_SEO_INDEXING = "true";
        const pendingRows = [
          { id: "q1", url: "https://cribliv.com/a", attempts: 0 },
          { id: "q2", url: "https://cribliv.com/b", attempts: 0 }
        ];
        query.mockResolvedValueOnce({ rows: pendingRows });

        const service = new IndexingService(database as never, auth as never, fetchMock as never);
        // quota=200, submittedToday=199 -> only 1 slot left
        const result = await service.drainPending(200, 199);

        expect(result).toEqual({ submitted: 1, failed: 0, skippedQuota: 1 });
        expect(fetchMock).not.toHaveBeenCalled(); // fetch itself would fail without a mock resolve; verify count separately
      });

      it("increments attempts and marks failed after 5 attempts on a Google error", async () => {
        process.env.FF_SEO_INDEXING = "true";
        const pendingRows = [{ id: "q1", url: "https://cribliv.com/a", attempts: 4 }];
        query.mockResolvedValueOnce({ rows: pendingRows }).mockResolvedValueOnce({ rows: [] }); // UPDATE to failed
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => "quota exceeded"
        });

        const service = new IndexingService(database as never, auth as never, fetchMock as never);
        const result = await service.drainPending(200, 0);

        expect(result).toEqual({ submitted: 0, failed: 1, skippedQuota: 0 });
        const [updateSql, updateParams] = query.mock.calls[1];
        expect(updateSql).toContain("SET status = 'failed'");
        expect(updateSql).toContain("attempts = attempts + 1");
        expect(updateParams[0]).toBe("q1");

        delete process.env.FF_SEO_INDEXING;
      });

      it("keeps status pending (not failed) and bumps attempts when under the 5-attempt cap", async () => {
        process.env.FF_SEO_INDEXING = "true";
        const pendingRows = [{ id: "q1", url: "https://cribliv.com/a", attempts: 1 }];
        query.mockResolvedValueOnce({ rows: pendingRows }).mockResolvedValueOnce({ rows: [] });
        fetchMock.mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "server error"
        });

        const service = new IndexingService(database as never, auth as never, fetchMock as never);
        await service.drainPending(200, 0);

        const [updateSql] = query.mock.calls[1];
        expect(updateSql).toContain("SET status = 'pending'");
        expect(updateSql).toContain("attempts = attempts + 1");

        delete process.env.FF_SEO_INDEXING;
      });

      it("never throws even if Google auth itself fails — logs and returns zero counts", async () => {
        process.env.FF_SEO_INDEXING = "true";
        query.mockResolvedValueOnce({
          rows: [{ id: "q1", url: "https://cribliv.com/a", attempts: 0 }]
        });
        auth.getAccessToken = vi.fn(async () => {
          throw new Error("auth exploded");
        });

        const service = new IndexingService(database as never, auth as never, fetchMock as never);
        await expect(service.drainPending(200, 0)).resolves.toEqual({
          submitted: 0,
          failed: 0,
          skippedQuota: 0
        });

        delete process.env.FF_SEO_INDEXING;
      });
    });

    describe("listQueue / retry", () => {
      it("lists queue rows filtered by status with total count", async () => {
        query
          .mockResolvedValueOnce({ rows: [{ id: "q1" }], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [{ count: 1 }] });
        const service = new IndexingService(database as never, auth as never, fetchMock as never);

        const result = await service.listQueue({ status: "failed", limit: 20, offset: 0 });
        expect(result.items).toEqual([{ id: "q1" }]);
        expect(result.total).toBe(1);

        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain("WHERE status = $1");
        expect(params).toEqual(["failed", 20, 0]);
      });

      it("resets a failed row to pending on retry", async () => {
        const row = { id: "q1", status: "pending", attempts: 3 };
        query.mockResolvedValueOnce({ rows: [row] });
        const service = new IndexingService(database as never, auth as never, fetchMock as never);

        await expect(service.retry("q1")).resolves.toEqual(row);
        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain("SET status = 'pending'");
        expect(sql).toContain("WHERE id = $1");
        expect(params).toEqual(["q1"]);
      });
    });
  });
  ```

- [ ] Run it and confirm it fails because the module does not exist:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/__tests__/indexing.service.test.ts`
      Expected: `Cannot find module '../indexing.service'`.
- [ ] Write `apps/api/src/modules/seo/indexing.service.ts`:

  ```ts
  import { Injectable, Logger } from "@nestjs/common";
  import { DatabaseService } from "../../common/database.service";
  import { readFeatureFlags } from "../../config/feature-flags";
  import { GoogleServiceAuth } from "./google/google-service-auth";

  const INDEXING_SCOPE = "https://www.googleapis.com/auth/indexing";
  const PUBLISH_ENDPOINT = "https://indexing.googleapis.com/v3/urlNotifications:publish";
  const MAX_ATTEMPTS_BEFORE_FAIL = 5;

  export interface SeoIndexingQueueRow {
    id: string;
    url: string;
    status: "pending" | "submitted" | "failed" | "skipped";
    reason: string | null;
    attempts: number;
    submitted_at: string | null;
    response: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  }

  const QUEUE_ROW_COLUMNS = `id::text, url, status, reason, attempts,
       submitted_at::text AS submitted_at, response,
       created_at::text AS created_at, updated_at::text AS updated_at`;

  @Injectable()
  export class IndexingService {
    private readonly logger = new Logger(IndexingService.name);
    private readonly fetchImpl: typeof fetch;

    constructor(
      private readonly database: DatabaseService,
      private readonly auth: GoogleServiceAuth,
      fetchImpl: typeof fetch = fetch
    ) {
      this.fetchImpl = fetchImpl;
    }

    /** Upsert a URL into the queue. Always writes, regardless of FF_SEO_INDEXING
     *  — enqueue never loses data; only draining is flag-gated, so flipping the
     *  flag on later immediately has a backlog ready to submit. */
    async enqueue(url: string, reason: string): Promise<SeoIndexingQueueRow | null> {
      if (!this.database.isEnabled()) return null;

      const { rows } = await this.database.query<SeoIndexingQueueRow>(
        `INSERT INTO seo_indexing_queue (url, reason)
         VALUES ($1, $2)
         ON CONFLICT (url) DO UPDATE SET
           reason = EXCLUDED.reason,
           status = 'pending',
           updated_at = now()
         RETURNING ${QUEUE_ROW_COLUMNS}`,
        [url, reason]
      );
      return rows[0] ?? null;
    }

    async submittedCountToday(): Promise<number> {
      if (!this.database.isEnabled()) return 0;
      const { rows } = await this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM seo_indexing_queue
         WHERE status = 'submitted' AND submitted_at >= date_trunc('day', now())`,
        []
      );
      return rows[0]?.count ?? 0;
    }

    /**
     * Drains `pending` rows (newest first — highest-value/most-recent URLs win
     * when the daily quota is tight), up to `quota - submittedToday` remaining
     * slots. Never throws: a Google auth failure or any per-row error is caught,
     * logged, and the loop continues so one bad row can't stall the whole batch.
     */
    async drainPending(
      quota: number,
      submittedToday: number
    ): Promise<{ submitted: number; failed: number; skippedQuota: number }> {
      if (!readFeatureFlags().ff_seo_indexing) {
        return { submitted: 0, failed: 0, skippedQuota: 0 };
      }
      if (!this.database.isEnabled()) {
        return { submitted: 0, failed: 0, skippedQuota: 0 };
      }

      const remaining = Math.max(0, quota - submittedToday);
      if (remaining === 0) {
        return { submitted: 0, failed: 0, skippedQuota: 0 };
      }

      const { rows: pending } = await this.database.query<{
        id: string;
        url: string;
        attempts: number;
      }>(
        `SELECT id::text, url, attempts FROM seo_indexing_queue
         WHERE status = 'pending'
         ORDER BY created_at DESC
         LIMIT $1`,
        [remaining + 1] // fetch one extra only to know if we're skipping any beyond remaining
      );

      const toSubmit = pending.slice(0, remaining);
      const skippedQuota = Math.max(0, pending.length - remaining);

      let submitted = 0;
      let failed = 0;

      for (const row of toSubmit) {
        try {
          const token = await this.auth.getAccessToken([INDEXING_SCOPE]);
          const response = await this.fetchImpl(PUBLISH_ENDPOINT, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ url: row.url, type: "URL_UPDATED" })
          });

          if (response.ok) {
            const body = await response.json().catch(() => ({}));
            await this.database.query(
              `UPDATE seo_indexing_queue
               SET status = 'submitted', submitted_at = now(), response = $2::jsonb, updated_at = now()
               WHERE id = $1`,
              [row.id, JSON.stringify(body)]
            );
            submitted += 1;
          } else {
            const detail = await response.text().catch(() => "");
            await this.markFailedAttempt(row.id, row.attempts, {
              status: response.status,
              detail
            });
            failed += 1;
          }
        } catch (err) {
          this.logger.warn(
            `indexing_submitter: row ${row.id} (${row.url}) errored: ${err instanceof Error ? err.message : String(err)}`
          );
          try {
            await this.markFailedAttempt(row.id, row.attempts, {
              error: err instanceof Error ? err.message : String(err)
            });
          } catch {
            // Even the failure-marking UPDATE errored (e.g. DB blip) — swallow,
            // the row stays 'pending' and is retried next tick.
          }
          failed += 1;
        }
      }

      return { submitted, failed, skippedQuota };
    }

    private async markFailedAttempt(
      id: string,
      currentAttempts: number,
      response: Record<string, unknown>
    ): Promise<void> {
      const nextAttempts = currentAttempts + 1;
      const nextStatus = nextAttempts >= MAX_ATTEMPTS_BEFORE_FAIL ? "failed" : "pending";
      await this.database.query(
        `UPDATE seo_indexing_queue
         SET status = '${nextStatus}', attempts = attempts + 1, response = $2::jsonb, updated_at = now()
         WHERE id = $1`,
        [id, JSON.stringify(response)]
      );
    }

    async listQueue(params: {
      status?: string;
      limit?: number;
      offset?: number;
    }): Promise<{ items: SeoIndexingQueueRow[]; total: number }> {
      if (!this.database.isEnabled()) return { items: [], total: 0 };

      const limit = Math.min(200, Math.max(1, params.limit ?? 50));
      const offset = Math.max(0, params.offset ?? 0);
      const whereClause = params.status ? "WHERE status = $1" : "";
      const queryParams: unknown[] = params.status
        ? [params.status, limit, offset]
        : [limit, offset];
      const limitIdx = params.status ? "$2" : "$1";
      const offsetIdx = params.status ? "$3" : "$2";

      const { rows } = await this.database.query<SeoIndexingQueueRow>(
        `SELECT ${QUEUE_ROW_COLUMNS} FROM seo_indexing_queue
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ${limitIdx} OFFSET ${offsetIdx}`,
        queryParams
      );

      const countParams = params.status ? [params.status] : [];
      const { rows: countRows } = await this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM seo_indexing_queue ${whereClause}`,
        countParams
      );

      return { items: rows, total: countRows[0]?.count ?? 0 };
    }

    async retry(id: string): Promise<SeoIndexingQueueRow | null> {
      if (!this.database.isEnabled()) return null;
      const { rows } = await this.database.query<SeoIndexingQueueRow>(
        `UPDATE seo_indexing_queue
         SET status = 'pending', updated_at = now()
         WHERE id = $1
         RETURNING ${QUEUE_ROW_COLUMNS}`,
        [id]
      );
      return rows[0] ?? null;
    }
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/__tests__/indexing.service.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  11 passed (11)`.
- [ ] Commit:

  ```
  git add apps/api/src/modules/seo/indexing.service.ts apps/api/src/modules/seo/__tests__/indexing.service.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add IndexingService — enqueue + quota-gated Indexing API drain

  enqueue always writes (upsert-on-url, re-queues on content change);
  drainPending is gated by FF_SEO_INDEXING + a caller-supplied quota, submits
  newest-first, and never throws — Google/auth errors increment attempts and
  cap out at 'failed' after 5 tries for manual admin retry.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5: Register `GoogleServiceAuth` + `IndexingService` in `SeoModule`; enqueue on listing approve

**Files:**

- Modify: `apps/api/src/modules/seo/seo.module.ts`
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`
- Test: `apps/api/test/admin-listing-decision-seo-enqueue.test.ts`

**Interfaces:**

- Produces: `SeoModule` now exports `IndexingService` and `GoogleServiceAuth` alongside the existing three providers, so `AdminModule` (which already `imports: [..., SeoModule]`) can inject `IndexingService` without a new module import.
- Modifies: `AdminController.listingDecision` — on `decision === "approve"` with DB enabled, after the existing status/photo/PG-sync logic, inserts one `outbound_events` row with `event_type = 'seo.queue_indexing'`, `aggregate_type = 'listing'`, `aggregate_id = listingId`, `payload = { listing_id, reason: 'listing_approved' }`. This mirrors the exact `INSERT INTO outbound_events` shape used by `runLeadNudgeSweep` in `worker.ts` — best-effort, never blocks the response (fire within the same successful-response path, not awaited-and-thrown on failure).
- Consumed by: Task 6's worker `outbound_events` dispatch loop, which must special-case `event_type === 'seo.queue_indexing'` the same way it special-cases `notification.whatsapp.*` today.

Steps:

- [ ] Write the failing test at `apps/api/test/admin-listing-decision-seo-enqueue.test.ts` — this test drives the **existing** `listingDecision` endpoint (already covered by other suites for its status/photo logic) and asserts only the **new** `outbound_events` insert, using a minimal harness that mirrors `pg-admin-analytics.integration.test.ts`'s "test controller mirroring the real route" style but here we test the real `AdminController` directly since it is small enough to import as-is:

  ```ts
  import "reflect-metadata";
  import type { INestApplication } from "@nestjs/common";
  import { Test } from "@nestjs/testing";
  import request from "supertest";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { AuthGuard } from "../src/common/auth.guard";
  import { RolesGuard } from "../src/common/roles.guard";
  import { AppStateService } from "../src/common/app-state.service";
  import { DatabaseService } from "../src/common/database.service";
  import { NotificationService } from "../src/modules/notifications/notification.service";
  import { AdminAnalyticsService } from "../src/modules/admin/admin-analytics.service";
  import { AdminOpsService } from "../src/modules/admin/admin-ops.service";
  import { AdminOwnerHealthService } from "../src/modules/admin/admin-owner-health.service";
  import { AdminRevenueService } from "../src/modules/admin/admin-revenue.service";
  import { AdminFraudFeedService } from "../src/modules/admin/admin-fraud-feed.service";
  import { AdminRentAgreementService } from "../src/modules/admin/admin-rent-agreement.service";
  import { PgScoreService } from "../src/modules/pg-operator/services/pg-score.service";
  import { PgFunnelService } from "../src/modules/pg-operator/services/pg-funnel.service";
  import { PgAdminAnalyticsService } from "../src/modules/admin/pg-admin-analytics.service";
  import { PgAdminPropertiesService } from "../src/modules/admin/pg-admin-properties.service";
  import { PgAnalyticsOverrideService } from "../src/modules/admin/pg-analytics-override.service";
  import { PgAdminListingEditService } from "../src/modules/admin/pg-admin-listing-edit.service";
  import { AdminController } from "../src/modules/admin/admin.controller";

  const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
  const LISTING_ID = "00000000-0000-4000-8000-0000000000aa";

  describe("AdminController.listingDecision — seo.queue_indexing enqueue on approve", () => {
    let app: INestApplication;
    let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      database = {
        isEnabled: () => true,
        query: vi.fn(async (sql: string) => {
          if (/SELECT l\.listing_type/.test(sql)) {
            return { rows: [{ listing_type: "flat_house", photo_count: 6 }], rowCount: 1 };
          }
          if (/UPDATE listings/.test(sql)) {
            return { rows: [{ id: LISTING_ID, status: "active" }], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        })
      };

      const moduleRef = await Test.createTestingModule({
        controllers: [AdminController],
        providers: [
          RolesGuard,
          { provide: AppStateService, useValue: new AppStateService() },
          { provide: DatabaseService, useValue: database },
          { provide: NotificationService, useValue: { send: vi.fn() } },
          { provide: AdminAnalyticsService, useValue: {} },
          { provide: AdminOpsService, useValue: {} },
          { provide: AdminOwnerHealthService, useValue: {} },
          { provide: AdminRevenueService, useValue: {} },
          { provide: AdminFraudFeedService, useValue: {} },
          { provide: AdminRentAgreementService, useValue: {} },
          { provide: PgScoreService, useValue: { rescoreListing: vi.fn() } },
          { provide: PgFunnelService, useValue: { trackPublished: vi.fn() } },
          { provide: PgAdminAnalyticsService, useValue: {} },
          { provide: PgAdminPropertiesService, useValue: {} },
          { provide: PgAnalyticsOverrideService, useValue: {} },
          { provide: PgAdminListingEditService, useValue: {} }
        ]
      })
        .overrideGuard(AuthGuard)
        .useValue({
          canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
            ctx.switchToHttp().getRequest().user = { id: ADMIN_ID, role: "admin" };
            return true;
          }
        })
        .compile();

      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app?.close();
    });

    it("inserts a seo.queue_indexing outbound_events row when a listing is approved", async () => {
      await request(app.getHttpServer())
        .post(`/review/listings/${LISTING_ID}/decision`)
        .send({ decision: "approve" })
        .expect(200);

      const enqueueCall = database.query.mock.calls.find(
        ([sql]: [string]) =>
          sql.includes("INSERT INTO outbound_events") && sql.includes("seo.queue_indexing")
      );
      expect(enqueueCall).toBeDefined();
      const [sql, params] = enqueueCall!;
      expect(sql).toContain("'seo.queue_indexing'");
      expect(sql).toContain("'listing'");
      expect(params[0]).toBe(LISTING_ID);
      const payload = JSON.parse(params[1]);
      expect(payload).toEqual({ listing_id: LISTING_ID, reason: "listing_approved" });
    });

    it("does NOT enqueue on reject", async () => {
      await request(app.getHttpServer())
        .post(`/review/listings/${LISTING_ID}/decision`)
        .send({ decision: "reject", reason: "spam" })
        .expect(200);

      const enqueueCall = database.query.mock.calls.find(([sql]: [string]) =>
        sql.includes("seo.queue_indexing")
      );
      expect(enqueueCall).toBeUndefined();
    });
  });
  ```

- [ ] Run it and confirm it fails (no enqueue insert exists yet):
      `pnpm --filter @cribliv/api exec vitest run test/admin-listing-decision-seo-enqueue.test.ts`
      Expected: `expect(enqueueCall).toBeDefined()` fails with `undefined`.
- [ ] In `apps/api/src/modules/admin/admin.controller.ts`, locate the `if (newStatus === "active") { ... }` block inside `listingDecision` (right after the PG-sync `UPDATE pg_listings` call, before `logTelemetry("admin.listing_decision", ...)`) and add the enqueue call inside that same `if` block, after the existing `void this.pgFunnel.trackPublished(listingId);` line:

  ```ts
  if (newStatus === "active") {
    await this.database.query(
      `UPDATE listings SET verification_status = 'verified'
        WHERE id = $1::uuid AND listing_type = 'pg'`,
      [listingId]
    );
    void this.pgScore.rescoreListing(listingId);
    void this.pgFunnel.trackPublished(listingId);

    // Slice 2: fast-track newly-published listings to the Google Indexing
    // API. Fire-and-forget via outbound_events (same table/worker dispatch
    // loop as WhatsApp notifications) so a DB hiccup here never blocks the
    // approval response. IndexingService.enqueue is itself flag-agnostic
    // (always writes); FF_SEO_INDEXING only gates the worker's drain step.
    this.database
      .query(
        `INSERT INTO outbound_events (event_type, aggregate_type, aggregate_id, payload, next_attempt_at)
         VALUES ('seo.queue_indexing', 'listing', $1::uuid, $2::jsonb, now())`,
        [listingId, JSON.stringify({ listing_id: listingId, reason: "listing_approved" })]
      )
      .catch(() => undefined);
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run test/admin-listing-decision-seo-enqueue.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  2 passed (2)`.
- [ ] Update `apps/api/src/modules/seo/seo.module.ts` to register the two new providers and export them, so `AdminModule` (already importing `SeoModule`) can inject `IndexingService` in Task 10's admin controller without any new module wiring:

  ```ts
  import { Module } from "@nestjs/common";
  import { SeoController } from "./seo.controller";
  import { SeoAggregatesService } from "./seo-aggregates.service";
  import { SeoCityConfigService } from "./seo-city-config.service";
  import { SeoCopyService } from "./seo-copy.service";
  import { GoogleServiceAuth } from "./google/google-service-auth";
  import { IndexingService } from "./indexing.service";

  @Module({
    controllers: [SeoController],
    providers: [
      SeoAggregatesService,
      SeoCityConfigService,
      SeoCopyService,
      GoogleServiceAuth,
      IndexingService
    ],
    exports: [
      SeoAggregatesService,
      SeoCityConfigService,
      SeoCopyService,
      GoogleServiceAuth,
      IndexingService
    ]
  })
  export class SeoModule {}
  ```

- [ ] Run the full API test suite once to confirm the module wiring change doesn't break Nest's DI graph anywhere else:
      `pnpm --filter @cribliv/api exec vitest run test/ src/ --reporter=dot 2>&1 | tail -30`
      Expected: same pass count as before this task (plus the 2 new tests), no new DI resolution errors.
- [ ] Commit:

  ```
  git add apps/api/src/modules/admin/admin.controller.ts apps/api/src/modules/seo/seo.module.ts apps/api/test/admin-listing-decision-seo-enqueue.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): enqueue seo.queue_indexing on listing approval

  Reuses the existing outbound_events dispatch table (same one WhatsApp
  notifications use) so a fast-follow worker handler can drain it into
  IndexingService without a bespoke queue. Registers GoogleServiceAuth +
  IndexingService on SeoModule so AdminModule can inject IndexingService
  directly in a later task.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6: Enqueue indexing on city enable — `SeoCityConfigService.setEnabled(true)`

**Files:**

- Modify: `apps/api/src/modules/seo/seo-city-config.service.ts`
- Modify: `apps/api/src/modules/seo/seo.module.ts`
- Test: `apps/api/test/seo-city-config.service.test.ts` (extend existing file)

**Interfaces:**

- Modifies: `SeoCityConfigService` constructor now takes a third dependency, `IndexingService`, injected via Nest DI (both already live in `SeoModule`, so this is a same-module wire-up, no circular import — `IndexingService` does not depend on `SeoCityConfigService`).
- Modifies: `setEnabled(citySlug, enabled, notes)` — when `enabled === true` and the upsert succeeds, calls `this.indexing.enqueue(url, "city_enabled")` once per newly-indexable URL for that city. Per the spec's scope ("newly-indexable URLs"), this plan defines that set as exactly the city-hub URL itself: `/{locale}/city/{citySlug}` for `locale` in `["en", "hi"]` — the per-locality/metro/landmark page URLs are numerous and already covered by the sitemap's crawl path, so only the two city-hub entry points get the fast-track Indexing API treatment (keeps this task's URL-construction logic trivial and avoids a second live DB query in the hot toggle path). Locale list is hardcoded here, matching the two locales already live everywhere else in this repo (`ff_hi_locale_enabled`, `[locale]` App Router segment).
- Consumed by: nothing further in this plan; this is a terminal enqueue point mirroring Task 5's listing-approve enqueue point, both funneling into the same `seo_indexing_queue` table.

Steps:

- [ ] Add the following test cases at the end of the existing `describe("SeoCityConfigService", ...)` block in `apps/api/test/seo-city-config.service.test.ts` (append before the final closing `});` of the file) — first update the top-of-file constructor calls in the existing tests to pass a third `indexing` stub (every existing `new SeoCityConfigService(database as never, aggregates as never)` call in that file must become `new SeoCityConfigService(database as never, aggregates as never, indexing as never)`; add `let indexing: { enqueue: ReturnType<typeof vi.fn> };` next to the other `let` declarations and initialize it in `beforeEach` as `indexing = { enqueue: vi.fn(async () => null) };`), then append:

  ```ts
  it("enqueues the city hub URL (en + hi) for fast indexing when enabling a city", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [ENABLED_ROW] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await service.setEnabled("noida", true, "reviewed");

    expect(indexing.enqueue).toHaveBeenCalledTimes(2);
    expect(indexing.enqueue).toHaveBeenCalledWith("/en/city/noida", "city_enabled");
    expect(indexing.enqueue).toHaveBeenCalledWith("/hi/city/noida", "city_enabled");
  });

  it("does NOT enqueue indexing when disabling a city", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [{ ...ENABLED_ROW, programmatic_enabled: false }] });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await service.setEnabled("noida", false, "paused");

    expect(indexing.enqueue).not.toHaveBeenCalled();
  });

  it("does not let an indexing enqueue failure break the city toggle response", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ count: 4 }] })
      .mockResolvedValueOnce({ rows: [ENABLED_ROW] });
    indexing.enqueue = vi.fn(async () => {
      throw new Error("db blip");
    });
    const service = new SeoCityConfigService(
      database as never,
      aggregates as never,
      indexing as never
    );

    await expect(service.setEnabled("noida", true, "reviewed")).resolves.toEqual(ENABLED_ROW);
  });
  ```

- [ ] Run it and confirm it fails (constructor arity mismatch / `indexing.enqueue` never called):
      `pnpm --filter @cribliv/api exec vitest run test/seo-city-config.service.test.ts`
      Expected: TypeScript error `Expected 2 arguments, but got 3` on the updated call sites, or (if TS is loose here under `ts-node`/vitest's esbuild transform) a runtime failure `expect(indexing.enqueue).toHaveBeenCalledTimes(2)` — received `0`.
- [ ] In `apps/api/src/modules/seo/seo-city-config.service.ts`, add the import and constructor parameter:
  ```ts
  import { Injectable, NotFoundException } from "@nestjs/common";
  import { DatabaseService } from "../../common/database.service";
  import { SeoAggregatesService } from "./seo-aggregates.service";
  import { IndexingService } from "./indexing.service";
  import { readFeatureFlags } from "../../config/feature-flags";
  ```
  ```ts
  @Injectable()
  export class SeoCityConfigService {
    constructor(
      private readonly database: DatabaseService,
      private readonly aggregates: SeoAggregatesService,
      private readonly indexing: IndexingService
    ) {}
  ```
- [ ] In the same file, modify `setEnabled` to enqueue on successful enable — insert right before the final `return rows[0] ?? null;` line:

  ```ts
  if (enabled && rows[0]) {
    // Slice 2: fast-track the city hub (both locales) to the Indexing API.
    // Best-effort — an enqueue failure must never fail the toggle itself,
    // since the city is already live in the DB by this point.
    for (const locale of ["en", "hi"] as const) {
      this.indexing.enqueue(`/${locale}/city/${citySlug}`, "city_enabled").catch(() => undefined);
    }
  }

  return rows[0] ?? null;
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run test/seo-city-config.service.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  12 passed (12)` (9 pre-existing + 3 new).
- [ ] Fix the two other call sites that construct `SeoCityConfigService` directly with 2 args: search for them and update.
      `grep -rn "new SeoCityConfigService(" apps/api/src apps/api/test`
      For each hit outside the test file just edited, add a third `indexing` argument — if it's a real Nest DI resolution (no `new` call in app code, only in tests per the earlier grep), skip; if any test file constructs it directly (e.g. an admin-seo controller test uses `{ provide: SeoCityConfigService, useValue: ... }` — that pattern needs no change since it's a mock, not a `new` call).
- [ ] Update `apps/api/src/modules/seo/seo.module.ts` — no change needed (Nest resolves the new constructor param automatically since `IndexingService` is already a provider in the same module from Task 5); just re-run the full suite to confirm:
      `pnpm --filter @cribliv/api exec vitest run test/ src/ --reporter=dot 2>&1 | tail -30`
      Expected: no new failures.
- [ ] Commit:

  ```
  git add apps/api/src/modules/seo/seo-city-config.service.ts apps/api/test/seo-city-config.service.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): enqueue city hub URLs for fast indexing on city enable

  SeoCityConfigService.setEnabled(true) now enqueues /en/city/{slug} and
  /hi/city/{slug} into seo_indexing_queue via IndexingService, mirroring the
  listing-approve enqueue point. Best-effort — an enqueue failure never
  fails the city toggle response.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7: Worker — `seo.queue_indexing` outbound_events handler + `indexing_submitter` job

**Files:**

- Modify: `apps/api/src/worker/worker.ts`
- Test: `apps/api/test/worker-indexing-submitter.test.ts`

**Interfaces:**

- Produces: exported (for testability, matching `outboundBackoffSeconds`/`runOutboundDispatchDb` already being module-level functions in `worker.ts`) `async function runIndexingSubmitterJob(pool: Pool): Promise<{ submitted: number; failed: number; skippedQuota: number }>` — reads `GOOGLE_INDEXING_DAILY_QUOTA` (default `200`) from env, builds an `IndexingService` wired to a real `Pool`-backed `DatabaseService`-shaped adapter (same `{ isEnabled: () => true, query: (text, params) => pool.query(text, params) }` adapter object already used by `runPgScoreRecompute`) and a real `GoogleServiceAuth`, calls `service.submittedCountToday()` then `service.drainPending(quota, submittedToday)`.
- Modifies: `runOutboundDispatchDb`'s per-event dispatch branch — adds a new `else if (event.event_type === "seo.queue_indexing")` branch, alongside the existing `isWhatsApp` / `crmWebhookUrl` branches, that is effectively a no-op marker (the actual enqueue already happened synchronously when the row was inserted in Task 5/6 — the `outbound_events` row here exists purely as an **audit trail** of "a listing was approved and indexing was requested," not as the mechanism that performs the Google call). Marking it `dispatched` immediately (like the "no CRM webhook configured" branch) keeps the existing outbound-dispatch loop's invariants intact (every event eventually reaches a terminal status) without giving this event type any special retry/backoff semantics it doesn't need.
- Adds: a new top-level `setInterval(..., INDEXING_SUBMITTER_MS)` block (constant `const INDEXING_SUBMITTER_MS = 15 * 60 * 1000; // every 15 min`) inside the existing `if (pool) { ... }` block in `run()`, following the exact `try/catch` + `console.log(JSON.stringify({ job: "...", ...}))` / `console.error(...)` shape used by every other job in the file (e.g. `runSubscriptionRenewal`). Also appended to the startup `jobs: [...]` log array and given a run-once-at-boot call, matching `runPgTtl`'s pattern (`runIndexingSubmitter(); setInterval(runIndexingSubmitter, INDEXING_SUBMITTER_MS);`).
- Consumes: Task 4's `IndexingService`, Task 2's `GoogleServiceAuth`, env `GOOGLE_INDEXING_DAILY_QUOTA`.

Steps:

- [ ] Write the failing unit test at `apps/api/test/worker-indexing-submitter.test.ts` — this tests the exported `runIndexingSubmitterJob` function directly against a mocked `Pool`-like object (matching how the repo would test `runPgScoreRecompute` if it had a unit test — none exists, so this establishes the pattern for worker-job functions going forward) and against a mocked global `fetch`:

  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { runIndexingSubmitterJob } from "../src/worker/worker";

  const FAKE_KEY = {
    client_email: "seo-worker@cribliv-seo.iam.gserviceaccount.com",
    private_key_id: "abc123",
    private_key:
      "-----BEGIN PRIVATE KEY-----\n" +
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\n" +
      "MzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu\n" +
      "NMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCdPEovGhLa0VzMaQ8s+CLOyS56YyCFGeJZ\n" +
      "qgtzJ6GR3eqoYSW9b9UMvkBpZODSctWSNGj3P7jRFDO5VoTwCQAWbFnOjDfH5Ulg\n" +
      "p2PKSQnSJP3AJLQNFNe7br1XbrhV//eO+t51mIpGSDCUv3E0DDFcWDTH9cXDTTlR\n" +
      "ZVEiR2BwpZOOkE/Z0/BVnhZYL721itYuwEuY9RSmnGXGjBqzhskn3fV0aME21XFB\n" +
      "l87yWyR6AgMBAAECggEAB4wsz5S9SBHnJj0j2Ubx3RpcJz9SnYDBqW0LfLLRUS3q\n" +
      "8mLzRzOENfXW5xJKRvKZoYCLmr9Aq+Kj3IhV1BbHUXO1L4L1Vh4nY9RtV2Nl+SF3\n" +
      "u+HrfF+O1TKtF5nUL2sSw8OiGgxDx8bA3T0GaZ0X9WCCEXGnzY6R0TZlEwR+3Ncy\n" +
      "SdKZHhAWlSc0K1zNaEfBhK1r9wY0XKzY0hDkOyIzuRZ4b2v9wNwTL1w9RaJXtQMt\n" +
      "z+8OtSaX0m+8FhLtFm/rqSAkK/DrDPWScS6UunOd3PDOn6IzhZgVIn41BblT6uH9\n" +
      "6/z6X7pxZP1QDXxa5nCiLXWQ4gDXaZmPWfy+r0MCkQKBgQD3Zj7iZbmYlKq7t0nQ\n" +
      "3TCLl0y4d0h5oj6iP0G9jGflQ+8mSFHf6qJvFTOPaVQOswiy5jNZ48OTCzM4v+Z9\n" +
      "N6YRc4x+7NglTOWZjXKQmpP3EEGVh7dcQwZK9m+YFV9MFwrLGKfQpTXsHgAyRuUv\n" +
      "hj1jbiHnh1nUeXXOb2xKX6yPRQKBgQDBk8DzYqEXQfL6vqDdOFXaTPnMoypq3/EW\n" +
      "wLLGH+xEDPB2rTQOsHrpJqp4c9gyiZAV+bwrDQnwaZeYIrx8OZ5S0v7yiV1x1XkN\n" +
      "R7WhtAb0+Sc5FQ6/9GnT8kJZXW/CZ+X2XblT4tOzTJP2h0i1LKcTqAyq1cVoW1z9\n" +
      "0AjhqZzKlwKBgQDMDPNQduWnpU4Yl0OwsOEnR1U9C+iuFy5rIkOTr0XpMwzcCzHR\n" +
      "K91efQoyj2rWnW7ekaZlF6dEz+7L3fY8ejqRCXwSbHEjS1AeqTk49WluPHkNlY0K\n" +
      "OK8XecT2NqiFcv8fGm6c6DR6E5cGbn9laX0e8mYcnq1Xz9NIe9DzOEyx8QKBgFf5\n" +
      "3g3GvGZOZOe6PA9pOFmWq0YB9wG08cVUM1E4/gNjWFyUBqk9ynnpc5g2WcVLTU5C\n" +
      "6bxdyPYEqxE4M1Y3kW9jH5emhU4M42R7lm/wGmjTELsB6zXlU/UO0EMWr6oIQvXY\n" +
      "TzEeZjD/DhY+KgJZY0EhVXk3AGYXFOEtc+FvVjfLAoGAJvE6d1MZoLbF/DFvS20u\n" +
      "6nzsC1zLb0Q9RmYYQMwvVGvY0kdN9tPd6VJqEfMHqLxSWJ6Ta6P4CJn+0Xg9BjKt\n" +
      "kZLcUx24LGiF3rUp0FVspBpF8KTHOcW3l0Z9dJ0AqzP0z3paQwsWEG5nOgfKLu9C\n" +
      "wEWgOJyPzXcvzR2z+7pcaX0=\n" +
      "-----END PRIVATE KEY-----\n"
  };

  describe("runIndexingSubmitterJob", () => {
    let poolQuery: ReturnType<typeof vi.fn>;
    let pool: { query: ReturnType<typeof vi.fn> };
    let originalEnv: { flag?: string; keyJson?: string; quota?: string };

    beforeEach(() => {
      poolQuery = vi.fn();
      pool = { query: poolQuery };
      originalEnv = {
        flag: process.env.FF_SEO_INDEXING,
        keyJson: process.env.GSC_SERVICE_ACCOUNT_JSON,
        quota: process.env.GOOGLE_INDEXING_DAILY_QUOTA
      };
      process.env.FF_SEO_INDEXING = "true";
      process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_KEY);
    });

    afterEach(() => {
      if (originalEnv.flag === undefined) delete process.env.FF_SEO_INDEXING;
      else process.env.FF_SEO_INDEXING = originalEnv.flag;
      if (originalEnv.keyJson === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON;
      else process.env.GSC_SERVICE_ACCOUNT_JSON = originalEnv.keyJson;
      if (originalEnv.quota === undefined) delete process.env.GOOGLE_INDEXING_DAILY_QUOTA;
      else process.env.GOOGLE_INDEXING_DAILY_QUOTA = originalEnv.quota;
      vi.unstubAllGlobals();
    });

    it("reads GOOGLE_INDEXING_DAILY_QUOTA and submits pending rows within it", async () => {
      process.env.GOOGLE_INDEXING_DAILY_QUOTA = "5";
      poolQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // submittedCountToday
        .mockResolvedValueOnce({ rows: [{ id: "q1", url: "https://cribliv.com/a", attempts: 0 }] }) // SELECT pending
        .mockResolvedValueOnce({ rows: [] }); // UPDATE submitted

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ urlNotificationMetadata: {} })
        }))
      );

      const result = await runIndexingSubmitterJob(pool as never);

      expect(result).toEqual({ submitted: 1, failed: 0, skippedQuota: 0 });
    });

    it("defaults GOOGLE_INDEXING_DAILY_QUOTA to 200 when unset", async () => {
      delete process.env.GOOGLE_INDEXING_DAILY_QUOTA;
      poolQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] }).mockResolvedValueOnce({ rows: [] }); // no pending rows

      const result = await runIndexingSubmitterJob(pool as never);

      expect(result).toEqual({ submitted: 0, failed: 0, skippedQuota: 0 });
      // The SELECT pending LIMIT should reflect the 200 default (LIMIT $1 = 201).
      const selectCall = poolQuery.mock.calls.find(([sql]) =>
        /SELECT.*FROM seo_indexing_queue/.test(sql)
      );
      expect(selectCall![1]).toEqual([201]);
    });

    it("never throws when FF_SEO_INDEXING is off — returns zero counts without querying", async () => {
      process.env.FF_SEO_INDEXING = "false";

      await expect(runIndexingSubmitterJob(pool as never)).resolves.toEqual({
        submitted: 0,
        failed: 0,
        skippedQuota: 0
      });
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it("never throws when the DB query itself rejects", async () => {
      poolQuery.mockRejectedValueOnce(new Error("connection reset"));

      await expect(runIndexingSubmitterJob(pool as never)).resolves.toEqual({
        submitted: 0,
        failed: 0,
        skippedQuota: 0
      });
    });
  });
  ```

- [ ] Run it and confirm it fails because `runIndexingSubmitterJob` is not exported:
      `pnpm --filter @cribliv/api exec vitest run test/worker-indexing-submitter.test.ts`
      Expected: `SyntaxError: The requested module '../src/worker/worker' does not provide an export named 'runIndexingSubmitterJob'`.
- [ ] In `apps/api/src/worker/worker.ts`, add the imports right after the existing `import type { DatabaseService } from "../common/database.service";` line:
  ```ts
  import { GoogleServiceAuth } from "../modules/seo/google/google-service-auth";
  import { IndexingService } from "../modules/seo/indexing.service";
  ```
- [ ] Add the new constant near the top, alongside `const PG_LEAD_AUTO_LOST_DAYS = 30;`:
  ```ts
  const INDEXING_SUBMITTER_MS = 15 * 60 * 1000; // every 15 min
  const DEFAULT_GOOGLE_INDEXING_DAILY_QUOTA = 200;
  ```
- [ ] Add the exported job function — place it right after `runSeoCopySweep` (keeps all SEO-adjacent job functions grouped together in the file):

  ```ts
  // ── Indexing API submitter (every ~15 min, gated by FF_SEO_INDEXING) ────────
  // Drains seo_indexing_queue up to GOOGLE_INDEXING_DAILY_QUOTA (default 200)
  // remaining submissions for today. Never throws: IndexingService.drainPending
  // already swallows per-row and auth errors; this wrapper also swallows the
  // submittedCountToday() query itself so a DB blip can't crash the worker tick.
  export async function runIndexingSubmitterJob(
    pool: Pool
  ): Promise<{ submitted: number; failed: number; skippedQuota: number }> {
    try {
      const adapter = {
        isEnabled: () => true,
        query: (text: string, params?: unknown[]) => pool.query(text, params)
      } as unknown as DatabaseService;
      const auth = new GoogleServiceAuth();
      const service = new IndexingService(adapter, auth);

      const quota =
        Number(process.env.GOOGLE_INDEXING_DAILY_QUOTA) || DEFAULT_GOOGLE_INDEXING_DAILY_QUOTA;
      const submittedToday = await service.submittedCountToday();
      return await service.drainPending(quota, submittedToday);
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "indexing_submitter",
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
      return { submitted: 0, failed: 0, skippedQuota: 0 };
    }
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run test/worker-indexing-submitter.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  4 passed (4)`.
- [ ] Now wire it into the `setInterval` loop. In `run()`, inside the existing `if (pool) { ... }` block, add right after the `runPgLeadAutoLost` block (before the closing `}` of the `if (pool)` block):
  ```ts
  // ── Indexing API submitter (every ~15 min, gated by FF_SEO_INDEXING) ──
  const runIndexingSubmitter = async () => {
    const result = await runIndexingSubmitterJob(pool);
    if (result.submitted > 0 || result.failed > 0 || result.skippedQuota > 0) {
      console.log(
        JSON.stringify({
          job: "indexing_submitter",
          submitted_count: result.submitted,
          failed_count: result.failed,
          skipped_quota_count: result.skippedQuota,
          timestamp: new Date().toISOString()
        })
      );
    }
  };
  setInterval(runIndexingSubmitter, INDEXING_SUBMITTER_MS);
  void runIndexingSubmitter();
  ```
- [ ] Add `"indexing_submitter"` to the startup `jobs: [...]` array in the final `console.log` in `run()`, right after `"pg_lead_auto_lost_sweep"`.
- [ ] Now wire the `outbound_events` audit-marker branch. In `runOutboundDispatchDb`'s per-event dispatch block, locate:

  ```ts
        try {
          const isWhatsApp = event.event_type.startsWith("notification.whatsapp.");

          if (isWhatsApp && whatsAppClient) {
  ```

  and add a new branch right before the final `} else {` (the "No dispatch target – skip" fallback), i.e. change:

  ```ts
          } else if (crmWebhookUrl) {
            // Dispatch via CRM webhook
            await postOutboundEvent(crmWebhookUrl, event);
          } else {
            // No dispatch target – skip
          }
  ```

  to:

  ```ts
          } else if (event.event_type === "seo.queue_indexing") {
            // Slice 2: the actual seo_indexing_queue insert already happened
            // synchronously (AdminController.listingDecision / SeoCityConfigService
            // .setEnabled wrote it directly via IndexingService.enqueue before this
            // outbound_events row was even created). This row is purely an audit
            // trail of "indexing was requested for X" — mark it dispatched
            // immediately so it reaches a terminal status like every other event.
          } else if (crmWebhookUrl) {
            // Dispatch via CRM webhook
            await postOutboundEvent(crmWebhookUrl, event);
          } else {
            // No dispatch target – skip
          }
  ```

- [ ] Write a focused test for the new `outbound_events` branch at `apps/api/test/worker-indexing-submitter.test.ts` (append to the same file, new top-level `describe`):

  ```ts
  import { runOutboundDispatchDb } from "../src/worker/worker";
  // (add this import alongside the existing runIndexingSubmitterJob import at top of file)

  describe("runOutboundDispatchDb — seo.queue_indexing audit branch", () => {
    it("marks a seo.queue_indexing event dispatched without calling any external webhook", async () => {
      const crmWebhook = vi.fn();
      vi.stubGlobal("fetch", crmWebhook);
      let selectCalls = 0;
      const poolQuery = vi.fn(async (sql: string) => {
        if (/^BEGIN$|^COMMIT$/.test(sql.trim())) return { rows: [] };
        if (/SELECT id, event_type/.test(sql)) {
          selectCalls += 1;
          if (selectCalls > 1) return { rows: [], rowCount: 0 };
          return {
            rows: [
              {
                id: 1,
                event_type: "seo.queue_indexing",
                aggregate_type: "listing",
                aggregate_id: "l1",
                payload: { listing_id: "l1", reason: "listing_approved" },
                attempt_count: 0
              }
            ],
            rowCount: 1
          };
        }
        if (/UPDATE outbound_events/.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });
      const pool = { connect: vi.fn(async () => ({ query: poolQuery, release: vi.fn() })) };

      const result = await runOutboundDispatchDb(pool as never, "https://crm.example.com/webhook");

      expect(result.dispatchedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(crmWebhook).not.toHaveBeenCalled();
      const updateCall = poolQuery.mock.calls.find(([sql]) => /UPDATE outbound_events/.test(sql));
      expect(updateCall![1]).toEqual([1]);
      vi.unstubAllGlobals();
    });
  });
  ```

  This requires exporting `runOutboundDispatchDb` from `worker.ts` — add `export` in front of `async function runOutboundDispatchDb(`.

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run test/worker-indexing-submitter.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  5 passed (5)`.
- [ ] Run the full worker-adjacent suite once more:
      `pnpm --filter @cribliv/api exec vitest run test/ src/ --reporter=dot 2>&1 | tail -30`
      Expected: no new failures.
- [ ] Commit:

  ```
  git add apps/api/src/worker/worker.ts apps/api/test/worker-indexing-submitter.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add indexing_submitter worker job + seo.queue_indexing handler

  New setInterval job (every 15 min) drains seo_indexing_queue via
  IndexingService, gated by FF_SEO_INDEXING and GOOGLE_INDEXING_DAILY_QUOTA
  (default 200). The outbound_events row created on listing approval / city
  enable is an audit trail only (the actual enqueue is synchronous) — the
  dispatch loop marks it dispatched immediately, same as an unconfigured
  CRM webhook.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8: `GscService` — searchanalytics.query fetch, parse, and upsert

**Files:**

- Create: `apps/api/src/modules/seo/gsc.service.ts`
- Test: `apps/api/src/modules/seo/__tests__/gsc.service.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface KeywordRankingRow {
    keyword: string;
    page: string;
    locale: string;
    city_slug: string | null;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    captured_at: string;
  }

  export class GscService {
    constructor(database: DatabaseService, auth: GoogleServiceAuth, fetchImpl?: typeof fetch);
    async pollAndUpsert(capturedAt?: string): Promise<{ rowsUpserted: number; pagesRead: number }>;
    async fetchCoverage(): Promise<{
      indexed_count: number | null;
      submitted_count: number | null;
    }>;
  }
  ```

- Consumes: env `GSC_SITE_URL` (e.g. `sc-domain:cribliv.com`), `GoogleServiceAuth.getAccessToken(["https://www.googleapis.com/auth/webmasters.readonly"])`, flag `FF_SEO_GSC` (checked inside `pollAndUpsert`; `fetchCoverage` is NOT flag-gated since it's a passive read the admin dashboard can call any time DB is enabled — matches spec 5.4's "also a light coverage fetch for the dashboard" being described separately from the flag-gated poll job).
- URL→locale/city_slug derivation: `page` URLs matching `^https?://[^/]+/(en|hi)/city/([a-z0-9-]+)` extract `locale` and `city_slug`; anything else defaults `locale` to `"en"` (Cribliv's URLs are `en`-only outside the `[locale]` segment convention already documented in CLAUDE.md) and `city_slug` to `null`.
- Consumed by: Task 9 (worker `gsc_poller` job calls `pollAndUpsert()` weekly), Task 10 (`SeoSearchService.getCoverage()` calls `fetchCoverage()`).
- Paging: Google's `searchanalytics.query` returns up to 25,000 rows per call with a `startRow` offset; this service pages in batches of `rowLimit: 5000` until an empty `rows` array is returned or 5 pages have been read (25,000 rows/week is a generous ceiling for a young site — hard-capped so a runaway loop can't hang the weekly job indefinitely).

Steps:

- [ ] Write the failing unit test at `apps/api/src/modules/seo/__tests__/gsc.service.test.ts`:

  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest";
  import { GscService } from "../gsc.service";

  describe("GscService", () => {
    let query: ReturnType<typeof vi.fn>;
    let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
    let auth: { getAccessToken: ReturnType<typeof vi.fn> };
    let fetchMock: ReturnType<typeof vi.fn>;
    let originalEnv: { flag?: string; site?: string };

    beforeEach(() => {
      query = vi.fn();
      database = { isEnabled: () => true, query };
      auth = { getAccessToken: vi.fn(async () => "ya29.fake") };
      fetchMock = vi.fn();
      originalEnv = { flag: process.env.FF_SEO_GSC, site: process.env.GSC_SITE_URL };
      process.env.FF_SEO_GSC = "true";
      process.env.GSC_SITE_URL = "sc-domain:cribliv.com";
    });

    afterEach(() => {
      if (originalEnv.flag === undefined) delete process.env.FF_SEO_GSC;
      else process.env.FF_SEO_GSC = originalEnv.flag;
      if (originalEnv.site === undefined) delete process.env.GSC_SITE_URL;
      else process.env.GSC_SITE_URL = originalEnv.site;
    });

    describe("pollAndUpsert", () => {
      it("does nothing when FF_SEO_GSC is off", async () => {
        process.env.FF_SEO_GSC = "false";
        const service = new GscService(database as never, auth as never, fetchMock as never);

        await expect(service.pollAndUpsert("2026-07-06")).resolves.toEqual({
          rowsUpserted: 0,
          pagesRead: 0
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();
      });

      it("fetches searchanalytics.query with the right dimensions/date range and upserts rows", async () => {
        fetchMock
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              rows: [
                {
                  keys: ["2bhk flat noida", "https://cribliv.com/en/city/noida"],
                  clicks: 12,
                  impressions: 300,
                  ctr: 0.04,
                  position: 8.5
                },
                {
                  keys: ["pg near sector 62", "https://cribliv.com/hi/city/noida"],
                  clicks: 3,
                  impressions: 150,
                  ctr: 0.02,
                  position: 22.1
                }
              ]
            })
          })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) }); // page 2: empty, stop

        query.mockResolvedValue({ rows: [] });

        const service = new GscService(database as never, auth as never, fetchMock as never);
        const result = await service.pollAndUpsert("2026-07-06");

        expect(result).toEqual({ rowsUpserted: 2, pagesRead: 1 });

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(
          "https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Acribliv.com/searchAnalytics/query"
        );
        expect(init.method).toBe("POST");
        expect(init.headers.Authorization).toBe("Bearer ya29.fake");
        const body = JSON.parse(init.body);
        expect(body.dimensions).toEqual(["query", "page"]);
        expect(body.rowLimit).toBe(5000);
        expect(body.startRow).toBe(0);
        // 28-day window ending "today" (captured_at)
        expect(body.endDate).toBe("2026-07-06");
        expect(body.startDate).toBe("2026-06-08"); // 28 days before

        const [upsertSql, upsertParams] = query.mock.calls[0];
        expect(upsertSql).toContain("INSERT INTO keyword_rankings");
        expect(upsertSql).toContain("ON CONFLICT (keyword, page, locale, captured_at) DO UPDATE");
        expect(upsertParams).toEqual([
          "2bhk flat noida",
          "https://cribliv.com/en/city/noida",
          "en",
          "noida",
          8.5,
          300,
          12,
          0.04,
          "2026-07-06"
        ]);

        const [, secondParams] = query.mock.calls[1];
        expect(secondParams).toEqual([
          "pg near sector 62",
          "https://cribliv.com/hi/city/noida",
          "hi",
          "noida",
          22.1,
          150,
          3,
          0.02,
          "2026-07-06"
        ]);
      });

      it("defaults locale to en and city_slug to null for non-city-hub pages", async () => {
        fetchMock
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              rows: [
                {
                  keys: ["rent flat lucknow", "https://cribliv.com/blog/renting-guide"],
                  clicks: 1,
                  impressions: 20,
                  ctr: 0.05,
                  position: 15
                }
              ]
            })
          })
          .mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
        query.mockResolvedValue({ rows: [] });

        const service = new GscService(database as never, auth as never, fetchMock as never);
        await service.pollAndUpsert("2026-07-06");

        const [, params] = query.mock.calls[0];
        expect(params[2]).toBe("en");
        expect(params[3]).toBeNull();
      });

      it("pages up to 5 times and stops even if Google keeps returning full pages", async () => {
        const fullPage = {
          ok: true,
          json: async () => ({
            rows: [
              {
                keys: ["k", "https://cribliv.com/en/city/noida"],
                clicks: 1,
                impressions: 10,
                ctr: 0.1,
                position: 5
              }
            ]
          })
        };
        fetchMock.mockResolvedValue(fullPage);
        query.mockResolvedValue({ rows: [] });

        const service = new GscService(database as never, auth as never, fetchMock as never);
        const result = await service.pollAndUpsert("2026-07-06");

        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(result.pagesRead).toBe(5);
      });

      it("never throws when Google returns a non-OK response — logs and returns partial counts", async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "forbidden" });

        const service = new GscService(database as never, auth as never, fetchMock as never);
        await expect(service.pollAndUpsert("2026-07-06")).resolves.toEqual({
          rowsUpserted: 0,
          pagesRead: 0
        });
      });

      it("never throws when auth itself fails", async () => {
        auth.getAccessToken = vi.fn(async () => {
          throw new Error("auth exploded");
        });
        const service = new GscService(database as never, auth as never, fetchMock as never);

        await expect(service.pollAndUpsert("2026-07-06")).resolves.toEqual({
          rowsUpserted: 0,
          pagesRead: 0
        });
      });

      it("defaults captured_at to today (UTC date) when not provided", async () => {
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ rows: [] }) });
        const service = new GscService(database as never, auth as never, fetchMock as never);

        await service.pollAndUpsert();

        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(init.body);
        expect(body.endDate).toBe(new Date().toISOString().slice(0, 10));
      });
    });

    describe("fetchCoverage", () => {
      it("returns nulls without querying Google when DB is disabled", async () => {
        database = { isEnabled: () => false, query };
        const service = new GscService(database as never, auth as never, fetchMock as never);

        await expect(service.fetchCoverage()).resolves.toEqual({
          indexed_count: null,
          submitted_count: null
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("derives indexed_count/submitted_count from the local seo_indexing_queue + keyword_rankings tables (no separate Google coverage call needed)", async () => {
        query
          .mockResolvedValueOnce({ rows: [{ count: 42 }] }) // distinct pages in keyword_rankings
          .mockResolvedValueOnce({ rows: [{ count: 7 }] }); // submitted count in seo_indexing_queue
        const service = new GscService(database as never, auth as never, fetchMock as never);

        await expect(service.fetchCoverage()).resolves.toEqual({
          indexed_count: 42,
          submitted_count: 7
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });
  });
  ```

- [ ] Run it and confirm it fails because the module does not exist:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/__tests__/gsc.service.test.ts`
      Expected: `Cannot find module '../gsc.service'`.
- [ ] Write `apps/api/src/modules/seo/gsc.service.ts`:

  ```ts
  import { Injectable, Logger } from "@nestjs/common";
  import { DatabaseService } from "../../common/database.service";
  import { readFeatureFlags } from "../../config/feature-flags";
  import { GoogleServiceAuth } from "./google/google-service-auth";

  const READONLY_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
  const ROW_LIMIT = 5000;
  const MAX_PAGES = 5;
  const LOOKBACK_DAYS = 28;
  const CITY_HUB_PATTERN = /\/(en|hi)\/city\/([a-z0-9-]+)/;

  interface GscQueryRow {
    keys: [string, string]; // [query, page]
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }

  export interface KeywordRankingRow {
    keyword: string;
    page: string;
    locale: string;
    city_slug: string | null;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    captured_at: string;
  }

  function isoDateDaysAgo(isoDate: string, days: number): string {
    const d = new Date(`${isoDate}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  }

  function deriveLocaleAndCity(page: string): { locale: string; city_slug: string | null } {
    const match = page.match(CITY_HUB_PATTERN);
    if (match) {
      return { locale: match[1], city_slug: match[2] };
    }
    return { locale: "en", city_slug: null };
  }

  @Injectable()
  export class GscService {
    private readonly logger = new Logger(GscService.name);
    private readonly fetchImpl: typeof fetch;

    constructor(
      private readonly database: DatabaseService,
      private readonly auth: GoogleServiceAuth,
      fetchImpl: typeof fetch = fetch
    ) {
      this.fetchImpl = fetchImpl;
    }

    /**
     * Polls GSC searchanalytics.query for the last 28 days, dims [query, page],
     * and upserts every row into keyword_rankings keyed on captured_at (default
     * today) — a re-run for the same day updates that day's snapshot in place
     * (idempotent). Never throws: any Google/auth/DB error is logged and the
     * method returns whatever it managed to upsert before the failure.
     */
    async pollAndUpsert(capturedAt?: string): Promise<{ rowsUpserted: number; pagesRead: number }> {
      if (!readFeatureFlags().ff_seo_gsc) {
        return { rowsUpserted: 0, pagesRead: 0 };
      }

      const endDate = capturedAt ?? new Date().toISOString().slice(0, 10);
      const startDate = isoDateDaysAgo(endDate, LOOKBACK_DAYS);
      const siteUrl = process.env.GSC_SITE_URL ?? "";

      let rowsUpserted = 0;
      let pagesRead = 0;

      try {
        const token = await this.auth.getAccessToken([READONLY_SCOPE]);

        for (let page = 0; page < MAX_PAGES; page++) {
          const response = await this.fetchImpl(
            `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                startDate,
                endDate,
                dimensions: ["query", "page"],
                rowLimit: ROW_LIMIT,
                startRow: page * ROW_LIMIT
              })
            }
          );

          if (!response.ok) {
            const detail = await response.text().catch(() => "");
            this.logger.warn(`GSC searchanalytics.query failed (${response.status}): ${detail}`);
            break;
          }

          const body = (await response.json()) as { rows?: GscQueryRow[] };
          const rows = body.rows ?? [];
          if (rows.length === 0) {
            break;
          }

          pagesRead += 1;

          for (const row of rows) {
            const [keyword, gscPage] = row.keys;
            const { locale, city_slug } = deriveLocaleAndCity(gscPage);
            await this.database.query(
              `INSERT INTO keyword_rankings
                 (keyword, page, locale, city_slug, position, impressions, clicks, ctr, captured_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               ON CONFLICT (keyword, page, locale, captured_at) DO UPDATE SET
                 city_slug = EXCLUDED.city_slug,
                 position = EXCLUDED.position,
                 impressions = EXCLUDED.impressions,
                 clicks = EXCLUDED.clicks,
                 ctr = EXCLUDED.ctr`,
              [
                keyword,
                gscPage,
                locale,
                city_slug,
                row.position,
                row.impressions,
                row.clicks,
                row.ctr,
                endDate
              ]
            );
            rowsUpserted += 1;
          }

          if (rows.length < ROW_LIMIT) {
            break; // last page was partial — nothing more to fetch
          }
        }
      } catch (err) {
        this.logger.warn(
          `gsc_poller: aborting mid-run: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      return { rowsUpserted, pagesRead };
    }

    /**
     * Lightweight "coverage" numbers for the admin dashboard, derived entirely
     * from our own tables (not a separate Google Search Console Index Coverage
     * API call — that API is UI-only with no public REST endpoint as of this
     * writing). indexed_count = distinct pages we have ANY ranking data for;
     * submitted_count = how many URLs we've successfully pushed via the
     * Indexing API. Together these approximate "is Google finding our pages."
     */
    async fetchCoverage(): Promise<{
      indexed_count: number | null;
      submitted_count: number | null;
    }> {
      if (!this.database.isEnabled()) {
        return { indexed_count: null, submitted_count: null };
      }

      const [indexed, submitted] = await Promise.all([
        this.database.query<{ count: number }>(
          `SELECT count(DISTINCT page)::int AS count FROM keyword_rankings`,
          []
        ),
        this.database.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM seo_indexing_queue WHERE status = 'submitted'`,
          []
        )
      ]);

      return {
        indexed_count: indexed.rows[0]?.count ?? 0,
        submitted_count: submitted.rows[0]?.count ?? 0
      };
    }
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/__tests__/gsc.service.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  11 passed (11)`.
- [ ] Register `GscService` in `apps/api/src/modules/seo/seo.module.ts` (add to both `providers` and `exports` arrays, alongside `IndexingService`):
  ```ts
  import { GscService } from "./gsc.service";
  ```
  ```ts
  @Module({
    controllers: [SeoController],
    providers: [
      SeoAggregatesService,
      SeoCityConfigService,
      SeoCopyService,
      GoogleServiceAuth,
      IndexingService,
      GscService
    ],
    exports: [
      SeoAggregatesService,
      SeoCityConfigService,
      SeoCopyService,
      GoogleServiceAuth,
      IndexingService,
      GscService
    ]
  })
  export class SeoModule {}
  ```
- [ ] Run the full suite once more to confirm the module wiring is clean:
      `pnpm --filter @cribliv/api exec vitest run test/ src/ --reporter=dot 2>&1 | tail -30`
      Expected: no new failures.
- [ ] Commit:

  ```
  git add apps/api/src/modules/seo/gsc.service.ts apps/api/src/modules/seo/__tests__/gsc.service.test.ts apps/api/src/modules/seo/seo.module.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add GscService — searchanalytics.query fetch + keyword_rankings upsert

  Polls the last 28 days, dims [query, page], paged in 5000-row batches
  (capped at 5 pages), idempotent per captured_at. fetchCoverage derives
  indexed/submitted counts from our own tables rather than a separate GSC
  coverage call. Gated by FF_SEO_GSC; never throws.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9: Worker — `gsc_poller` weekly job

**Files:**

- Modify: `apps/api/src/worker/worker.ts`
- Test: `apps/api/test/worker-gsc-poller.test.ts`

**Interfaces:**

- Produces: exported `async function runGscPollerJob(pool: Pool): Promise<{ rowsUpserted: number; pagesRead: number }>` — same `Pool`-adapter pattern as `runIndexingSubmitterJob`, constructs `GscService` with a real `GoogleServiceAuth` and calls `pollAndUpsert()` (no explicit `capturedAt` — defaults to today, matching production behavior).
- Adds: `const GSC_POLLER_MS = 7 * 24 * 60 * 60 * 1000; // weekly` and a `setInterval(runGscPoller, GSC_POLLER_MS)` block inside the `if (pool) { ... }` section, run-once at boot (so a fresh deploy doesn't wait a full week for first data — matches the `runPgTtl`/`runIndexingSubmitter` "run once at startup too" convention), plus `"gsc_poller"` appended to the startup `jobs: [...]` log array.
- Consumes: Task 8's `GscService`.

Steps:

- [ ] Write the failing unit test at `apps/api/test/worker-gsc-poller.test.ts`:

  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { runGscPollerJob } from "../src/worker/worker";

  const FAKE_KEY = {
    client_email: "seo-worker@cribliv-seo.iam.gserviceaccount.com",
    private_key_id: "abc123",
    private_key:
      "-----BEGIN PRIVATE KEY-----\n" +
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7VJTUt9Us8cKj\n" +
      "MzEfYyjiWA4R4/M2bS1GB4t7NXp98C3SC6dVMvDuictGeurT8jNbvJZHtCSuYEvu\n" +
      "NMoSfm76oqFvAp8Gy0iz5sxjZmSnXyCdPEovGhLa0VzMaQ8s+CLOyS56YyCFGeJZ\n" +
      "qgtzJ6GR3eqoYSW9b9UMvkBpZODSctWSNGj3P7jRFDO5VoTwCQAWbFnOjDfH5Ulg\n" +
      "p2PKSQnSJP3AJLQNFNe7br1XbrhV//eO+t51mIpGSDCUv3E0DDFcWDTH9cXDTTlR\n" +
      "ZVEiR2BwpZOOkE/Z0/BVnhZYL721itYuwEuY9RSmnGXGjBqzhskn3fV0aME21XFB\n" +
      "l87yWyR6AgMBAAECggEAB4wsz5S9SBHnJj0j2Ubx3RpcJz9SnYDBqW0LfLLRUS3q\n" +
      "8mLzRzOENfXW5xJKRvKZoYCLmr9Aq+Kj3IhV1BbHUXO1L4L1Vh4nY9RtV2Nl+SF3\n" +
      "u+HrfF+O1TKtF5nUL2sSw8OiGgxDx8bA3T0GaZ0X9WCCEXGnzY6R0TZlEwR+3Ncy\n" +
      "SdKZHhAWlSc0K1zNaEfBhK1r9wY0XKzY0hDkOyIzuRZ4b2v9wNwTL1w9RaJXtQMt\n" +
      "z+8OtSaX0m+8FhLtFm/rqSAkK/DrDPWScS6UunOd3PDOn6IzhZgVIn41BblT6uH9\n" +
      "6/z6X7pxZP1QDXxa5nCiLXWQ4gDXaZmPWfy+r0MCkQKBgQD3Zj7iZbmYlKq7t0nQ\n" +
      "3TCLl0y4d0h5oj6iP0G9jGflQ+8mSFHf6qJvFTOPaVQOswiy5jNZ48OTCzM4v+Z9\n" +
      "N6YRc4x+7NglTOWZjXKQmpP3EEGVh7dcQwZK9m+YFV9MFwrLGKfQpTXsHgAyRuUv\n" +
      "hj1jbiHnh1nUeXXOb2xKX6yPRQKBgQDBk8DzYqEXQfL6vqDdOFXaTPnMoypq3/EW\n" +
      "wLLGH+xEDPB2rTQOsHrpJqp4c9gyiZAV+bwrDQnwaZeYIrx8OZ5S0v7yiV1x1XkN\n" +
      "R7WhtAb0+Sc5FQ6/9GnT8kJZXW/CZ+X2XblT4tOzTJP2h0i1LKcTqAyq1cVoW1z9\n" +
      "0AjhqZzKlwKBgQDMDPNQduWnpU4Yl0OwsOEnR1U9C+iuFy5rIkOTr0XpMwzcCzHR\n" +
      "K91efQoyj2rWnW7ekaZlF6dEz+7L3fY8ejqRCXwSbHEjS1AeqTk49WluPHkNlY0K\n" +
      "OK8XecT2NqiFcv8fGm6c6DR6E5cGbn9laX0e8mYcnq1Xz9NIe9DzOEyx8QKBgFf5\n" +
      "3g3GvGZOZOe6PA9pOFmWq0YB9wG08cVUM1E4/gNjWFyUBqk9ynnpc5g2WcVLTU5C\n" +
      "6bxdyPYEqxE4M1Y3kW9jH5emhU4M42R7lm/wGmjTELsB6zXlU/UO0EMWr6oIQvXY\n" +
      "TzEeZjD/DhY+KgJZY0EhVXk3AGYXFOEtc+FvVjfLAoGAJvE6d1MZoLbF/DFvS20u\n" +
      "6nzsC1zLb0Q9RmYYQMwvVGvY0kdN9tPd6VJqEfMHqLxSWJ6Ta6P4CJn+0Xg9BjKt\n" +
      "kZLcUx24LGiF3rUp0FVspBpF8KTHOcW3l0Z9dJ0AqzP0z3paQwsWEG5nOgfKLu9C\n" +
      "wEWgOJyPzXcvzR2z+7pcaX0=\n" +
      "-----END PRIVATE KEY-----\n"
  };

  describe("runGscPollerJob", () => {
    let poolQuery: ReturnType<typeof vi.fn>;
    let pool: { query: ReturnType<typeof vi.fn> };
    let originalEnv: { flag?: string; keyJson?: string; site?: string };

    beforeEach(() => {
      poolQuery = vi.fn();
      pool = { query: poolQuery };
      originalEnv = {
        flag: process.env.FF_SEO_GSC,
        keyJson: process.env.GSC_SERVICE_ACCOUNT_JSON,
        site: process.env.GSC_SITE_URL
      };
      process.env.FF_SEO_GSC = "true";
      process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_KEY);
      process.env.GSC_SITE_URL = "sc-domain:cribliv.com";
    });

    afterEach(() => {
      if (originalEnv.flag === undefined) delete process.env.FF_SEO_GSC;
      else process.env.FF_SEO_GSC = originalEnv.flag;
      if (originalEnv.keyJson === undefined) delete process.env.GSC_SERVICE_ACCOUNT_JSON;
      else process.env.GSC_SERVICE_ACCOUNT_JSON = originalEnv.keyJson;
      if (originalEnv.site === undefined) delete process.env.GSC_SITE_URL;
      else process.env.GSC_SITE_URL = originalEnv.site;
      vi.unstubAllGlobals();
    });

    it("polls and upserts via GscService, returning its result shape", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            rows: [
              {
                keys: ["2bhk noida", "https://cribliv.com/en/city/noida"],
                clicks: 5,
                impressions: 100,
                ctr: 0.05,
                position: 10
              }
            ]
          })
        }))
      );
      poolQuery.mockResolvedValue({ rows: [] });

      const result = await runGscPollerJob(pool as never);

      expect(result.pagesRead).toBe(1);
      expect(result.rowsUpserted).toBe(1);
    });

    it("never throws when FF_SEO_GSC is off", async () => {
      process.env.FF_SEO_GSC = "false";

      await expect(runGscPollerJob(pool as never)).resolves.toEqual({
        rowsUpserted: 0,
        pagesRead: 0
      });
      expect(poolQuery).not.toHaveBeenCalled();
    });

    it("never throws when GscService itself throws unexpectedly", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("network down");
        })
      );

      await expect(runGscPollerJob(pool as never)).resolves.toEqual({
        rowsUpserted: 0,
        pagesRead: 0
      });
    });
  });
  ```

- [ ] Run it and confirm it fails because `runGscPollerJob` is not exported:
      `pnpm --filter @cribliv/api exec vitest run test/worker-gsc-poller.test.ts`
      Expected: `SyntaxError: The requested module '../src/worker/worker' does not provide an export named 'runGscPollerJob'`.
- [ ] In `apps/api/src/worker/worker.ts`, add the import next to the existing seo imports:
  ```ts
  import { GscService } from "../modules/seo/gsc.service";
  ```
- [ ] Add the constant near `INDEXING_SUBMITTER_MS`:
  ```ts
  const GSC_POLLER_MS = 7 * 24 * 60 * 60 * 1000; // weekly
  ```
- [ ] Add the exported job function right after `runIndexingSubmitterJob`:
  ```ts
  // ── GSC poller (weekly, gated by FF_SEO_GSC) ─────────────────────────────────
  // Pulls the last 28 days of searchanalytics.query data and upserts into
  // keyword_rankings. Never throws: GscService.pollAndUpsert already swallows
  // Google/auth errors internally; this wrapper also guards against a
  // constructor-time throw (e.g. malformed GSC_SERVICE_ACCOUNT_JSON at read time).
  export async function runGscPollerJob(
    pool: Pool
  ): Promise<{ rowsUpserted: number; pagesRead: number }> {
    try {
      const adapter = {
        isEnabled: () => true,
        query: (text: string, params?: unknown[]) => pool.query(text, params)
      } as unknown as DatabaseService;
      const auth = new GoogleServiceAuth();
      const service = new GscService(adapter, auth);
      return await service.pollAndUpsert();
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "gsc_poller",
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
      return { rowsUpserted: 0, pagesRead: 0 };
    }
  }
  ```
- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run test/worker-gsc-poller.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  3 passed (3)`.
- [ ] Wire it into `run()`'s `if (pool) { ... }` block, right after the `runIndexingSubmitter` block added in Task 7:
  ```ts
  // ── GSC poller (weekly, gated by FF_SEO_GSC) ──
  const runGscPoller = async () => {
    const result = await runGscPollerJob(pool);
    if (result.rowsUpserted > 0 || result.pagesRead > 0) {
      console.log(
        JSON.stringify({
          job: "gsc_poller",
          rows_upserted: result.rowsUpserted,
          pages_read: result.pagesRead,
          timestamp: new Date().toISOString()
        })
      );
    }
  };
  setInterval(runGscPoller, GSC_POLLER_MS);
  void runGscPoller();
  ```
- [ ] Add `"gsc_poller"` to the startup `jobs: [...]` array, right after `"indexing_submitter"`.
- [ ] Run the full worker + seo suite once more:
      `pnpm --filter @cribliv/api exec vitest run test/ src/ --reporter=dot 2>&1 | tail -30`
      Expected: no new failures.
- [ ] Commit:

  ```
  git add apps/api/src/worker/worker.ts apps/api/test/worker-gsc-poller.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add weekly gsc_poller worker job

  Runs once at boot (so a fresh deploy seeds data without waiting a full
  week) then every 7 days, gated by FF_SEO_GSC. Delegates entirely to
  GscService.pollAndUpsert(); never throws out of the worker loop.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10: `SeoSearchService` — DB-only read model for the admin API

**Files:**

- Create: `apps/api/src/modules/seo/seo-search.service.ts`
- Test: `apps/api/src/modules/seo/__tests__/seo-search.service.test.ts`

**Interfaces:**

- Produces:

  ```ts
  export interface SearchPerformanceParams {
    city_slug?: string;
    locale?: string;
    quick_wins?: boolean; // position 11-30, ordered by impressions desc
    limit?: number;
    offset?: number;
  }

  export interface SearchPerformanceRow {
    keyword: string;
    page: string;
    locale: string;
    city_slug: string | null;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    captured_at: string;
    is_target: boolean;
    is_ignored: boolean;
  }

  export interface SearchPerformanceResult {
    items: SearchPerformanceRow[];
    total: number;
    totals: { total_impressions: number; total_clicks: number; avg_position: number | null };
  }

  export class SeoSearchService {
    constructor(database: DatabaseService, gsc: GscService);
    async getSearchPerformance(params: SearchPerformanceParams): Promise<SearchPerformanceResult>;
    async exportSearchPerformanceCsv(params: SearchPerformanceParams): Promise<string>;
    async getCoverage(): Promise<{ indexed_count: number | null; submitted_count: number | null }>;
    async getIndexingQueueSummary(): Promise<{
      counts_by_status: Record<string, number>;
      submitted_today: number;
      daily_quota: number;
    }>;
  }
  ```

- Consumes: `DatabaseService` directly for `keyword_rankings` reads (quick-wins filter = `position BETWEEN 11 AND 30`, ordered by `impressions DESC`), `GscService.fetchCoverage()` for `getCoverage()`, and `DatabaseService` again for `getIndexingQueueSummary()`'s status-count aggregation plus env `GOOGLE_INDEXING_DAILY_QUOTA` for the `daily_quota` field. Reads `keyword_rankings` filtered to the **most recent `captured_at` per (keyword, page, locale)** — a "latest snapshot" view, not every historical row — via a `DISTINCT ON` query.
- Consumed by: Task 11 (`AdminSeoSearchController` calls all four methods directly, no extra service layer).

Steps:

- [ ] Write the failing unit test at `apps/api/src/modules/seo/__tests__/seo-search.service.test.ts`:

  ```ts
  import { beforeEach, describe, expect, it, vi } from "vitest";
  import { SeoSearchService } from "../seo-search.service";

  const ROW = {
    keyword: "2bhk noida",
    page: "/en/city/noida",
    locale: "en",
    city_slug: "noida",
    position: 14.2,
    impressions: 320,
    clicks: 18,
    ctr: 0.056,
    captured_at: "2026-07-06",
    is_target: false,
    is_ignored: false
  };

  describe("SeoSearchService", () => {
    let query: ReturnType<typeof vi.fn>;
    let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
    let gsc: { fetchCoverage: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      query = vi.fn();
      database = { isEnabled: () => true, query };
      gsc = { fetchCoverage: vi.fn(async () => ({ indexed_count: 10, submitted_count: 4 })) };
    });

    describe("getSearchPerformance", () => {
      it("returns empty result without querying when DB is disabled", async () => {
        database = { isEnabled: () => false, query };
        const service = new SeoSearchService(database as never, gsc as never);

        await expect(service.getSearchPerformance({})).resolves.toEqual({
          items: [],
          total: 0,
          totals: { total_impressions: 0, total_clicks: 0, avg_position: null }
        });
        expect(query).not.toHaveBeenCalled();
      });

      it("queries the latest snapshot per (keyword, page, locale) with no filters", async () => {
        query
          .mockResolvedValueOnce({ rows: [ROW], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [{ count: 1 }] })
          .mockResolvedValueOnce({
            rows: [{ total_impressions: 320, total_clicks: 18, avg_position: 14.2 }]
          });
        const service = new SeoSearchService(database as never, gsc as never);

        const result = await service.getSearchPerformance({});

        expect(result.items).toEqual([ROW]);
        expect(result.total).toBe(1);
        expect(result.totals).toEqual({
          total_impressions: 320,
          total_clicks: 18,
          avg_position: 14.2
        });

        const [sql] = query.mock.calls[0];
        expect(sql).toContain("DISTINCT ON (keyword, page, locale)");
        expect(sql).toContain("ORDER BY keyword, page, locale, captured_at DESC");
      });

      it("filters to quick-wins (position 11-30) ordered by impressions desc", async () => {
        query
          .mockResolvedValueOnce({ rows: [ROW], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [{ count: 1 }] })
          .mockResolvedValueOnce({
            rows: [{ total_impressions: 320, total_clicks: 18, avg_position: 14.2 }]
          });
        const service = new SeoSearchService(database as never, gsc as never);

        await service.getSearchPerformance({ quick_wins: true });

        const [sql] = query.mock.calls[0];
        expect(sql).toContain("position BETWEEN 11 AND 30");
        expect(sql).toContain("impressions DESC");
      });

      it("filters by city_slug and locale together", async () => {
        query
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [{ count: 0 }] })
          .mockResolvedValueOnce({
            rows: [{ total_impressions: 0, total_clicks: 0, avg_position: null }]
          });
        const service = new SeoSearchService(database as never, gsc as never);

        await service.getSearchPerformance({ city_slug: "noida", locale: "hi" });

        const [sql, params] = query.mock.calls[0];
        expect(sql).toContain("city_slug = ");
        expect(sql).toContain("locale = ");
        expect(params).toEqual(expect.arrayContaining(["noida", "hi"]));
      });

      it("clamps limit to a max of 500 and defaults to 100", async () => {
        query
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [{ count: 0 }] })
          .mockResolvedValueOnce({
            rows: [{ total_impressions: 0, total_clicks: 0, avg_position: null }]
          });
        const service = new SeoSearchService(database as never, gsc as never);

        await service.getSearchPerformance({ limit: 5000 });
        let [, params] = query.mock.calls[0];
        expect(params).toContain(500);

        query.mockClear();
        query
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [{ count: 0 }] })
          .mockResolvedValueOnce({
            rows: [{ total_impressions: 0, total_clicks: 0, avg_position: null }]
          });
        await service.getSearchPerformance({});
        [, params] = query.mock.calls[0];
        expect(params).toContain(100);
      });
    });

    describe("exportSearchPerformanceCsv", () => {
      it("returns a header-only CSV without querying when DB is disabled", async () => {
        database = { isEnabled: () => false, query };
        const service = new SeoSearchService(database as never, gsc as never);

        const csv = await service.exportSearchPerformanceCsv({});
        expect(csv).toBe(
          "keyword,page,locale,city_slug,position,impressions,clicks,ctr,captured_at\n"
        );
        expect(query).not.toHaveBeenCalled();
      });

      it("renders rows as CSV with a header line", async () => {
        query.mockResolvedValueOnce({ rows: [ROW], rowCount: 1 });
        const service = new SeoSearchService(database as never, gsc as never);

        const csv = await service.exportSearchPerformanceCsv({});
        const lines = csv.trim().split("\n");
        expect(lines[0]).toBe(
          "keyword,page,locale,city_slug,position,impressions,clicks,ctr,captured_at"
        );
        expect(lines[1]).toBe("2bhk noida,/en/city/noida,en,noida,14.2,320,18,0.056,2026-07-06");
      });

      it("quotes fields containing commas", async () => {
        query.mockResolvedValueOnce({
          rows: [{ ...ROW, keyword: "2bhk, noida sector 62" }],
          rowCount: 1
        });
        const service = new SeoSearchService(database as never, gsc as never);

        const csv = await service.exportSearchPerformanceCsv({});
        expect(csv).toContain('"2bhk, noida sector 62"');
      });
    });

    describe("getCoverage", () => {
      it("delegates to GscService.fetchCoverage", async () => {
        const service = new SeoSearchService(database as never, gsc as never);
        await expect(service.getCoverage()).resolves.toEqual({
          indexed_count: 10,
          submitted_count: 4
        });
        expect(gsc.fetchCoverage).toHaveBeenCalledTimes(1);
      });
    });

    describe("getIndexingQueueSummary", () => {
      it("returns zeroed summary without querying when DB is disabled", async () => {
        database = { isEnabled: () => false, query };
        const service = new SeoSearchService(database as never, gsc as never);

        await expect(service.getIndexingQueueSummary()).resolves.toEqual({
          counts_by_status: {},
          submitted_today: 0,
          daily_quota: 200
        });
      });

      it("aggregates counts by status and reads GOOGLE_INDEXING_DAILY_QUOTA", async () => {
        const original = process.env.GOOGLE_INDEXING_DAILY_QUOTA;
        process.env.GOOGLE_INDEXING_DAILY_QUOTA = "50";
        try {
          query
            .mockResolvedValueOnce({
              rows: [
                { status: "pending", count: 12 },
                { status: "submitted", count: 30 },
                { status: "failed", count: 2 }
              ]
            })
            .mockResolvedValueOnce({ rows: [{ count: 5 }] });
          const service = new SeoSearchService(database as never, gsc as never);

          await expect(service.getIndexingQueueSummary()).resolves.toEqual({
            counts_by_status: { pending: 12, submitted: 30, failed: 2 },
            submitted_today: 5,
            daily_quota: 50
          });
        } finally {
          if (original === undefined) delete process.env.GOOGLE_INDEXING_DAILY_QUOTA;
          else process.env.GOOGLE_INDEXING_DAILY_QUOTA = original;
        }
      });
    });
  });
  ```

- [ ] Run it and confirm it fails because the module does not exist:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/__tests__/seo-search.service.test.ts`
      Expected: `Cannot find module '../seo-search.service'`.
- [ ] Write `apps/api/src/modules/seo/seo-search.service.ts`:

  ```ts
  import { Injectable } from "@nestjs/common";
  import { DatabaseService } from "../../common/database.service";
  import { GscService } from "./gsc.service";

  const DEFAULT_LIMIT = 100;
  const MAX_LIMIT = 500;
  const DEFAULT_DAILY_QUOTA = 200;

  export interface SearchPerformanceParams {
    city_slug?: string;
    locale?: string;
    quick_wins?: boolean;
    limit?: number;
    offset?: number;
  }

  export interface SearchPerformanceRow {
    keyword: string;
    page: string;
    locale: string;
    city_slug: string | null;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    captured_at: string;
    is_target: boolean;
    is_ignored: boolean;
  }

  export interface SearchPerformanceResult {
    items: SearchPerformanceRow[];
    total: number;
    totals: { total_impressions: number; total_clicks: number; avg_position: number | null };
  }

  const ROW_COLUMNS = `keyword, page, locale, city_slug, position, impressions, clicks, ctr,
       captured_at::text AS captured_at, is_target, is_ignored`;

  function csvField(value: unknown): string {
    const str = String(value ?? "");
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }

  @Injectable()
  export class SeoSearchService {
    constructor(
      private readonly database: DatabaseService,
      private readonly gsc: GscService
    ) {}

    /** Builds the shared WHERE clause + params for the "latest snapshot per
     *  (keyword, page, locale)" view used by both getSearchPerformance and
     *  exportSearchPerformanceCsv, so the two can never drift out of sync. */
    private buildFilteredQuery(params: SearchPerformanceParams): { sql: string; args: unknown[] } {
      const conditions: string[] = [];
      const args: unknown[] = [];

      if (params.city_slug) {
        args.push(params.city_slug);
        conditions.push(`city_slug = $${args.length}`);
      }
      if (params.locale) {
        args.push(params.locale);
        conditions.push(`locale = $${args.length}`);
      }
      if (params.quick_wins) {
        conditions.push(`position BETWEEN 11 AND 30`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const orderClause = params.quick_wins
        ? "ORDER BY impressions DESC"
        : "ORDER BY captured_at DESC, impressions DESC";

      const sql = `
        SELECT ${ROW_COLUMNS} FROM (
          SELECT DISTINCT ON (keyword, page, locale) ${ROW_COLUMNS}
          FROM keyword_rankings
          ORDER BY keyword, page, locale, captured_at DESC
        ) latest
        ${whereClause}
        ${orderClause}
      `;

      return { sql, args };
    }

    async getSearchPerformance(params: SearchPerformanceParams): Promise<SearchPerformanceResult> {
      if (!this.database.isEnabled()) {
        return {
          items: [],
          total: 0,
          totals: { total_impressions: 0, total_clicks: 0, avg_position: null }
        };
      }

      const limit = Math.min(MAX_LIMIT, Math.max(1, params.limit ?? DEFAULT_LIMIT));
      const offset = Math.max(0, params.offset ?? 0);
      const { sql, args } = this.buildFilteredQuery(params);

      const pagedArgs = [...args, limit, offset];
      const limitIdx = args.length + 1;
      const offsetIdx = args.length + 2;

      const { rows } = await this.database.query<SearchPerformanceRow>(
        `${sql} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        pagedArgs
      );

      const { rows: countRows } = await this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM (${sql}) counted`,
        args
      );

      const { rows: totalsRows } = await this.database.query<{
        total_impressions: number;
        total_clicks: number;
        avg_position: number | null;
      }>(
        `SELECT
           COALESCE(sum(impressions), 0)::int AS total_impressions,
           COALESCE(sum(clicks), 0)::int AS total_clicks,
           avg(position) AS avg_position
         FROM (${sql}) totalled`,
        args
      );

      return {
        items: rows,
        total: countRows[0]?.count ?? 0,
        totals: totalsRows[0] ?? { total_impressions: 0, total_clicks: 0, avg_position: null }
      };
    }

    async exportSearchPerformanceCsv(params: SearchPerformanceParams): Promise<string> {
      const header = "keyword,page,locale,city_slug,position,impressions,clicks,ctr,captured_at\n";
      if (!this.database.isEnabled()) {
        return header;
      }

      const { sql, args } = this.buildFilteredQuery(params);
      const { rows } = await this.database.query<SearchPerformanceRow>(sql, args);

      const lines = rows.map((row) =>
        [
          row.keyword,
          row.page,
          row.locale,
          row.city_slug ?? "",
          row.position,
          row.impressions,
          row.clicks,
          row.ctr,
          row.captured_at
        ]
          .map(csvField)
          .join(",")
      );

      return header + lines.join("\n") + (lines.length ? "\n" : "");
    }

    async getCoverage(): Promise<{ indexed_count: number | null; submitted_count: number | null }> {
      return this.gsc.fetchCoverage();
    }

    async getIndexingQueueSummary(): Promise<{
      counts_by_status: Record<string, number>;
      submitted_today: number;
      daily_quota: number;
    }> {
      const dailyQuota = Number(process.env.GOOGLE_INDEXING_DAILY_QUOTA) || DEFAULT_DAILY_QUOTA;

      if (!this.database.isEnabled()) {
        return { counts_by_status: {}, submitted_today: 0, daily_quota: dailyQuota };
      }

      const { rows: statusRows } = await this.database.query<{ status: string; count: number }>(
        `SELECT status, count(*)::int AS count FROM seo_indexing_queue GROUP BY status`,
        []
      );
      const countsByStatus = Object.fromEntries(statusRows.map((r) => [r.status, r.count]));

      const { rows: todayRows } = await this.database.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM seo_indexing_queue
         WHERE status = 'submitted' AND submitted_at >= date_trunc('day', now())`,
        []
      );

      return {
        counts_by_status: countsByStatus,
        submitted_today: todayRows[0]?.count ?? 0,
        daily_quota: dailyQuota
      };
    }
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/__tests__/seo-search.service.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  13 passed (13)`.
- [ ] Register `SeoSearchService` in `apps/api/src/modules/seo/seo.module.ts` (final version of this file for this plan — add to both arrays):

  ```ts
  import { Module } from "@nestjs/common";
  import { SeoController } from "./seo.controller";
  import { SeoAggregatesService } from "./seo-aggregates.service";
  import { SeoCityConfigService } from "./seo-city-config.service";
  import { SeoCopyService } from "./seo-copy.service";
  import { GoogleServiceAuth } from "./google/google-service-auth";
  import { IndexingService } from "./indexing.service";
  import { GscService } from "./gsc.service";
  import { SeoSearchService } from "./seo-search.service";

  @Module({
    controllers: [SeoController],
    providers: [
      SeoAggregatesService,
      SeoCityConfigService,
      SeoCopyService,
      GoogleServiceAuth,
      IndexingService,
      GscService,
      SeoSearchService
    ],
    exports: [
      SeoAggregatesService,
      SeoCityConfigService,
      SeoCopyService,
      GoogleServiceAuth,
      IndexingService,
      GscService,
      SeoSearchService
    ]
  })
  export class SeoModule {}
  ```

- [ ] Run the full API suite once more:
      `pnpm --filter @cribliv/api exec vitest run test/ src/ --reporter=dot 2>&1 | tail -30`
      Expected: no new failures.
- [ ] Commit:

  ```
  git add apps/api/src/modules/seo/seo-search.service.ts apps/api/src/modules/seo/__tests__/seo-search.service.test.ts apps/api/src/modules/seo/seo.module.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add SeoSearchService — DB-only read model for admin search performance

  Latest-snapshot-per-(keyword,page,locale) view over keyword_rankings with
  city/locale/quick-wins (position 11-30) filters, CSV export, coverage
  (delegates to GscService), and indexing-queue status summary vs quota.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 11: `AdminSeoSearchController` — audited admin endpoints

**Files:**

- Create: `apps/api/src/modules/admin/admin-seo-search.controller.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts`
- Test: `apps/api/test/admin-seo-search.controller.test.ts`

**Interfaces:**

- Produces routes (all `@Controller("admin/seo")`, `@UseGuards(AuthGuard, RolesGuard)`, `@Roles("admin")` — same class-level decorators as `AdminSeoController`, but a **separate controller class** so Task 10's dependency injection stays scoped and this file doesn't grow `AdminSeoController` past its current single responsibility):
  - `GET /admin/seo/search-performance?city_slug=&locale=&quick_wins=&limit=&offset=` → `ok(SearchPerformanceResult)`
  - `GET /admin/seo/search-performance/export?city_slug=&locale=&quick_wins=` → raw `text/csv` via `@Res()`, same pattern as `LeadsController.exportCsv`
  - `GET /admin/seo/indexing-queue?status=&limit=&offset=` → `ok({ items, total, summary: { counts_by_status, submitted_today, daily_quota } })` (composes `IndexingService.listQueue` + `SeoSearchService.getIndexingQueueSummary`)
  - `POST /admin/seo/indexing-queue` body `{ url: string; reason?: string }` → `ok(SeoIndexingQueueRow)`, audited action `submit_indexing_url`
  - `POST /admin/seo/indexing-queue/:id/retry` → `ok(SeoIndexingQueueRow)`, audited action `retry_indexing_url`, 404 if the row doesn't exist
  - `GET /admin/seo/coverage` → `ok({ indexed_count, submitted_count })`
- Consumes: `SeoSearchService`, `IndexingService` (both already exported from `SeoModule`, already imported into `AdminModule` — no new module import needed), `DatabaseService` (for the `admin_actions` audit insert, matching `AdminSeoController.toggleCity`'s exact insert shape but with `target_type = 'seo_indexing_queue'` and `action = 'submit_indexing_url'` / `'retry_indexing_url'`). Unlike `AdminSeoController.toggleCity` (which hashes a city _slug_ through `deterministicUuidV5` to get a `target_id`), this controller's `target_id` is the queue row's own `id` column — already a real UUID — passed straight through with no hashing helper needed.
- Consumed by: Task 12 (web `admin-api.ts` client functions call these 6 routes).

Steps:

- [ ] Write the failing test at `apps/api/test/admin-seo-search.controller.test.ts`:

  ```ts
  import "reflect-metadata";
  import type { INestApplication } from "@nestjs/common";
  import { NotFoundException } from "@nestjs/common";
  import { Test } from "@nestjs/testing";
  import request from "supertest";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { AuthGuard } from "../src/common/auth.guard";
  import { DatabaseService } from "../src/common/database.service";
  import { RolesGuard } from "../src/common/roles.guard";
  import type { Role } from "../src/common/types";
  import { AdminSeoSearchController } from "../src/modules/admin/admin-seo-search.controller";
  import { IndexingService } from "../src/modules/seo/indexing.service";
  import { SeoSearchService } from "../src/modules/seo/seo-search.service";

  const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
  const QUEUE_ROW = {
    id: "00000000-0000-4000-8000-0000000000bb",
    url: "https://cribliv.com/en/city/noida",
    status: "pending",
    reason: "city_enabled",
    attempts: 0,
    submitted_at: null,
    response: null,
    created_at: "2026-07-06T00:00:00.000Z",
    updated_at: "2026-07-06T00:00:00.000Z"
  };
  const PERFORMANCE_RESULT = {
    items: [
      {
        keyword: "2bhk noida",
        page: "/en/city/noida",
        locale: "en",
        city_slug: "noida",
        position: 14.2,
        impressions: 320,
        clicks: 18,
        ctr: 0.056,
        captured_at: "2026-07-06",
        is_target: false,
        is_ignored: false
      }
    ],
    total: 1,
    totals: { total_impressions: 320, total_clicks: 18, avg_position: 14.2 }
  };

  describe("AdminSeoSearchController", () => {
    let app: INestApplication;
    let currentUser: { id: string; role: Role };
    let seoSearch: {
      getSearchPerformance: ReturnType<typeof vi.fn>;
      exportSearchPerformanceCsv: ReturnType<typeof vi.fn>;
      getCoverage: ReturnType<typeof vi.fn>;
      getIndexingQueueSummary: ReturnType<typeof vi.fn>;
    };
    let indexing: {
      listQueue: ReturnType<typeof vi.fn>;
      enqueue: ReturnType<typeof vi.fn>;
      retry: ReturnType<typeof vi.fn>;
    };
    let database: { query: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
      currentUser = { id: ADMIN_ID, role: "admin" };
      seoSearch = {
        getSearchPerformance: vi.fn(async () => PERFORMANCE_RESULT),
        exportSearchPerformanceCsv: vi.fn(async () => "keyword,page\nfoo,bar\n"),
        getCoverage: vi.fn(async () => ({ indexed_count: 10, submitted_count: 4 })),
        getIndexingQueueSummary: vi.fn(async () => ({
          counts_by_status: { pending: 1 },
          submitted_today: 0,
          daily_quota: 200
        }))
      };
      indexing = {
        listQueue: vi.fn(async () => ({ items: [QUEUE_ROW], total: 1 })),
        enqueue: vi.fn(async () => QUEUE_ROW),
        retry: vi.fn(async () => QUEUE_ROW)
      };
      database = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })) };

      const moduleRef = await Test.createTestingModule({
        controllers: [AdminSeoSearchController],
        providers: [
          RolesGuard,
          { provide: SeoSearchService, useValue: seoSearch },
          { provide: IndexingService, useValue: indexing },
          { provide: DatabaseService, useValue: database }
        ]
      })
        .overrideGuard(AuthGuard)
        .useValue({
          canActivate: (ctx: { switchToHttp: () => { getRequest: () => { user: unknown } } }) => {
            ctx.switchToHttp().getRequest().user = currentUser;
            return true;
          }
        })
        .compile();

      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterEach(async () => {
      await app?.close();
    });

    it("forbids tenants on every route", async () => {
      currentUser = { id: "tenant-1", role: "tenant" };
      await request(app.getHttpServer()).get("/admin/seo/search-performance").expect(403);
      await request(app.getHttpServer()).get("/admin/seo/indexing-queue").expect(403);
      await request(app.getHttpServer())
        .post("/admin/seo/indexing-queue")
        .send({ url: "https://cribliv.com/x" })
        .expect(403);
    });

    it("returns search performance with query filters forwarded", async () => {
      await request(app.getHttpServer())
        .get("/admin/seo/search-performance")
        .query({ city_slug: "noida", locale: "en", quick_wins: "true", limit: "20", offset: "0" })
        .expect(200)
        .expect({ data: PERFORMANCE_RESULT });

      expect(seoSearch.getSearchPerformance).toHaveBeenCalledWith({
        city_slug: "noida",
        locale: "en",
        quick_wins: true,
        limit: 20,
        offset: 0
      });
    });

    it("exports search performance as CSV with the right content type", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/seo/search-performance/export")
        .query({ quick_wins: "true" })
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toContain("search-performance.csv");
      expect(res.text).toBe("keyword,page\nfoo,bar\n");
      expect(seoSearch.exportSearchPerformanceCsv).toHaveBeenCalledWith({ quick_wins: true });
    });

    it("lists the indexing queue with a summary", async () => {
      await request(app.getHttpServer())
        .get("/admin/seo/indexing-queue")
        .query({ status: "pending" })
        .expect(200)
        .expect({
          data: {
            items: [QUEUE_ROW],
            total: 1,
            summary: { counts_by_status: { pending: 1 }, submitted_today: 0, daily_quota: 200 }
          }
        });

      expect(indexing.listQueue).toHaveBeenCalledWith({
        status: "pending",
        limit: undefined,
        offset: undefined
      });
    });

    it("manually submits a URL and writes an audited admin action", async () => {
      await request(app.getHttpServer())
        .post("/admin/seo/indexing-queue")
        .send({ url: "https://cribliv.com/en/city/noida", reason: "manual_admin_submit" })
        .expect(201)
        .expect({ data: QUEUE_ROW });

      expect(indexing.enqueue).toHaveBeenCalledWith(
        "https://cribliv.com/en/city/noida",
        "manual_admin_submit"
      );
      const [sql, params] = database.query.mock.calls[0];
      expect(sql).toContain("INSERT INTO admin_actions");
      expect(sql).toContain("'seo_indexing_queue'::admin_target_type");
      expect(sql).toContain("'submit_indexing_url'::admin_action_type");
      expect(params[0]).toBe(ADMIN_ID);
      expect(params[1]).toBe(QUEUE_ROW.id);
    });

    it("defaults reason to manual_admin_submit when not supplied", async () => {
      await request(app.getHttpServer())
        .post("/admin/seo/indexing-queue")
        .send({ url: "https://cribliv.com/en/city/noida" })
        .expect(201);

      expect(indexing.enqueue).toHaveBeenCalledWith(
        "https://cribliv.com/en/city/noida",
        "manual_admin_submit"
      );
    });

    it("rejects a missing url with 400", async () => {
      await request(app.getHttpServer()).post("/admin/seo/indexing-queue").send({}).expect(400);
      expect(indexing.enqueue).not.toHaveBeenCalled();
    });

    it("retries a failed row and writes an audited admin action", async () => {
      await request(app.getHttpServer())
        .post(`/admin/seo/indexing-queue/${QUEUE_ROW.id}/retry`)
        .expect(200)
        .expect({ data: QUEUE_ROW });

      expect(indexing.retry).toHaveBeenCalledWith(QUEUE_ROW.id);
      const [sql, params] = database.query.mock.calls[0];
      expect(sql).toContain("'retry_indexing_url'::admin_action_type");
      expect(params[1]).toBe(QUEUE_ROW.id);
    });

    it("returns 404 when retrying a row that does not exist", async () => {
      indexing.retry = vi.fn(async () => null);
      await request(app.getHttpServer())
        .post(`/admin/seo/indexing-queue/${QUEUE_ROW.id}/retry`)
        .expect(404);
      expect(database.query).not.toHaveBeenCalled();
    });

    it("returns coverage counts", async () => {
      await request(app.getHttpServer())
        .get("/admin/seo/coverage")
        .expect(200)
        .expect({ data: { indexed_count: 10, submitted_count: 4 } });
    });
  });
  ```

- [ ] Run it and confirm it fails because the controller module doesn't exist:
      `pnpm --filter @cribliv/api exec vitest run test/admin-seo-search.controller.test.ts`
      Expected: `Cannot find module '../src/modules/admin/admin-seo-search.controller'`.
- [ ] Write `apps/api/src/modules/admin/admin-seo-search.controller.ts`:

  ```ts
  import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Inject,
    NotFoundException,
    Param,
    Post,
    Query,
    Req,
    Res,
    UseGuards
  } from "@nestjs/common";
  import type { Response } from "express";
  import { AuthGuard } from "../../common/auth.guard";
  import { DatabaseService } from "../../common/database.service";
  import { ok } from "../../common/response";
  import { Roles } from "../../common/roles.decorator";
  import { RolesGuard } from "../../common/roles.guard";
  import type { UserContext } from "../../common/types";
  import { IndexingService } from "../seo/indexing.service";
  import { SeoSearchService } from "../seo/seo-search.service";
  import type { SearchPerformanceParams } from "../seo/seo-search.service";

  function parseSearchPerformanceQuery(query: {
    city_slug?: string;
    locale?: string;
    quick_wins?: string;
    limit?: string;
    offset?: string;
  }): SearchPerformanceParams {
    return {
      city_slug: query.city_slug || undefined,
      locale: query.locale || undefined,
      quick_wins: query.quick_wins === "true" ? true : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined
    };
  }

  @Controller("admin/seo")
  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  export class AdminSeoSearchController {
    constructor(
      @Inject(SeoSearchService) private readonly seoSearch: SeoSearchService,
      @Inject(IndexingService) private readonly indexing: IndexingService,
      @Inject(DatabaseService) private readonly database: DatabaseService
    ) {}

    @Get("search-performance")
    async searchPerformance(
      @Query()
      query: {
        city_slug?: string;
        locale?: string;
        quick_wins?: string;
        limit?: string;
        offset?: string;
      }
    ) {
      return ok(await this.seoSearch.getSearchPerformance(parseSearchPerformanceQuery(query)));
    }

    @Get("search-performance/export")
    async exportSearchPerformance(
      @Query() query: { city_slug?: string; locale?: string; quick_wins?: string },
      @Res() res: Response
    ) {
      const csv = await this.seoSearch.exportSearchPerformanceCsv(
        parseSearchPerformanceQuery(query)
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="search-performance.csv"');
      res.send(csv);
    }

    @Get("coverage")
    async coverage() {
      return ok(await this.seoSearch.getCoverage());
    }

    @Get("indexing-queue")
    async indexingQueue(@Query() query: { status?: string; limit?: string; offset?: string }) {
      const [{ items, total }, summary] = await Promise.all([
        this.indexing.listQueue({
          status: query.status,
          limit: query.limit ? Number(query.limit) : undefined,
          offset: query.offset ? Number(query.offset) : undefined
        }),
        this.seoSearch.getIndexingQueueSummary()
      ]);
      return ok({ items, total, summary });
    }

    @Post("indexing-queue")
    async submitUrl(
      @Req() req: { user: UserContext },
      @Body() body: { url?: string; reason?: string }
    ) {
      if (!body?.url || typeof body.url !== "string") {
        throw new BadRequestException({ code: "invalid_url", message: "url is required" });
      }

      const row = await this.indexing.enqueue(body.url, body.reason ?? "manual_admin_submit");
      if (!row) {
        throw new BadRequestException({
          code: "db_disabled",
          message: "Database is required to submit an indexing URL"
        });
      }

      await this.database
        .query(
          `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
           VALUES ($1::uuid, 'seo_indexing_queue'::admin_target_type, $2::uuid, 'submit_indexing_url'::admin_action_type, $3, null, $4::jsonb)`,
          [req.user.id, row.id, body.reason ?? null, JSON.stringify(row)]
        )
        .catch(() => undefined);

      return ok(row);
    }

    @Post("indexing-queue/:id/retry")
    async retryUrl(@Req() req: { user: UserContext }, @Param("id") id: string) {
      const row = await this.indexing.retry(id);
      if (!row) {
        throw new NotFoundException({
          code: "indexing_queue_row_not_found",
          message: `No indexing queue row: ${id}`
        });
      }

      await this.database
        .query(
          `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, reason, before_state, after_state)
           VALUES ($1::uuid, 'seo_indexing_queue'::admin_target_type, $2::uuid, 'retry_indexing_url'::admin_action_type, null, null, $3::jsonb)`,
          [req.user.id, row.id, JSON.stringify(row)]
        )
        .catch(() => undefined);

      return ok(row);
    }
  }
  ```

- [ ] Run it and confirm most pass but check the `@Res()` route explicitly — Nest's `@Res()` bypasses the interceptor pipeline, so confirm the 403 guard test for `search-performance` still works (it doesn't hit the `@Res()` route) and the CSV route itself returns the raw body correctly:
      `pnpm --filter @cribliv/api exec vitest run test/admin-seo-search.controller.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  11 passed (11)`.
- [ ] Register the new controller in `apps/api/src/modules/admin/admin.module.ts` — add the import and add it to `controllers`:
  ```ts
  import { AdminSeoSearchController } from "./admin-seo-search.controller";
  ```
  ```ts
  controllers: [AdminController, AdminSeoController, AdminSeoSearchController],
  ```
  (No new provider entries needed — `SeoSearchService` and `IndexingService` are both already exported by `SeoModule`, which `AdminModule` already imports.)
- [ ] Run the full API suite once more to confirm the module wiring resolves cleanly end-to-end:
      `pnpm --filter @cribliv/api exec vitest run test/ src/ --reporter=dot 2>&1 | tail -30`
      Expected: no new failures.
- [ ] Commit:

  ```
  git add apps/api/src/modules/admin/admin-seo-search.controller.ts apps/api/src/modules/admin/admin.module.ts apps/api/test/admin-seo-search.controller.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add admin Search Performance + indexing-queue endpoints

  GET search-performance (+ CSV export + quick-wins filter), GET coverage,
  GET/POST indexing-queue, POST indexing-queue/:id/retry. All @Roles("admin"),
  all mutations audited to admin_actions with the new seo_indexing_queue /
  submit_indexing_url / retry_indexing_url enum values from migration 0045.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 12: Web — `admin-api.ts` client functions for Search Performance

**Files:**

- Modify: `apps/web/lib/admin-api.ts`
- Test: `apps/web/lib/__tests__/admin-api.search-performance.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface SearchPerformanceRowVm {
    keyword: string;
    page: string;
    locale: string;
    citySlug: string | null;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    capturedAt: string;
    isTarget: boolean;
    isIgnored: boolean;
  }
  export interface SearchPerformanceResultVm {
    items: SearchPerformanceRowVm[];
    total: number;
    totals: { totalImpressions: number; totalClicks: number; avgPosition: number | null };
  }
  export interface IndexingQueueRowVm {
    id: string;
    url: string;
    status: "pending" | "submitted" | "failed" | "skipped";
    reason: string | null;
    attempts: number;
    submittedAt: string | null;
    updatedAt: string;
  }
  export interface IndexingQueueResultVm {
    items: IndexingQueueRowVm[];
    total: number;
    summary: { countsByStatus: Record<string, number>; submittedToday: number; dailyQuota: number };
  }
  export async function fetchSearchPerformance(
    accessToken: string,
    params?: {
      citySlug?: string;
      locale?: string;
      quickWins?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<SearchPerformanceResultVm>;
  export function searchPerformanceExportUrl(params?: {
    citySlug?: string;
    locale?: string;
    quickWins?: boolean;
  }): string;
  export async function fetchSeoCoverage(
    accessToken: string
  ): Promise<{ indexedCount: number | null; submittedCount: number | null }>;
  export async function fetchIndexingQueue(
    accessToken: string,
    params?: { status?: string; limit?: number; offset?: number }
  ): Promise<IndexingQueueResultVm>;
  export async function submitIndexingUrl(
    accessToken: string,
    url: string,
    reason?: string
  ): Promise<IndexingQueueRowVm>;
  export async function retryIndexingUrl(
    accessToken: string,
    id: string
  ): Promise<IndexingQueueRowVm>;
  ```
- Consumes: Task 11's 6 admin routes, `fetchApi`/`buildSearchQuery` from `./api` (already imported at the top of `admin-api.ts`), `authHeaders()` (already defined in the file).
- Consumed by: Task 13's `SearchPerformanceTab.tsx`.

Steps:

- [ ] Write the failing test at `apps/web/lib/__tests__/admin-api.search-performance.test.ts` (this repo's web unit tests run under the same `vitest.config.ts` used by other `lib/__tests__` files — confirm the pattern with `ls apps/web/lib/__tests__/ 2>/dev/null` first; if that directory doesn't exist yet, create it):

  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import {
    fetchSearchPerformance,
    fetchSeoCoverage,
    fetchIndexingQueue,
    submitIndexingUrl,
    retryIndexingUrl,
    searchPerformanceExportUrl
  } from "../admin-api";

  const RAW_PERFORMANCE = {
    items: [
      {
        keyword: "2bhk noida",
        page: "/en/city/noida",
        locale: "en",
        city_slug: "noida",
        position: 14.2,
        impressions: 320,
        clicks: 18,
        ctr: 0.056,
        captured_at: "2026-07-06",
        is_target: false,
        is_ignored: false
      }
    ],
    total: 1,
    totals: { total_impressions: 320, total_clicks: 18, avg_position: 14.2 }
  };

  describe("admin-api search performance client fns", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: RAW_PERFORMANCE })
      }));
      vi.stubGlobal("fetch", fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("fetches and maps search performance rows to camelCase", async () => {
      const result = await fetchSearchPerformance("tok", { quickWins: true });

      expect(result.items[0]).toEqual({
        keyword: "2bhk noida",
        page: "/en/city/noida",
        locale: "en",
        citySlug: "noida",
        position: 14.2,
        impressions: 320,
        clicks: 18,
        ctr: 0.056,
        capturedAt: "2026-07-06",
        isTarget: false,
        isIgnored: false
      });
      expect(result.totals).toEqual({ totalImpressions: 320, totalClicks: 18, avgPosition: 14.2 });

      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("quick_wins=true");
    });

    it("builds the CSV export URL with query params (no fetch call)", () => {
      const url = searchPerformanceExportUrl({ citySlug: "noida", quickWins: true });
      expect(url).toContain("/admin/seo/search-performance/export");
      expect(url).toContain("city_slug=noida");
      expect(url).toContain("quick_wins=true");
    });

    it("fetches coverage and maps to camelCase", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { indexed_count: 10, submitted_count: 4 } })
      });

      await expect(fetchSeoCoverage("tok")).resolves.toEqual({
        indexedCount: 10,
        submittedCount: 4
      });
    });

    it("fetches the indexing queue and maps summary fields", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            items: [
              {
                id: "q1",
                url: "https://cribliv.com/en/city/noida",
                status: "pending",
                reason: "city_enabled",
                attempts: 0,
                submitted_at: null,
                updated_at: "2026-07-06T00:00:00.000Z"
              }
            ],
            total: 1,
            summary: { counts_by_status: { pending: 1 }, submitted_today: 0, daily_quota: 200 }
          }
        })
      });

      const result = await fetchIndexingQueue("tok", { status: "pending" });
      expect(result.items[0].id).toBe("q1");
      expect(result.summary).toEqual({
        countsByStatus: { pending: 1 },
        submittedToday: 0,
        dailyQuota: 200
      });
    });

    it("submits a manual indexing URL", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "q2",
            url: "https://cribliv.com/x",
            status: "pending",
            reason: "manual_admin_submit",
            attempts: 0,
            submitted_at: null,
            updated_at: "2026-07-06T00:00:00.000Z"
          }
        })
      });

      const row = await submitIndexingUrl("tok", "https://cribliv.com/x");
      expect(row.id).toBe("q2");

      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ url: "https://cribliv.com/x" });
    });

    it("retries a failed indexing URL", async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            id: "q3",
            url: "https://cribliv.com/y",
            status: "pending",
            reason: "manual_admin_submit",
            attempts: 1,
            submitted_at: null,
            updated_at: "2026-07-06T00:00:00.000Z"
          }
        })
      });

      const row = await retryIndexingUrl("tok", "q3");
      expect(row.id).toBe("q3");

      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/admin/seo/indexing-queue/q3/retry");
      expect(init.method).toBe("POST");
    });
  });
  ```

- [ ] Run it and confirm it fails because the functions aren't exported yet:
      `cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/web exec vitest run lib/__tests__/admin-api.search-performance.test.ts`
      Expected: `SyntaxError: The requested module '../admin-api' does not provide an export named 'fetchSearchPerformance'`.
- [ ] Append to the end of `apps/web/lib/admin-api.ts` (after the existing `setSeoCityEnabled` function and whatever locality/metro drill-in types already follow it — add this new block after the very last export in the file):

  ```ts
  // ── Search Performance (Slice 2 — Indexing + Measurement) ──────────────────

  export interface SearchPerformanceRowVm {
    keyword: string;
    page: string;
    locale: string;
    citySlug: string | null;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    capturedAt: string;
    isTarget: boolean;
    isIgnored: boolean;
  }

  export interface SearchPerformanceResultVm {
    items: SearchPerformanceRowVm[];
    total: number;
    totals: { totalImpressions: number; totalClicks: number; avgPosition: number | null };
  }

  interface SearchPerformanceRawRow {
    keyword: string;
    page: string;
    locale: string;
    city_slug: string | null;
    position: number;
    impressions: number;
    clicks: number;
    ctr: number;
    captured_at: string;
    is_target: boolean;
    is_ignored: boolean;
  }

  interface SearchPerformanceRawResult {
    items: SearchPerformanceRawRow[];
    total: number;
    totals: { total_impressions: number; total_clicks: number; avg_position: number | null };
  }

  export interface IndexingQueueRowVm {
    id: string;
    url: string;
    status: "pending" | "submitted" | "failed" | "skipped";
    reason: string | null;
    attempts: number;
    submittedAt: string | null;
    updatedAt: string;
  }

  interface IndexingQueueRawRow {
    id: string;
    url: string;
    status: "pending" | "submitted" | "failed" | "skipped";
    reason: string | null;
    attempts: number;
    submitted_at: string | null;
    updated_at: string;
  }

  export interface IndexingQueueResultVm {
    items: IndexingQueueRowVm[];
    total: number;
    summary: { countsByStatus: Record<string, number>; submittedToday: number; dailyQuota: number };
  }

  function mapSearchPerformanceRow(row: SearchPerformanceRawRow): SearchPerformanceRowVm {
    return {
      keyword: row.keyword,
      page: row.page,
      locale: row.locale,
      citySlug: row.city_slug,
      position: row.position,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      capturedAt: row.captured_at,
      isTarget: row.is_target,
      isIgnored: row.is_ignored
    };
  }

  function mapIndexingQueueRow(row: IndexingQueueRawRow): IndexingQueueRowVm {
    return {
      id: row.id,
      url: row.url,
      status: row.status,
      reason: row.reason,
      attempts: row.attempts,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at
    };
  }

  interface SearchPerformanceFilterParams {
    citySlug?: string;
    locale?: string;
    quickWins?: boolean;
    limit?: number;
    offset?: number;
  }

  function searchPerformanceQueryParams(
    params?: SearchPerformanceFilterParams
  ): Record<string, string> {
    const query: Record<string, string> = {};
    if (params?.citySlug) query.city_slug = params.citySlug;
    if (params?.locale) query.locale = params.locale;
    if (params?.quickWins) query.quick_wins = "true";
    if (params?.limit != null) query.limit = String(params.limit);
    if (params?.offset != null) query.offset = String(params.offset);
    return query;
  }

  export async function fetchSearchPerformance(
    accessToken: string,
    params?: SearchPerformanceFilterParams
  ): Promise<SearchPerformanceResultVm> {
    const raw = await fetchApi<SearchPerformanceRawResult>(
      `/admin/seo/search-performance${buildSearchQuery(searchPerformanceQueryParams(params))}`,
      { headers: authHeaders(accessToken) }
    );
    return {
      items: raw.items.map(mapSearchPerformanceRow),
      total: raw.total,
      totals: {
        totalImpressions: raw.totals.total_impressions,
        totalClicks: raw.totals.total_clicks,
        avgPosition: raw.totals.avg_position
      }
    };
  }

  export function searchPerformanceExportUrl(params?: {
    citySlug?: string;
    locale?: string;
    quickWins?: boolean;
  }): string {
    const base =
      process.env.NEXT_PUBLIC_API_BASE_URL ??
      process.env.API_BASE_URL ??
      "http://localhost:4000/v1";
    return `${base}/admin/seo/search-performance/export${buildSearchQuery(searchPerformanceQueryParams(params))}`;
  }

  export async function fetchSeoCoverage(
    accessToken: string
  ): Promise<{ indexedCount: number | null; submittedCount: number | null }> {
    const raw = await fetchApi<{ indexed_count: number | null; submitted_count: number | null }>(
      "/admin/seo/coverage",
      { headers: authHeaders(accessToken) }
    );
    return { indexedCount: raw.indexed_count, submittedCount: raw.submitted_count };
  }

  export async function fetchIndexingQueue(
    accessToken: string,
    params?: { status?: string; limit?: number; offset?: number }
  ): Promise<IndexingQueueResultVm> {
    const query: Record<string, string> = {};
    if (params?.status) query.status = params.status;
    if (params?.limit != null) query.limit = String(params.limit);
    if (params?.offset != null) query.offset = String(params.offset);

    const raw = await fetchApi<{
      items: IndexingQueueRawRow[];
      total: number;
      summary: {
        counts_by_status: Record<string, number>;
        submitted_today: number;
        daily_quota: number;
      };
    }>(`/admin/seo/indexing-queue${buildSearchQuery(query)}`, {
      headers: authHeaders(accessToken)
    });

    return {
      items: raw.items.map(mapIndexingQueueRow),
      total: raw.total,
      summary: {
        countsByStatus: raw.summary.counts_by_status,
        submittedToday: raw.summary.submitted_today,
        dailyQuota: raw.summary.daily_quota
      }
    };
  }

  export async function submitIndexingUrl(
    accessToken: string,
    url: string,
    reason?: string
  ): Promise<IndexingQueueRowVm> {
    const body: { url: string; reason?: string } = { url };
    if (reason !== undefined) body.reason = reason;

    const raw = await fetchApi<IndexingQueueRawRow>("/admin/seo/indexing-queue", {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify(body)
    });
    return mapIndexingQueueRow(raw);
  }

  export async function retryIndexingUrl(
    accessToken: string,
    id: string
  ): Promise<IndexingQueueRowVm> {
    const raw = await fetchApi<IndexingQueueRawRow>(
      `/admin/seo/indexing-queue/${encodeURIComponent(id)}/retry`,
      { method: "POST", headers: authHeaders(accessToken) }
    );
    return mapIndexingQueueRow(raw);
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/web exec vitest run lib/__tests__/admin-api.search-performance.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  7 passed (7)`.
- [ ] Run the full web unit-test suite once to confirm nothing else broke:
      `pnpm --filter @cribliv/web exec vitest run --reporter=dot 2>&1 | tail -30`
      Expected: no new failures.
- [ ] Commit:

  ```
  git add apps/web/lib/admin-api.ts apps/web/lib/__tests__/admin-api.search-performance.test.ts
  git commit -m "$(cat <<'EOF'
  feat(seo): add admin-api client fns for Search Performance + indexing queue

  fetchSearchPerformance, searchPerformanceExportUrl, fetchSeoCoverage,
  fetchIndexingQueue, submitIndexingUrl, retryIndexingUrl — camelCase VMs
  over the 6 new admin API routes, same snake_case-to-camelCase mapping
  convention as the rest of admin-api.ts.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 13: Web — `SearchPerformanceTab` component + `AdminShell`/`AdminSidebar` wiring

**Files:**

- Create: `apps/web/components/admin/tabs/SearchPerformanceTab.tsx`
- Modify: `apps/web/components/admin/shell/AdminSidebar.tsx`
- Modify: `apps/web/components/admin/shell/AdminShell.tsx`
- Test: `apps/web/components/admin/tabs/__tests__/SearchPerformanceTab.test.tsx`
- Test: `apps/web/components/admin/shell/__tests__/AdminShell.search-performance-tab.test.tsx`

**Interfaces:**

- Produces: `export function SearchPerformanceTab({ accessToken, onToast }: { accessToken: string; onToast: (message: string, tone?: "trust" | "warn" | "danger") => void }): JSX.Element` — three `StatCard`s (indexed count, submitted-vs-quota, quick-wins count), a toggle between "All rankings" / "Quick wins" views (both a `DataTable` over `SearchPerformanceRowVm[]`), a CSV export link (`<a href={searchPerformanceExportUrl(...)}>`), and an "Indexing queue" `SectionCard` with its own `DataTable` over `IndexingQueueRowVm[]` plus a manual-submit form and a retry button per failed row.
- Modifies: `AdminTab` union in `AdminSidebar.tsx` gains `"search-performance"`; `AdminSidebar`'s `understand` nav array gains one entry `{ id: "search-performance", label: "Search Performance", icon: TrendingUp }` (import `TrendingUp` from `lucide-react`, already a dependency); `AdminShell.tsx`'s `TAB_TITLES` gains `"search-performance": "Search Performance"`, its `view` switch gains a `case "search-performance"` rendering `<SearchPerformanceTab key={...} accessToken={accessToken} onToast={push} />`.
- Consumes: Task 12's 6 client functions from `admin-api.ts`, `DataTable`/`StatCard`/`SectionCard` primitives (already imported the same way `SeoProgrammaticPages.tsx` imports `DataTable`/`StatCard`), `formatNumber`/`formatDate` from `../../../lib/admin/format` (already used by `SeoProgrammaticPages.tsx`).

Steps:

- [ ] Write the failing component test at `apps/web/components/admin/tabs/__tests__/SearchPerformanceTab.test.tsx`:

  ```tsx
  import { fireEvent, render, screen, waitFor } from "@testing-library/react";
  import { beforeEach, describe, expect, it, vi } from "vitest";

  const fetchSearchPerformance = vi.fn();
  const fetchSeoCoverage = vi.fn();
  const fetchIndexingQueue = vi.fn();
  const submitIndexingUrl = vi.fn();
  const retryIndexingUrl = vi.fn();
  const searchPerformanceExportUrl = vi.fn(
    () => "http://api.test/admin/seo/search-performance/export"
  );

  vi.mock("../../../../lib/admin-api", () => ({
    fetchSearchPerformance: (...args: unknown[]) => fetchSearchPerformance(...args),
    fetchSeoCoverage: (...args: unknown[]) => fetchSeoCoverage(...args),
    fetchIndexingQueue: (...args: unknown[]) => fetchIndexingQueue(...args),
    submitIndexingUrl: (...args: unknown[]) => submitIndexingUrl(...args),
    retryIndexingUrl: (...args: unknown[]) => retryIndexingUrl(...args),
    searchPerformanceExportUrl: (...args: unknown[]) => searchPerformanceExportUrl(...args)
  }));

  import { SearchPerformanceTab } from "../SearchPerformanceTab";

  const PERFORMANCE_RESULT = {
    items: [
      {
        keyword: "2bhk noida",
        page: "/en/city/noida",
        locale: "en",
        citySlug: "noida",
        position: 14.2,
        impressions: 320,
        clicks: 18,
        ctr: 0.056,
        capturedAt: "2026-07-06",
        isTarget: false,
        isIgnored: false
      }
    ],
    total: 1,
    totals: { totalImpressions: 320, totalClicks: 18, avgPosition: 14.2 }
  };

  const QUEUE_RESULT = {
    items: [
      {
        id: "q1",
        url: "https://cribliv.com/en/city/noida",
        status: "failed",
        reason: "city_enabled",
        attempts: 5,
        submittedAt: null,
        updatedAt: "2026-07-06T00:00:00.000Z"
      }
    ],
    total: 1,
    summary: { countsByStatus: { failed: 1 }, submittedToday: 3, dailyQuota: 200 }
  };

  describe("SearchPerformanceTab", () => {
    const onToast = vi.fn();

    beforeEach(() => {
      vi.clearAllMocks();
      fetchSearchPerformance.mockResolvedValue(PERFORMANCE_RESULT);
      fetchSeoCoverage.mockResolvedValue({ indexedCount: 42, submittedCount: 7 });
      fetchIndexingQueue.mockResolvedValue(QUEUE_RESULT);
      searchPerformanceExportUrl.mockReturnValue(
        "http://api.test/admin/seo/search-performance/export"
      );
    });

    it("loads and renders rankings, coverage stats, and the indexing queue", async () => {
      render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);

      expect(await screen.findByText("2bhk noida")).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument(); // indexed count stat
      expect(screen.getByText(/https:\/\/cribliv\.com\/en\/city\/noida/)).toBeInTheDocument();
      expect(fetchSearchPerformance).toHaveBeenCalledWith("tok", expect.objectContaining({}));
      expect(fetchIndexingQueue).toHaveBeenCalledWith("tok", expect.objectContaining({}));
    });

    it("toggles to the quick-wins view and re-fetches with quickWins: true", async () => {
      render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);
      await screen.findByText("2bhk noida");

      fireEvent.click(screen.getByRole("button", { name: /quick wins/i }));

      await waitFor(() => {
        expect(fetchSearchPerformance).toHaveBeenCalledWith(
          "tok",
          expect.objectContaining({ quickWins: true })
        );
      });
    });

    it("renders a CSV export link built from searchPerformanceExportUrl", async () => {
      render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);
      await screen.findByText("2bhk noida");

      const link = screen.getByRole("link", { name: /export csv/i });
      expect(link).toHaveAttribute("href", "http://api.test/admin/seo/search-performance/export");
    });

    it("submits a manual indexing URL and reloads the queue", async () => {
      submitIndexingUrl.mockResolvedValue({
        id: "q2",
        url: "https://cribliv.com/x",
        status: "pending",
        reason: "manual_admin_submit",
        attempts: 0,
        submittedAt: null,
        updatedAt: "2026-07-06T00:00:00.000Z"
      });
      render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);
      await screen.findByText("2bhk noida");

      fireEvent.change(screen.getByPlaceholderText(/https:\/\/cribliv\.com/i), {
        target: { value: "https://cribliv.com/x" }
      });
      fireEvent.click(screen.getByRole("button", { name: /submit url/i }));

      await waitFor(() => {
        expect(submitIndexingUrl).toHaveBeenCalledWith("tok", "https://cribliv.com/x", undefined);
      });
      await waitFor(() => expect(fetchIndexingQueue).toHaveBeenCalledTimes(2));
      expect(onToast).toHaveBeenCalledWith(expect.stringMatching(/submitted/i), "trust");
    });

    it("retries a failed row", async () => {
      retryIndexingUrl.mockResolvedValue({
        id: "q1",
        url: "https://cribliv.com/en/city/noida",
        status: "pending",
        reason: "city_enabled",
        attempts: 5,
        submittedAt: null,
        updatedAt: "2026-07-06T00:00:00.000Z"
      });
      render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);
      await screen.findByText("2bhk noida");

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));

      await waitFor(() => {
        expect(retryIndexingUrl).toHaveBeenCalledWith("tok", "q1");
      });
    });

    it("shows a danger toast when loading search performance fails", async () => {
      fetchSearchPerformance.mockRejectedValue(new Error("network down"));
      render(<SearchPerformanceTab accessToken="tok" onToast={onToast} />);

      await waitFor(() => {
        expect(onToast).toHaveBeenCalledWith("network down", "danger");
      });
    });
  });
  ```

- [ ] Run it and confirm it fails because the component does not exist:
      `pnpm --filter @cribliv/web exec vitest run components/admin/tabs/__tests__/SearchPerformanceTab.test.tsx`
      Expected: `Cannot find module '../SearchPerformanceTab'`.
- [ ] Write `apps/web/components/admin/tabs/SearchPerformanceTab.tsx`:

  ```tsx
  "use client";

  import { useEffect, useRef, useState } from "react";
  import { DataTable, type Column } from "../primitives/DataTable";
  import { StatCard } from "../primitives/StatCard";
  import { SectionCard } from "../primitives/SectionCard";
  import { StatusPill } from "../primitives/StatusPill";
  import {
    fetchSearchPerformance,
    fetchSeoCoverage,
    fetchIndexingQueue,
    submitIndexingUrl,
    retryIndexingUrl,
    searchPerformanceExportUrl,
    type SearchPerformanceRowVm,
    type IndexingQueueRowVm
  } from "../../../lib/admin-api";
  import { formatNumber, formatDate } from "../../../lib/admin/format";
  import type { CSSProperties } from "react";

  // Matches SystemTab.tsx's fieldStyle exactly — this repo styles plain <input>
  // elements inline rather than via a shared input class.
  const fieldStyle: CSSProperties = {
    height: 34,
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid var(--ad-border)",
    background: "var(--ad-surface)",
    fontSize: 13,
    fontFamily: "inherit"
  };

  interface Props {
    accessToken: string;
    onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
  }

  export function SearchPerformanceTab({ accessToken, onToast }: Props) {
    const [rows, setRows] = useState<SearchPerformanceRowVm[]>([]);
    const [totals, setTotals] = useState({
      totalImpressions: 0,
      totalClicks: 0,
      avgPosition: null as number | null
    });
    const [coverage, setCoverage] = useState<{
      indexedCount: number | null;
      submittedCount: number | null;
    }>({
      indexedCount: null,
      submittedCount: null
    });
    const [queue, setQueue] = useState<IndexingQueueRowVm[]>([]);
    const [queueSummary, setQueueSummary] = useState({
      countsByStatus: {} as Record<string, number>,
      submittedToday: 0,
      dailyQuota: 200
    });
    const [quickWins, setQuickWins] = useState(false);
    const [loading, setLoading] = useState(true);
    const [manualUrl, setManualUrl] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [retryingId, setRetryingId] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const onToastRef = useRef(onToast);

    useEffect(() => {
      onToastRef.current = onToast;
    }, [onToast]);

    useEffect(() => {
      let cancelled = false;

      async function load() {
        setLoading(true);
        try {
          const [performance, cov] = await Promise.all([
            fetchSearchPerformance(accessToken, { quickWins: quickWins || undefined }),
            fetchSeoCoverage(accessToken)
          ]);
          if (!cancelled) {
            setRows(performance.items);
            setTotals(performance.totals);
            setCoverage(cov);
          }
        } catch (err) {
          if (!cancelled) {
            onToastRef.current(
              err instanceof Error ? err.message : "Could not load search performance",
              "danger"
            );
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      }

      void load();
      return () => {
        cancelled = true;
      };
    }, [accessToken, quickWins, reloadKey]);

    useEffect(() => {
      let cancelled = false;

      async function loadQueue() {
        try {
          const result = await fetchIndexingQueue(accessToken, {});
          if (!cancelled) {
            setQueue(result.items);
            setQueueSummary(result.summary);
          }
        } catch (err) {
          if (!cancelled) {
            onToastRef.current(
              err instanceof Error ? err.message : "Could not load indexing queue",
              "danger"
            );
          }
        }
      }

      void loadQueue();
      return () => {
        cancelled = true;
      };
    }, [accessToken, reloadKey]);

    async function handleSubmitUrl() {
      if (!manualUrl.trim()) return;
      setSubmitting(true);
      try {
        await submitIndexingUrl(accessToken, manualUrl.trim());
        setManualUrl("");
        onToast("URL submitted for indexing", "trust");
        setReloadKey((k) => k + 1);
      } catch (err) {
        onToast(err instanceof Error ? err.message : "Could not submit URL", "danger");
      } finally {
        setSubmitting(false);
      }
    }

    async function handleRetry(row: IndexingQueueRowVm) {
      setRetryingId(row.id);
      try {
        await retryIndexingUrl(accessToken, row.id);
        onToast(`${row.url} queued for retry`, "trust");
        setReloadKey((k) => k + 1);
      } catch (err) {
        onToast(err instanceof Error ? err.message : "Could not retry URL", "danger");
      } finally {
        setRetryingId(null);
      }
    }

    const rankingColumns: Column<SearchPerformanceRowVm>[] = [
      {
        key: "keyword",
        header: "Keyword",
        render: (row) => row.keyword,
        sortValue: (row) => row.keyword
      },
      {
        key: "page",
        header: "Page",
        render: (row) => <span className="admin-table__id">{row.page}</span>,
        sortValue: (row) => row.page
      },
      { key: "locale", header: "Locale", render: (row) => row.locale.toUpperCase() },
      {
        key: "position",
        header: "Position",
        align: "right",
        render: (row) => row.position.toFixed(1),
        sortValue: (row) => row.position
      },
      {
        key: "impressions",
        header: "Impressions",
        align: "right",
        render: (row) => formatNumber(row.impressions),
        sortValue: (row) => row.impressions
      },
      {
        key: "clicks",
        header: "Clicks",
        align: "right",
        render: (row) => formatNumber(row.clicks),
        sortValue: (row) => row.clicks
      },
      {
        key: "ctr",
        header: "CTR",
        align: "right",
        render: (row) => `${(row.ctr * 100).toFixed(1)}%`,
        sortValue: (row) => row.ctr
      },
      {
        key: "captured",
        header: "Captured",
        render: (row) => formatDate(row.capturedAt),
        sortValue: (row) => row.capturedAt
      }
    ];

    const queueColumns: Column<IndexingQueueRowVm>[] = [
      {
        key: "url",
        header: "URL",
        render: (row) => <span className="admin-table__id">{row.url}</span>,
        sortValue: (row) => row.url
      },
      {
        key: "status",
        header: "Status",
        render: (row) => (
          <StatusPill
            status={row.status}
            label={row.status}
            tone={
              row.status === "submitted"
                ? "trust"
                : row.status === "failed"
                  ? "danger"
                  : row.status === "skipped"
                    ? "warn"
                    : "muted"
            }
          />
        ),
        sortValue: (row) => row.status
      },
      { key: "reason", header: "Reason", render: (row) => row.reason ?? "—" },
      {
        key: "attempts",
        header: "Attempts",
        align: "right",
        render: (row) => row.attempts,
        sortValue: (row) => row.attempts
      },
      {
        key: "action",
        header: "",
        align: "right",
        render: (row) =>
          row.status === "failed" ? (
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => void handleRetry(row)}
              disabled={retryingId === row.id}
            >
              {retryingId === row.id ? "Retrying..." : "Retry"}
            </button>
          ) : null
      }
    ];

    return (
      <div className="admin-main__section">
        <div className="admin-page-title">
          <h1>Search Performance</h1>
          <span className="admin-page-title__sub">
            {loading ? "loading..." : `${formatNumber(totals.totalImpressions)} impressions (28d)`}
          </span>
        </div>

        <div className="admin-stat-grid">
          <StatCard
            label="Indexed pages"
            value={formatNumber(coverage.indexedCount ?? 0)}
            tone="brand"
          />
          <StatCard
            label="Submitted today"
            value={`${formatNumber(queueSummary.submittedToday)} / ${formatNumber(queueSummary.dailyQuota)}`}
            tone="trust"
          />
          <StatCard label="Avg position" value={totals.avgPosition?.toFixed(1) ?? "—"} />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className={`admin-btn admin-btn--sm ${!quickWins ? "admin-btn--primary" : "admin-btn--ghost"}`}
            onClick={() => setQuickWins(false)}
          >
            All rankings
          </button>
          <button
            type="button"
            className={`admin-btn admin-btn--sm ${quickWins ? "admin-btn--primary" : "admin-btn--ghost"}`}
            onClick={() => setQuickWins(true)}
          >
            Quick wins
          </button>
          <a
            href={searchPerformanceExportUrl({ quickWins: quickWins || undefined })}
            className="admin-btn admin-btn--ghost admin-btn--sm"
            style={{ marginLeft: "auto" }}
          >
            Export CSV
          </a>
        </div>

        <DataTable
          columns={rankingColumns}
          rows={rows}
          rowKey={(row) => `${row.keyword}::${row.page}::${row.locale}`}
          emptyState={quickWins ? "No quick-win keywords yet" : "No ranking data yet"}
          initialSort={{ key: "impressions", dir: "desc" }}
        />

        <SectionCard title="Indexing queue">
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              placeholder="https://cribliv.com/..."
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              style={{ ...fieldStyle, flex: 1 }}
            />
            <button
              type="button"
              className="admin-btn admin-btn--primary admin-btn--sm"
              onClick={() => void handleSubmitUrl()}
              disabled={submitting || !manualUrl.trim()}
            >
              {submitting ? "Submitting..." : "Submit URL"}
            </button>
          </div>

          <DataTable
            columns={queueColumns}
            rows={queue}
            rowKey={(row) => row.id}
            emptyState="No indexing queue entries"
          />
        </SectionCard>
      </div>
    );
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/web exec vitest run components/admin/tabs/__tests__/SearchPerformanceTab.test.tsx`
      Expected: `Test Files  1 passed (1)` / `Tests  6 passed (6)`.
- [ ] Write the failing tab-registration test at `apps/web/components/admin/shell/__tests__/AdminShell.search-performance-tab.test.tsx` (mirrors `AdminShell.seo-tab.test.tsx` exactly):

  ```tsx
  import { fireEvent, render, screen } from "@testing-library/react";
  import { beforeEach, describe, expect, it, vi } from "vitest";

  vi.mock("../../tabs/LiveOpsTab", () => ({
    LiveOpsTab: () => <div data-testid="live-tab" />
  }));

  vi.mock("../../tabs/SearchPerformanceTab", () => ({
    SearchPerformanceTab: ({ accessToken }: { accessToken: string }) => (
      <div data-testid="search-performance-tab">sp:{accessToken}</div>
    )
  }));

  import { AdminShell } from "../AdminShell";

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  describe("AdminShell Search Performance tab", () => {
    it("navigates to the Search Performance tab", async () => {
      render(<AdminShell accessToken="tok" />);

      fireEvent.click(screen.getByRole("button", { name: /search performance/i }));

      expect(await screen.findByTestId("search-performance-tab")).toHaveTextContent("sp:tok");
    });
  });
  ```

- [ ] Run it and confirm it fails (no such tab/button exists yet):
      `pnpm --filter @cribliv/web exec vitest run components/admin/shell/__tests__/AdminShell.search-performance-tab.test.tsx`
      Expected: `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name /search performance/i`.
- [ ] In `apps/web/components/admin/shell/AdminSidebar.tsx`, add the `TrendingUp` import and update `AdminTab` + the `understand` array:
  ```ts
  import {
    Activity,
    AlertTriangle,
    BarChart3,
    Building2,
    ClipboardList,
    Coins,
    FileText,
    Globe,
    LayoutDashboard,
    LogOut,
    ShieldCheck,
    TrendingUp,
    Users,
    Wrench
  } from "lucide-react";
  ```
  ```ts
  export type AdminTab =
    | "live"
    | "overview"
    | "listings"
    | "verifications"
    | "leads"
    | "users"
    | "revenue"
    | "rent-agreements"
    | "pg-listings"
    | "pg-properties"
    | "fraud"
    | "seo"
    | "search-performance"
    | "system";
  ```
  ```ts
  const understand: NavItem[] = [
    { id: "revenue", label: "Revenue", icon: Coins },
    { id: "rent-agreements", label: "Rent Agreements", icon: FileText },
    { id: "pg-listings", label: "PG Overview", icon: BarChart3 },
    { id: "pg-properties", label: "PG Listings", icon: Building2 },
    { id: "users", label: "Users", icon: Users },
    { id: "seo", label: "Programmatic SEO", icon: Globe },
    { id: "search-performance", label: "Search Performance", icon: TrendingUp }
  ];
  ```
- [ ] In `apps/web/components/admin/shell/AdminShell.tsx`, add the import, `TAB_TITLES` entry, and switch case:
  ```ts
  import { SearchPerformanceTab } from "../tabs/SearchPerformanceTab";
  ```
  ```ts
  const TAB_TITLES: Record<AdminTab, string> = {
    live: "Live Operations",
    overview: "Overview",
    listings: "Listing Review",
    verifications: "Verification Review",
    leads: "CRM",
    users: "Users",
    revenue: "Revenue",
    "rent-agreements": "Rent Agreements",
    "pg-listings": "PG Overview",
    "pg-properties": "PG Listings",
    fraud: "Fraud Intelligence",
    seo: "Programmatic SEO",
    "search-performance": "Search Performance",
    system: "System Tools"
  };
  ```
  ```ts
      case "seo":
        return <SeoProgrammaticPages key={`seo-${k}`} accessToken={accessToken} onToast={push} />;
      case "search-performance":
        return (
          <SearchPerformanceTab key={`sp-${k}`} accessToken={accessToken} onToast={push} />
        );
      case "system":
  ```
- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/web exec vitest run components/admin/shell/__tests__/AdminShell.search-performance-tab.test.tsx`
      Expected: `Test Files  1 passed (1)` / `Tests  1 passed (1)`.
- [ ] Run the full web unit-test suite once more:
      `pnpm --filter @cribliv/web exec vitest run --reporter=dot 2>&1 | tail -30`
      Expected: no new failures (the pre-existing `AdminShell.seo-tab.test.tsx` must still pass unmodified).
- [ ] Commit:

  ```
  git add apps/web/components/admin/tabs/SearchPerformanceTab.tsx apps/web/components/admin/shell/AdminSidebar.tsx apps/web/components/admin/shell/AdminShell.tsx apps/web/components/admin/tabs/__tests__/SearchPerformanceTab.test.tsx apps/web/components/admin/shell/__tests__/AdminShell.search-performance-tab.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(seo): add admin Search Performance tab (rankings + quick-wins + indexing queue)

  Rankings table with an All/Quick-wins toggle and CSV export, coverage stat
  cards, and an indexing-queue panel with manual submit + retry-failed.
  Registered on AdminSidebar/AdminShell following the exact SeoProgrammaticPages
  tab-registration pattern.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 14 (OPTIONAL): IndexNow submission — Bing/Yandex fast-track

> **This entire task is OPTIONAL.** Per spec section 9's open decision #3: "a near-free bonus... deferred unless wanted." Skip this task entirely if the goal is just Google indexing + measurement — nothing in Tasks 1–13 depends on it. Implement only if IndexNow is explicitly requested.

**Files:**

- Create: `apps/api/src/modules/seo/indexnow.service.ts`
- Test: `apps/api/src/modules/seo/__tests__/indexnow.service.test.ts`
- Modify: `apps/api/src/worker/worker.ts` (call from inside the existing `indexing_submitter` job, not a separate interval)
- Modify: `.env.example`

**Interfaces:**

- Produces: `export class IndexNowService { constructor(fetchImpl?: typeof fetch); async submit(urls: string[]): Promise<{ ok: boolean; status?: number }>; }` — POSTs `{ host, key, keyLocation, urlList }` to `https://api.indexnow.org/indexnow` (a single multi-URL submission per call — IndexNow's protocol accepts up to 10,000 URLs per request, so this plan batches everything the indexing submitter just successfully sent to Google into one IndexNow call per worker tick, not one call per URL).
- Consumes: env `INDEXNOW_KEY` (a random hex string the site owner generates once and hosts at `https://cribliv.com/{key}.txt` — this plan does not automate the key-file hosting; that's a one-time manual step documented in a code comment, not built), `INDEXNOW_HOST` (default derived from `GSC_SITE_URL` by stripping the `sc-domain:` prefix, e.g. `cribliv.com`).
- Consumed by: `runIndexingSubmitterJob` — after `IndexingService.drainPending` returns, if `IndexNowService` is configured (env var present) and at least one URL was `submitted`, call `indexNow.submit(justSubmittedUrls)` best-effort (never throws, logs on failure, does not affect the job's returned `{ submitted, failed, skippedQuota }` counts).

Steps:

- [ ] Write the failing unit test at `apps/api/src/modules/seo/__tests__/indexnow.service.test.ts`:

  ```ts
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { IndexNowService } from "../indexnow.service";

  describe("IndexNowService", () => {
    let originalEnv: { key?: string; host?: string };

    beforeEach(() => {
      originalEnv = { key: process.env.INDEXNOW_KEY, host: process.env.INDEXNOW_HOST };
      process.env.INDEXNOW_KEY = "abc123def456";
      process.env.INDEXNOW_HOST = "cribliv.com";
    });

    afterEach(() => {
      if (originalEnv.key === undefined) delete process.env.INDEXNOW_KEY;
      else process.env.INDEXNOW_KEY = originalEnv.key;
      if (originalEnv.host === undefined) delete process.env.INDEXNOW_HOST;
      else process.env.INDEXNOW_HOST = originalEnv.host;
    });

    it("posts host/key/keyLocation/urlList to the IndexNow API", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
      const service = new IndexNowService(fetchMock as unknown as typeof fetch);

      const result = await service.submit(["https://cribliv.com/en/city/noida"]);

      expect(result).toEqual({ ok: true, status: 200 });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.indexnow.org/indexnow");
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        host: "cribliv.com",
        key: "abc123def456",
        keyLocation: "https://cribliv.com/abc123def456.txt",
        urlList: ["https://cribliv.com/en/city/noida"]
      });
    });

    it("no-ops without calling fetch when INDEXNOW_KEY is not configured", async () => {
      delete process.env.INDEXNOW_KEY;
      const fetchMock = vi.fn();
      const service = new IndexNowService(fetchMock as unknown as typeof fetch);

      await expect(service.submit(["https://cribliv.com/x"])).resolves.toEqual({ ok: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("no-ops with an empty url list", async () => {
      const fetchMock = vi.fn();
      const service = new IndexNowService(fetchMock as unknown as typeof fetch);

      await expect(service.submit([])).resolves.toEqual({ ok: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never throws when the IndexNow API errors", async () => {
      const fetchMock = vi.fn(async () => {
        throw new Error("network down");
      });
      const service = new IndexNowService(fetchMock as unknown as typeof fetch);

      await expect(service.submit(["https://cribliv.com/x"])).resolves.toEqual({ ok: false });
    });
  });
  ```

- [ ] Run it and confirm it fails:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/__tests__/indexnow.service.test.ts`
      Expected: `Cannot find module '../indexnow.service'`.
- [ ] Write `apps/api/src/modules/seo/indexnow.service.ts`:

  ```ts
  import { Injectable, Logger } from "@nestjs/common";

  const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

  /**
   * IndexNow (https://www.indexnow.org/) — a single ping fans out to every
   * participating engine (Bing, Yandex, and others); Google does not
   * participate as of this writing, so this is purely additive to the Google
   * Indexing API path in indexing.service.ts. OPTIONAL — see Task 14 in the
   * slice-2 plan for why this exists as a separate, skippable service.
   *
   * One-time manual setup (not automated by this service): generate a random
   * hex string for INDEXNOW_KEY, then host a file at
   * https://{INDEXNOW_HOST}/{INDEXNOW_KEY}.txt whose entire body is that same
   * key string — IndexNow verifies ownership by fetching keyLocation.
   */
  @Injectable()
  export class IndexNowService {
    private readonly logger = new Logger(IndexNowService.name);
    private readonly fetchImpl: typeof fetch;

    constructor(fetchImpl: typeof fetch = fetch) {
      this.fetchImpl = fetchImpl;
    }

    async submit(urls: string[]): Promise<{ ok: boolean; status?: number }> {
      const key = process.env.INDEXNOW_KEY;
      const host = process.env.INDEXNOW_HOST;

      if (!key || !host || urls.length === 0) {
        return { ok: false };
      }

      try {
        const response = await this.fetchImpl(INDEXNOW_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            host,
            key,
            keyLocation: `https://${host}/${key}.txt`,
            urlList: urls
          })
        });
        return { ok: response.ok, status: response.status };
      } catch (err) {
        this.logger.warn(
          `IndexNow submit failed: ${err instanceof Error ? err.message : String(err)}`
        );
        return { ok: false };
      }
    }
  }
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run src/modules/seo/__tests__/indexnow.service.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  4 passed (4)`.
- [ ] Wire it into `IndexingService.drainPending`'s caller inside `runIndexingSubmitterJob` in `worker.ts` — this requires `drainPending` to also return which URLs it submitted; **do not change `IndexingService`'s public return shape** (that would ripple into Task 4's tests and Task 11's controller) — instead have `runIndexingSubmitterJob` separately re-query the just-submitted URLs by timestamp:

  ```ts
  import { IndexNowService } from "../modules/seo/indexnow.service";
  ```

  ```ts
  export async function runIndexingSubmitterJob(
    pool: Pool
  ): Promise<{ submitted: number; failed: number; skippedQuota: number }> {
    try {
      const adapter = {
        isEnabled: () => true,
        query: (text: string, params?: unknown[]) => pool.query(text, params)
      } as unknown as DatabaseService;
      const auth = new GoogleServiceAuth();
      const service = new IndexingService(adapter, auth);

      const quota =
        Number(process.env.GOOGLE_INDEXING_DAILY_QUOTA) || DEFAULT_GOOGLE_INDEXING_DAILY_QUOTA;
      const submittedToday = await service.submittedCountToday();
      const result = await service.drainPending(quota, submittedToday);

      // OPTIONAL bonus: IndexNow-ping Bing/Yandex with whatever we just
      // successfully pushed to Google. Best-effort, never affects `result`.
      if (result.submitted > 0 && process.env.INDEXNOW_KEY) {
        try {
          const { rows } = await pool.query<{ url: string }>(
            `SELECT url FROM seo_indexing_queue
             WHERE status = 'submitted' AND submitted_at >= now() - interval '20 minutes'
             ORDER BY submitted_at DESC LIMIT $1`,
            [result.submitted]
          );
          if (rows.length > 0) {
            const indexNow = new IndexNowService();
            await indexNow.submit(rows.map((r) => r.url));
          }
        } catch (indexNowError) {
          console.error(
            JSON.stringify({
              job: "indexing_submitter",
              sub_job: "indexnow_ping",
              error: indexNowError instanceof Error ? indexNowError.message : String(indexNowError),
              timestamp: new Date().toISOString()
            })
          );
        }
      }

      return result;
    } catch (error) {
      console.error(
        JSON.stringify({
          job: "indexing_submitter",
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        })
      );
      return { submitted: 0, failed: 0, skippedQuota: 0 };
    }
  }
  ```

- [ ] Add a focused test appended to `apps/api/test/worker-indexing-submitter.test.ts` confirming the IndexNow ping fires only when both `result.submitted > 0` AND `INDEXNOW_KEY` is set, and never throws even if it fails:

  ```ts
  describe("runIndexingSubmitterJob — optional IndexNow ping", () => {
    let poolQuery: ReturnType<typeof vi.fn>;
    let pool: { query: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      poolQuery = vi.fn();
      pool = { query: poolQuery };
      process.env.FF_SEO_INDEXING = "true";
      process.env.GSC_SERVICE_ACCOUNT_JSON = JSON.stringify(FAKE_KEY);
      process.env.INDEXNOW_KEY = "testkey123";
      process.env.INDEXNOW_HOST = "cribliv.com";
    });

    afterEach(() => {
      delete process.env.FF_SEO_INDEXING;
      delete process.env.GSC_SERVICE_ACCOUNT_JSON;
      delete process.env.INDEXNOW_KEY;
      delete process.env.INDEXNOW_HOST;
      vi.unstubAllGlobals();
    });

    it("pings IndexNow with the just-submitted URLs after a successful drain", async () => {
      poolQuery
        .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // submittedCountToday
        .mockResolvedValueOnce({ rows: [{ id: "q1", url: "https://cribliv.com/a", attempts: 0 }] }) // SELECT pending
        .mockResolvedValueOnce({ rows: [] }) // UPDATE submitted
        .mockResolvedValueOnce({ rows: [{ url: "https://cribliv.com/a" }] }); // re-query submitted URLs

      const googleFetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      const indexNowFetch = vi.fn(async () => ({ ok: true, status: 200 }));
      let callCount = 0;
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        callCount += 1;
        if (url === "https://api.indexnow.org/indexnow") return indexNowFetch(url, init);
        return googleFetch(url, init);
      });

      const result = await runIndexingSubmitterJob(pool as never);

      expect(result).toEqual({ submitted: 1, failed: 0, skippedQuota: 0 });
      expect(indexNowFetch).toHaveBeenCalledTimes(1);
      expect(callCount).toBeGreaterThanOrEqual(2); // Google token + Google publish + IndexNow
    });

    it("does not ping IndexNow when nothing was submitted", async () => {
      poolQuery.mockResolvedValueOnce({ rows: [{ count: 0 }] }).mockResolvedValueOnce({ rows: [] }); // no pending rows

      const indexNowFetch = vi.fn();
      vi.stubGlobal("fetch", indexNowFetch);

      await runIndexingSubmitterJob(pool as never);

      expect(indexNowFetch).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] Run it and confirm it passes:
      `pnpm --filter @cribliv/api exec vitest run test/worker-indexing-submitter.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  7 passed (7)`.
- [ ] Add the two new env vars to `.env.example`, commented as optional, right after the `GOOGLE_INDEXING_DAILY_QUOTA` line added in Task 3:
  ```
  # OPTIONAL — IndexNow (Bing/Yandex fast-track bonus). See indexnow.service.ts.
  INDEXNOW_KEY=
  INDEXNOW_HOST=cribliv.com
  ```
- [ ] Run the full API suite once more:
      `pnpm --filter @cribliv/api exec vitest run test/ src/ --reporter=dot 2>&1 | tail -30`
      Expected: no new failures.
- [ ] Commit:

  ```
  git add apps/api/src/modules/seo/indexnow.service.ts apps/api/src/modules/seo/__tests__/indexnow.service.test.ts apps/api/src/worker/worker.ts apps/api/test/worker-indexing-submitter.test.ts .env.example
  git commit -m "$(cat <<'EOF'
  feat(seo): add OPTIONAL IndexNow ping to the indexing_submitter job

  Bing/Yandex fast-track bonus (Google does not participate in IndexNow).
  Fully opt-in via INDEXNOW_KEY/INDEXNOW_HOST — a no-op when unset. Fires
  after a successful Indexing API drain, best-effort, never affects the
  job's returned counts.

  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 15: Full verification — typecheck, lint, build, full test suites, manual worker smoke test

**Files:** none (verification only — no new code)
**Interfaces:** Consumes every artifact produced by Tasks 1–13 (and 14 if implemented). Produces: a verified, green slice ready for `superpowers:finishing-a-development-branch`.

Steps:

- [ ] Confirm local Postgres is running and both DBs exist:
      `docker compose -f infra/docker-compose.yml up -d`
      `psql -h 127.0.0.1 -U postgres -lqt | grep -E 'cribliv_v2|cribliv_test' || (createdb -h 127.0.0.1 -U postgres cribliv_v2; createdb -h 127.0.0.1 -U postgres cribliv_test)`
      **DB-safety check** — before running anything below, confirm `DATABASE_URL` in your shell/`.env` points at `127.0.0.1`/`localhost`, never the Azure prod host:
      `echo "$DATABASE_URL" | grep -qE '127\.0\.0\.1|localhost' && echo "SAFE: local" || echo "STOP: DATABASE_URL is not local — do not proceed"`
- [ ] Run the full migration chain against `cribliv_v2` (includes migration `0045` from Task 1) and confirm it applies cleanly end to end:
      `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2' pnpm db:migrate`
      Expected: the log ends with `Applied 0045_seo_indexing_measurement.sql` (or whatever number Task 0 resolved to) and no errors.
- [ ] Run every integration test against `cribliv_test` (fresh DB, exercises the migration + rollback + upsert idempotency end to end one more time in isolation from dev data):
      `dropdb -h 127.0.0.1 -U postgres --if-exists cribliv_test && createdb -h 127.0.0.1 -U postgres cribliv_test`
      `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/migration-0045-seo-indexing-measurement.integration.test.ts`
      Expected: `Test Files  1 passed (1)` / `Tests  8 passed (8)`.
- [ ] Run the complete API test suite (unit + integration, matching the CI quarantine list in `vitest.config.ts`):
      `pnpm --filter @cribliv/api test`
      Expected: all suites pass; the only skips are the pre-existing `describe.runIf(!!TEST_DB)` integration suites when `TEST_DATABASE_URL` is unset in that particular invocation, and (in `CI`) the 3 pre-quarantined suites already excluded before this plan started.
- [ ] Run the complete web test suite:
      `pnpm --filter @cribliv/web test`
      Expected: all Playwright/Vitest suites pass, including both new `AdminShell` tab-registration tests and `SearchPerformanceTab.test.tsx`.
- [ ] Typecheck both apps:
      `pnpm typecheck`
      Expected: zero errors. Pay particular attention to `apps/api/src/modules/seo/*.ts`, `apps/api/src/worker/worker.ts`, and `apps/web/components/admin/tabs/SearchPerformanceTab.tsx` — these are the files this plan touched most.
- [ ] Lint both apps:
      `pnpm lint`
      Expected: no new lint errors introduced by this slice (the API's `lint` script is currently a placeholder per `apps/api/package.json` — `"lint": "echo 'api lint placeholder'"` — so this step is meaningful mainly for the web app's real ESLint config).
- [ ] Build both apps (turborepo respects the `packages/*` → `apps/*` dependency order automatically):
      `pnpm build`
      Expected: `apps/api` and `apps/web` both build without errors; in particular confirm the new `apps/api/src/modules/seo/google/google-service-auth.ts` (uses `node:crypto`, `node:fs`) compiles cleanly under the API's `tsconfig` target.
- [ ] Manual worker smoke test — start the worker against local dev DB with both flags **off** (the safe default) and confirm it boots without error and lists the two new jobs:
      `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2' FF_SEO_INDEXING=false FF_SEO_GSC=false pnpm --filter @cribliv/api worker &`
      Wait 3-5 seconds, then check the log output for the startup line, expected to contain (among the existing jobs) `"indexing_submitter"` and `"gsc_poller"` in the `jobs` array and `mode":"db"`. Then stop it:
      `kill %1` (or find the PID via `lsof -i` / `ps` if backgrounded differently).
- [ ] Manual worker smoke test — same, but with both flags **on** and no `GSC_SERVICE_ACCOUNT_JSON` configured, to confirm the "auth fails, job logs and no-ops, worker never crashes" invariant from the spec's section 6 holds in the real process (not just unit-mocked):
      `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2' FF_SEO_INDEXING=true FF_SEO_GSC=true pnpm --filter @cribliv/api worker &`
      Wait ~20 seconds (long enough for the run-once-at-boot calls to fire and fail), then check the log for `"job":"indexing_submitter"` and `"job":"gsc_poller"` error lines containing `GSC_SERVICE_ACCOUNT_JSON is not configured` — and confirm the process is STILL RUNNING (`ps aux | grep "worker.ts"` shows the process alive, not crashed/exited). Then stop it: `kill %1`.
- [ ] Confirm the admin routes are reachable end-to-end against a running API + the dev DB (flags can stay off — the read endpoints work regardless of `FF_SEO_INDEXING`/`FF_SEO_GSC` since they read whatever is already in the tables, which is legitimately empty in a fresh dev DB):
      `DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2' pnpm dev:api &`
      Wait for `Nest application successfully started`, then (using any valid admin bearer token from your local seed data, or the mock-OTP flow described in CLAUDE.md):
      `curl -s -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:4000/v1/admin/seo/search-performance | python3 -m json.tool`
      Expected: `{"data": {"items": [], "total": 0, "totals": {"total_impressions": 0, "total_clicks": 0, "avg_position": null}}}` (empty but well-formed, no 500).
      `curl -s -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:4000/v1/admin/seo/indexing-queue | python3 -m json.tool`
      Expected: `{"data": {"items": [], "total": 0, "summary": {"counts_by_status": {}, "submitted_today": 0, "daily_quota": 200}}}`.
      Then stop the API: `kill %1`.
- [ ] Review the full `git log --oneline` for this slice's commits (Tasks 1–13, plus 14 if implemented) and confirm every commit message ends with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer:
      `git log --oneline -20`
- [ ] Re-read `docs/superpowers/specs/2026-07-04-slice2-indexing-measurement-design.md` section 8 ("Testing") one final time and confirm every bullet has a corresponding passing test from Tasks 1–13: `GoogleServiceAuth` token mint/cache (Task 2) ✓; `IndexingService` quota gating + status transitions (Task 4) ✓; `GscService` response parsing + upsert shaping (Task 8) ✓; quick-wins filter (Task 10) ✓; migration shape/rollback (Task 1) ✓; `seo_indexing_queue` upsert/idempotency (Task 1 + Task 4) ✓; `keyword_rankings` unique-key upsert (Task 1 + Task 8) ✓; admin endpoints behind `@Roles('admin')` + audit rows written (Task 11) ✓.
- [ ] This is a verification-only task with no code changes — **do not create a commit for this task**. If every step above passed, the slice is complete and ready to hand off to `superpowers:finishing-a-development-branch` for the PR flow (branch → PR → review → squash-merge, per this user's stated preference).

---

## Activation checklist (reference only — not a build task, executed at the v1→v2 cutover)

This slice ships everything **behind flags, both default OFF**. Per the design spec section 7 and the roadmap's dependency note ("depends on: live site... activates at the v1→v2 cutover"), turning it on is a **separate, later, non-code event** coordinated with the cutover runbook (`docs/superpowers/specs/2026-07-04-cutover-seo-runbook-design.md`), not part of this implementation plan's task list:

1. v2 is live on cribliv.com with 301 redirects in place.
2. GSC property (`sc-domain:cribliv.com`) confirmed verified; the GCP service account added as a GSC property user (Owner/Full).
3. Env vars set in the real deployment: `GSC_SITE_URL`, `GSC_SERVICE_ACCOUNT_JSON`, `GOOGLE_INDEXING_DAILY_QUOTA`.
4. `sitemap_index.xml` submitted manually in GSC → Sitemaps (no new code — slice 1 already serves it).
5. Flip `FF_SEO_INDEXING=true` → the worker's `indexing_submitter` job starts draining any backlog that has accumulated in `seo_indexing_queue` since deploy (enqueue has been running all along, flag-agnostic).
6. Flip `FF_SEO_GSC=true` → the next `gsc_poller` tick (or the run-once-at-boot call on the next worker restart) seeds `keyword_rankings` for the first time.
7. Watch GSC coverage + the admin Search Performance tab for 1–2 weeks before slice 3 (blog) consumes this data for topic selection.
