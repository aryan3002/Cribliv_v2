# City Expansion (Programmatic SEO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Turn Cribliv's Lucknow-only programmatic SEO surface into a DB-driven, multi-city system where a new city (Noida first) is drafted+verified into seed data, then enabled at runtime from an admin toggle — with no redeploy and no Lucknow regression.
**Architecture:** A `seo_city_config` table (migration 0043) is the single source of truth for which cities have programmatic pages live; a NestJS DB-only `SeoCityConfigService` reads/writes it and exposes a public `GET /v1/seo/cities` (enabled-only) plus an audited admin `GET/PATCH /v1/admin/seo/cities`. The web layer replaces every hardcoded `SUPPORTED_CITIES = new Set(["lucknow"])` gate with `fetchEnabledCities()` (Lucknow-fallback), adds per-page thin-content `noindex`, and rebuilds the sitemap as DB-driven per-city `<urlset>` chunks fronted by a hand-written `<sitemapindex>` route. A standalone `generate-city` CLI (Azure OpenAI draft → Google geocode verify → reviewed JSON) produces seed data that the generalized `seed.ts` loaders ingest for any `data/seeds/<city>/` directory.
**Tech Stack:** Next.js 14.2.13 (App Router), NestJS, Postgres (+PostGIS/pgvector), Azure OpenAI, Google Maps/Places, pnpm/Turborepo, Vitest, Playwright.

## Global Constraints
- Next.js pinned at 14.2.13; do not add fonts beyond Inter/Manrope/Fraunces.
- SEO/AI services are DB-only (guard on DatabaseService.isEnabled(); no AppStateService fallback).
- Migrations are raw SQL in infra/migrations/; next free number is 0043; ship a paired .rollback.sql.
- Admin API routes use @UseGuards(AuthGuard, RolesGuard) @Roles("admin"); mutations write an admin_actions audit row.
- Google key env is GOOGLE_MAPS_APIKEY; Azure OpenAI is read per-service via local readAiConfig(); flags follow FF_X_ENABLED.
- The 26 intents come from data/seeds/lucknow/intents.json; Lucknow must not regress.
- TDD (test first), DRY, YAGNI, frequent small commits. No placeholders anywhere.

### Cross-cutting decisions locked by the adversarial reviews (read first)
1. **`fetchEnabledCities()` returns `Promise<Set<string>>`** (one contract, everywhere). The 6 templates call `.has(slug)`; the sitemap spreads it via `[...set]`. Every test that mocks it must resolve a `Set`, never an array. (Review 1 MAJOR 2, Review 2 BLOCKER 2, Review 3 MAJOR.)
2. **Migration 0043 MUST add the two admin enum values** (`admin_target_type += 'seo_city'`, `admin_action_type += 'toggle_seo_city'`) or the audited toggle throws at runtime. (Review 1 MAJOR 3, Review 2 BLOCKER 1.)
3. **Next 14.2.13 does NOT auto-emit a `<sitemapindex>`.** We ship a hand-written `app/sitemap_index.xml/route.ts` and point `robots.txt` at it; the `sitemap.ts` chunks stay `<urlset>` documents served at `/sitemap/<id>.xml`. (Review 3 BLOCKER.)
4. **Sitemap thin-exclusion is a deliberate reduction of Lucknow's locality surface, NOT "equivalence."** Verification asserts "all localities with `listing_count >= 3` present AND thin ones absent," and the magnitude is signed off on real data before ship. (Review 1 BLOCKER 1.)
5. **`metroSlug()` must NOT trim leading/trailing hyphens** — byte-identical to the template link + API resolver rule (`toLowerCase().replace(/[^a-z0-9]+/g,"-")`). (Reviews 1, 3 MINOR.)
6. **All DB integration tests live at `apps/api/test/*.integration.test.ts`** invoked with **package-relative** paths (`vitest run test/<file>`), because `--filter @cribliv/api exec` runs in `apps/api/`. The API vitest `include` is `["test/**/*.test.ts", "src/**/__tests__/**/*.test.ts"]`, so tests must end in `.test.ts` (never `.spec.ts`). (Review 2 BLOCKER 3, MAJOR 4, Review 4 note.)
7. **The generator distinguishes "place not found" from "API denied/throttled"** and aborts (non-zero, no file write) rather than overwrite good JSON with empties; it validates micro `parent_slug` against surviving localities and queries Google with the city `name_en, state_en, India` (not the slug). (Review 4 BLOCKERS 2/3, MAJOR 5.)

---

## Task 1: Migration 0043 — `seo_city_config` table + admin enums + rollback

**Files:**
- Create `infra/migrations/0043_seo_city_config.sql`
- Create `infra/migrations/0043_seo_city_config.rollback.sql`

**Interfaces:**
- Consumes: `cities(slug)` (`text UNIQUE NOT NULL`, `0001_init.sql:197`); enums `admin_target_type`, `admin_action_type` (`0001_init.sql:125,131`).
- Produces (relied on by Tasks 6, 8, 9, 11, 15, 16): table `seo_city_config(city_slug text PK, programmatic_enabled bool NOT NULL DEFAULT false, locality_count int NOT NULL DEFAULT 0, landmark_count int NOT NULL DEFAULT 0, metro_count int NOT NULL DEFAULT 0, indexable_count int NOT NULL DEFAULT 0, enabled_at timestamptz, notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`; partial index `idx_seo_city_config_enabled`; touch trigger `trg_seo_city_config_touch`; enum values `admin_target_type.'seo_city'`, `admin_action_type.'toggle_seo_city'`.

- [ ] **Step 1: Write the migration DDL.** Create `infra/migrations/0043_seo_city_config.sql`:

```sql
-- Migration 0043: SEO city config (programmatic-SEO enablement).
-- Single source of truth for "which cities have programmatic SEO pages live".
-- Consumed by the 6 route templates (via GET /v1/seo/cities) and the sitemap.
-- One row per city; city_slug FKs cities(slug) so a city must exist first.
-- Counts are DENORMALIZED snapshots refreshed by the admin PATCH path, not the
-- hot page path. indexable_count = places with listing_count >= 3. Seed rows
-- (lucknow enabled, noida disabled) are upserted in data/seeds/seed.ts, not here.

CREATE TABLE IF NOT EXISTS seo_city_config (
  city_slug            text PRIMARY KEY REFERENCES cities(slug) ON DELETE CASCADE,
  programmatic_enabled boolean NOT NULL DEFAULT false,
  locality_count       int NOT NULL DEFAULT 0,
  landmark_count       int NOT NULL DEFAULT 0,
  metro_count          int NOT NULL DEFAULT 0,
  indexable_count      int NOT NULL DEFAULT 0,
  enabled_at           timestamptz,
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seo_city_config_enabled
  ON seo_city_config (programmatic_enabled)
  WHERE programmatic_enabled = true;

CREATE OR REPLACE FUNCTION seo_city_config_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seo_city_config_touch ON seo_city_config;
CREATE TRIGGER trg_seo_city_config_touch
  BEFORE UPDATE ON seo_city_config
  FOR EACH ROW EXECUTE FUNCTION seo_city_config_touch_updated_at();

-- Admin audit vocabulary for the city toggle. ADD VALUE (not used in this same
-- txn) commits cleanly; run-migrations.js wraps each file in its own txn, and the
-- API that casts to these values deploys only after 0043 has committed.
ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'seo_city';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'toggle_seo_city';
```

- [ ] **Step 2: Write the rollback.** Create `infra/migrations/0043_seo_city_config.rollback.sql`:

```sql
-- Rollback for 0043_seo_city_config.sql
-- NOTE: Postgres cannot remove enum values, so 'seo_city' / 'toggle_seo_city'
-- remain on the admin enums after rollback. This is safe (unused) and accepted.
DROP TRIGGER IF EXISTS trg_seo_city_config_touch ON seo_city_config;
DROP FUNCTION IF EXISTS seo_city_config_touch_updated_at();
DROP INDEX IF EXISTS idx_seo_city_config_enabled;
DROP TABLE IF EXISTS seo_city_config;
```

- [ ] **Step 3: Confirm the runner discovers 0043 but not its rollback.**

```bash
node -e 'const fs=require("fs");const d="infra/migrations";const files=fs.readdirSync(d).filter(f=>/^\d+_.*\.sql$/.test(f)&&!/rollback/i.test(f)).sort();console.log("forward includes 0043:",files.includes("0043_seo_city_config.sql"));console.log("forward includes rollback:",files.includes("0043_seo_city_config.rollback.sql"));'
```

Expected:
```
forward includes 0043: true
forward includes rollback: false
```

- [ ] **Step 4: Commit.**

```bash
git add infra/migrations/0043_seo_city_config.sql infra/migrations/0043_seo_city_config.rollback.sql
git commit -m "feat(seo): add 0043_seo_city_config migration (table + admin enums) + rollback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Migration 0043 integration test — shape, index, trigger, FK, enums, rollback

**Files:**
- Create `apps/api/test/migration-0043-seo-city-config.integration.test.ts`

**Interfaces:**
- Consumes: `infra/migrations/0043_seo_city_config.sql` + `.rollback.sql` (Task 1); `cities(slug)` FK target.
- Produces: acceptance gate for Task 1. Mirrors `migration-0034.integration.test.ts`; `describe.runIf(!!TEST_DATABASE_URL)`; `MIG` from `apps/api/test/` is `../../../infra/migrations`.

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/migration-0043-seo-city-config.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");

describe.runIf(!!TEST_DB)("migration 0043_seo_city_config", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(readFileSync(join(MIG, "0043_seo_city_config.sql"), "utf8"));
  });
  afterAll(async () => {
    await client.query(readFileSync(join(MIG, "0043_seo_city_config.rollback.sql"), "utf8"));
    await client.end();
  });

  it("creates seo_city_config with city_slug as primary key", async () => {
    const r = await client.query(`
      SELECT a.attname FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'seo_city_config'::regclass AND i.indisprimary`);
    expect(r.rows.map((x) => x.attname)).toEqual(["city_slug"]);
  });

  it("has all config columns with correct types and NOT NULL/defaults", async () => {
    const r = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'seo_city_config' ORDER BY column_name`);
    const by = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
    expect(by.programmatic_enabled.data_type).toBe("boolean");
    expect(by.programmatic_enabled.is_nullable).toBe("NO");
    expect(by.programmatic_enabled.column_default).toContain("false");
    for (const col of ["locality_count", "landmark_count", "metro_count", "indexable_count"]) {
      expect(by[col].data_type, `${col} type`).toBe("integer");
      expect(by[col].is_nullable, `${col} nullable`).toBe("NO");
      expect(by[col].column_default, `${col} default`).toContain("0");
    }
    expect(by.enabled_at.data_type).toBe("timestamp with time zone");
    expect(by.enabled_at.is_nullable).toBe("YES");
    expect(by.notes.is_nullable).toBe("YES");
    expect(by.created_at.is_nullable).toBe("NO");
    expect(by.updated_at.is_nullable).toBe("NO");
  });

  it("enforces the FK to cities(slug) with ON DELETE CASCADE", async () => {
    const r = await client.query(`
      SELECT confdeltype FROM pg_constraint
      WHERE conrelid = 'seo_city_config'::regclass AND confrelid = 'cities'::regclass AND contype = 'f'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].confdeltype).toBe("c");
  });

  it("creates the partial enabled index", async () => {
    const r = await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_seo_city_config_enabled'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].indexdef).toContain("WHERE");
  });

  it("adds the admin enum values used by the audited toggle", async () => {
    const tgt = await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'admin_target_type' AND e.enumlabel = 'seo_city'`);
    const act = await client.query(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'admin_action_type' AND e.enumlabel = 'toggle_seo_city'`);
    expect(tgt.rowCount).toBe(1);
    expect(act.rowCount).toBe(1);
  });

  it("bumps updated_at on UPDATE via the touch trigger", async () => {
    await client.query(`INSERT INTO cities(slug, name_en, name_hi, state_en, state_hi, is_active)
      VALUES ('lucknow','Lucknow','lko','UP','up',true) ON CONFLICT(slug) DO NOTHING`);
    await client.query(`INSERT INTO seo_city_config (city_slug, updated_at)
      VALUES ('lucknow', now() - interval '1 day')
      ON CONFLICT (city_slug) DO UPDATE SET updated_at = now() - interval '1 day'`);
    const before = await client.query(`SELECT updated_at FROM seo_city_config WHERE city_slug='lucknow'`);
    await client.query(`UPDATE seo_city_config SET notes = 'touched' WHERE city_slug='lucknow'`);
    const after = await client.query(`SELECT updated_at FROM seo_city_config WHERE city_slug='lucknow'`);
    expect(new Date(after.rows[0].updated_at).getTime()).toBeGreaterThan(new Date(before.rows[0].updated_at).getTime());
    await client.query(`DELETE FROM seo_city_config WHERE city_slug='lucknow'`);
  });

  it("is idempotent (re-applying the forward migration does not error)", async () => {
    await expect(client.query(readFileSync(join(MIG, "0043_seo_city_config.sql"), "utf8"))).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run it, expect FAIL then PASS.** With a scratch Postgres migrated to 0042 (so `cities` + admin enums exist):

```bash
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test'
pnpm --filter @cribliv/api exec vitest run test/migration-0043-seo-city-config.integration.test.ts
```

To see RED before Task 1: run before the SQL files exist → `beforeAll` throws `ENOENT: ... 0043_seo_city_config.sql`. With Task 1 present, expect `Test Files  1 passed (1)` / `Tests  7 passed (7)`.

- [ ] **Step 3: Verify via the real runner (optional).**

```bash
DATABASE_URL="$TEST_DATABASE_URL" node infra/migrations/run-migrations.js
DATABASE_URL="$TEST_DATABASE_URL" node -e 'const{Client}=require("./apps/api/node_modules/pg");(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const r=await c.query("SELECT 1 FROM schema_migrations WHERE filename=$1",["0043_seo_city_config.sql"]);console.log("recorded:",r.rowCount===1);await c.end();})()'
```

Expected: `Applied 0043_seo_city_config.sql` and `recorded: true`.

- [ ] **Step 4: Commit.**

```bash
git add apps/api/test/migration-0043-seo-city-config.integration.test.ts
git commit -m "test(seo): 0043 migration shape + enums + trigger + rollback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Pure generator helpers — slugify, landmark-type map, transforms

**Files:**
- Create `data/seeds/generate-city-helpers.ts`
- Create `apps/api/test/generate-city-helpers.test.ts`

**Interfaces:**
- Produces (relied on by Tasks 4, 5, 7): `slugify(input: string): string`; `LANDMARK_TYPES: readonly LandmarkType[]` where `type LandmarkType = "college"|"hospital"|"mall"|"market"|"station"|"airport"|"it_park"|"office"|"religious"|"park"|"stadium"|"monument"`; `mapLandmarkType(raw: string): LandmarkType | null`; `dedupeBySlug<T extends {slug:string}>(items: T[]): T[]`; interfaces `LocalityCandidate`, `MicroLocalityCandidate`, `LandmarkCandidate`, `VerifiedPlace`, `LocalityOut`, `MicroLocalityOut`, `LandmarkOut`; `toLocalityOut(city_slug, cand, v): LocalityOut`; `toMicroLocalityOut(cand, v): MicroLocalityOut`; `toLandmarkOut(cand, v, type): LandmarkOut`.
- Consumes: nothing (pure, zero imports).

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/generate-city-helpers.test.ts` (imports `slugify`, `mapLandmarkType`, `dedupeBySlug`, the three transforms, `LANDMARK_TYPES`, and candidate types from `../../../data/seeds/generate-city-helpers`). Include these load-bearing assertions:

```ts
// slugify — apostrophes stripped BEFORE separator collapse (Review 4 BLOCKER 1)
expect(slugify("Sector 62")).toBe("sector-62");
expect(slugify("King George's Medical University")).toBe("king-georges-medical-university");
expect(slugify("St. Joseph's")).toBe("st-josephs");
expect(slugify("Dr. A.P.J. Abdul Kalam!")).toBe("dr-a-p-j-abdul-kalam");
expect(slugify("Sector – 18 // Atta")).toBe("sector-18-atta");
expect(slugify("विभूति खंड Vibhuti Khand")).toBe("vibhuti-khand");
expect(slugify("विभूति")).toBe("");
expect(slugify("!!!")).toBe("");
// mapLandmarkType
for (const t of LANDMARK_TYPES) expect(mapLandmarkType(t)).toBe(t);
expect(mapLandmarkType("University")).toBe("college");
expect(mapLandmarkType("shopping mall")).toBe("mall");
expect(mapLandmarkType("Bus Stand")).toBe("station");
expect(mapLandmarkType("tech park")).toBe("it_park");
expect(mapLandmarkType("temple")).toBe("religious");
expect(mapLandmarkType("nightclub")).toBeNull();
// dedupeBySlug keeps first
expect(dedupeBySlug([{slug:"a",n:1},{slug:"b",n:2},{slug:"a",n:3}])).toEqual([{slug:"a",n:1},{slug:"b",n:2}]);
```

Plus transform tests asserting `toLocalityOut("noida", {slug:"sector-62",name_en:"Sector 62",name_hi:"...",pincode:"201309"}, {canonical_name:"...",lat:28.6266,lng:77.3723})` equals `{city_slug:"noida",slug:"sector-62",name_en:"Sector 62",name_hi:"...",pincode:"201309",lat:28.6266,lng:77.3723}`; `toMicroLocalityOut` defaults `seo_aliases:[]`; `toLandmarkOut` defaults `aka:[]` and omits `primary_locality_slug` when absent.

- [ ] **Step 2: Run it, expect FAIL.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/generate-city-helpers.test.ts
```
Expected: FAIL — `Failed to resolve import "../../../data/seeds/generate-city-helpers"`.

- [ ] **Step 3: Write the minimal implementation.** Create `data/seeds/generate-city-helpers.ts` with the `LANDMARK_TYPES` tuple + `LandmarkType`; the candidate/output interfaces above; and:

```ts
/**
 * URL-safe slug. Removes apostrophes FIRST ("George's" -> "georges"), strips
 * non-ASCII (Devanagari/accents), lowercases, collapses non-alphanumeric runs to
 * a single hyphen, trims leading/trailing hyphens.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/['\u2019]/g, "")               // straight + curly apostrophes
    .normalize("NFKD")
    .replace(/[^\u0000-\u007f]/g, "")         // drop non-ASCII
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

`mapLandmarkType` uses a `Set<string>(LANDMARK_TYPES)` fast-path plus a synonym map (`university/institute/school/academy -> college`, `clinic/medical center(re) -> hospital`, `shopping mall/centre/center -> mall`, `metro/railway/train station, bus stand/station -> station`, `it/tech/software park -> it_park`, `business park/corporate office -> office`, `temple/mosque/church/gurudwara/mandir/masjid -> religious`, `garden -> park`, `sports/cricket stadium -> stadium`, `memorial -> monument`), returns `null` on empty/unmapped. `dedupeBySlug` keeps first per slug. The three transforms shape exactly the loader fields (conditionally include `pincode`/`primary_locality_slug`; default `seo_aliases`/`aka` to `[]`).

- [ ] **Step 4: Run the test, expect PASS.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/generate-city-helpers.test.ts
```
Expected: `Test Files  1 passed (1)`, `Tests  13 passed (13)`.

- [ ] **Step 5: Commit.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && git add data/seeds/generate-city-helpers.ts apps/api/test/generate-city-helpers.test.ts && git commit -m "feat(seeds): pure generator helpers (slugify, landmark_type map, transforms)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Google geocode verify helper (`verifyPlace`) — denied/throttle distinction, mocked fetch

**Files:**
- Modify `data/seeds/generate-city-helpers.ts` (append; no changes to existing exports)
- Create `apps/api/test/generate-city-verify.test.ts`

**Interfaces:**
- Consumes: `VerifiedPlace` (Task 3).
- Produces (relied on by Task 5): `type GeocodeFetch = typeof fetch`; `class GeocodeAbortError extends Error` (thrown on `REQUEST_DENIED`/`OVER_QUERY_LIMIT` so the run aborts rather than silently dropping — Review 4 BLOCKER 2); `buildGeocodeUrl(query: string, apiKey: string): string`; `parseGeocodeResponse(body: unknown): VerifiedPlace | "abort" | null` (returns `"abort"` for denied/throttled, `null` for `ZERO_RESULTS`/malformed, a `VerifiedPlace` for OK); `verifyPlace(query: string, apiKey: string, fetchImpl?: GeocodeFetch): Promise<VerifiedPlace | null>` (returns `null` on not-found/HTTP-error/network; **throws `GeocodeAbortError`** on denied/throttled).

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/generate-city-verify.test.ts` covering: `buildGeocodeUrl` contains `maps.googleapis.com/maps/api/geocode/json`, `address=` (URL-encoded) and `key=`; `parseGeocodeResponse` returns the `VerifiedPlace` for an OK body, `null` for `ZERO_RESULTS` and malformed bodies (`null`, `{status:"OK",results:[{}]}`, `{status:"OK"}`), and `"abort"` for `{status:"REQUEST_DENIED"}` and `{status:"OVER_QUERY_LIMIT"}`; `verifyPlace` returns the place on OK, `null` on `ZERO_RESULTS`, `null` on HTTP 500, `null` when fetch rejects, and **rejects with `GeocodeAbortError`** on `REQUEST_DENIED` and on `OVER_QUERY_LIMIT` (Review 4 MAJOR 4). Use a `jsonResponse(body, ok=true, status=200)` helper and `vi.fn()` mocks — no live calls.

- [ ] **Step 2: Run it, expect FAIL.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/generate-city-verify.test.ts
```
Expected: FAIL — `"buildGeocodeUrl" is not exported by "data/seeds/generate-city-helpers.ts"`.

- [ ] **Step 3: Append the implementation to `generate-city-helpers.ts`:**

```ts
export type GeocodeFetch = typeof fetch;

/** Thrown on REQUEST_DENIED / OVER_QUERY_LIMIT so the whole run aborts instead
 * of silently emitting empty files (a denied key must NOT look like "no place"). */
export class GeocodeAbortError extends Error {
  constructor(public readonly status: string) {
    super(`Google Geocoding aborted: ${status}`);
    this.name = "GeocodeAbortError";
  }
}

interface GeocodeResult { formatted_address?: string; geometry?: { location?: { lat?: number; lng?: number } }; }
interface GeocodeBody { status?: string; results?: GeocodeResult[]; error_message?: string; }

export function buildGeocodeUrl(query: string, apiKey: string): string {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", query);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

/** OK -> VerifiedPlace; ZERO_RESULTS/malformed -> null; denied/throttled -> "abort". */
export function parseGeocodeResponse(body: unknown): VerifiedPlace | "abort" | null {
  if (!body || typeof body !== "object") return null;
  const b = body as GeocodeBody;
  if (b.status === "REQUEST_DENIED" || b.status === "OVER_QUERY_LIMIT") return "abort";
  if (b.status !== "OK") return null;
  const top = b.results?.[0];
  const loc = top?.geometry?.location;
  if (!top || typeof top.formatted_address !== "string" || !loc ||
      typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
  return { canonical_name: top.formatted_address, lat: loc.lat, lng: loc.lng };
}

export async function verifyPlace(
  query: string, apiKey: string, fetchImpl: GeocodeFetch = fetch
): Promise<VerifiedPlace | null> {
  let res: Response;
  try {
    res = await fetchImpl(buildGeocodeUrl(query, apiKey));
  } catch { return null; }
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as unknown;
  const parsed = parseGeocodeResponse(body);
  if (parsed === "abort") {
    const status = (body as GeocodeBody)?.status ?? "unknown";
    // mirrors metro-walk.service.ts logging of status + error_message
    console.error(`Geocode ${status} for "${query}": ${(body as GeocodeBody)?.error_message ?? ""}`);
    throw new GeocodeAbortError(status);
  }
  return parsed;
}
```

- [ ] **Step 4: Run the test, expect PASS.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/generate-city-verify.test.ts
```
Expected: PASS — `Tests  11 passed (11)`.

- [ ] **Step 5: Commit.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && git add data/seeds/generate-city-helpers.ts apps/api/test/generate-city-verify.test.ts && git commit -m "feat(seeds): geocode verify with denied/throttle abort (mocked fetch tests)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: AI draft (`draftCity`) + orchestrator (`buildCityFiles`) + CLI + generate:city script

**Files:**
- Modify `data/seeds/generate-city-helpers.ts` (append AI-draft + `buildCityFiles`)
- Create `data/seeds/generate-city.ts` (CLI orchestrator)
- Create `apps/api/test/generate-city-draft.test.ts`
- Create `apps/api/test/generate-city-emit.test.ts`
- Modify `apps/api/package.json` and root `package.json` (add `generate:city` script — mirror the existing `db:seed` ts-node invocation exactly)

**Interfaces:**
- Consumes: Task 3 transforms + `slugify`/`mapLandmarkType`/`dedupeBySlug`; Task 4 `verifyPlace`.
- Produces: `interface DraftResult { localities: LocalityCandidate[]; micro_localities: MicroLocalityCandidate[]; landmarks: LandmarkCandidate[] }`; `interface AiConfig { endpoint: string; apiKey: string; deployment: string; timeoutMs: number }`; `readAiConfig(): AiConfig` (same env convention as `seo-copy.service.ts`); `buildDraftPrompt(cityName: string, stateName: string): string` (requests `aka`/`seo_aliases`, Review 4 MINOR 6); `type DraftFetch = typeof fetch`; `parseDraftResponse(content: string): DraftResult` (slugifies, drops bad/unmappable/empty-slug entries, dedupes, reads `c.seo_aliases` for micros and `c.aka` for landmarks); `draftCity(cityName, stateName, config, fetchImpl?): Promise<DraftResult>`; `buildCityFiles(cityName: string, stateName: string, citySlug: string, draft: DraftResult, verify: (query: string) => Promise<VerifiedPlace | null>): Promise<{ localities: LocalityOut[]; micro_localities: MicroLocalityOut[]; landmarks: LandmarkOut[]; dropped: string[] }>` — **note the extended signature: it takes `cityName`+`stateName` so verify queries use `"<name>, <state>, India"` not the slug (Review 4 MAJOR 3), and it validates micro `parent_slug` against surviving localities (Review 4 MAJOR 5)**.

- [ ] **Step 1: Write the failing draft test.** Create `apps/api/test/generate-city-draft.test.ts`. Assert: `buildDraftPrompt("Noida","Uttar Pradesh")` contains `Noida`, `Uttar Pradesh`, `localities`, `micro_localities`, `landmarks`, `it_park`, and asks for `aka`/`seo_aliases` (alternative spellings). `parseDraftResponse` on a mixed body: slugifies names, maps `"University" -> college` / `"shopping mall" -> mall`, drops a duplicate-slug locality, drops a missing-`name_en` entry, drops a micro missing `parent_slug`, drops an unmappable-type landmark and an empty-slug landmark (`name_en:"!!!"`), and carries `seo_aliases` from `c.seo_aliases`. `parseDraftResponse("not json")` returns `{localities:[],micro_localities:[],landmarks:[]}`. `draftCity` posts to `/openai/deployments/gpt-4o/chat/completions` with header `api-key` and returns parsed output; returns empty arrays (no throw) on HTTP 500.

- [ ] **Step 2: Write the failing emit test.** Create `apps/api/test/generate-city-emit.test.ts`. Assert `buildCityFiles("Noida","Uttar Pradesh","noida", DRAFT, fakeVerify)`:
  - queries `verify` with `"<name_en>, Uttar Pradesh, India"` (spy on the arg — Review 4 MAJOR 3);
  - drops an unverifiable locality and records `dropped` containing `"locality:ghost-area"`;
  - **drops a micro whose `parent_slug` was not among surviving localities** and records `"micro:<slug>"` (Review 4 MAJOR 5);
  - emits loader-shaped locality/micro/landmark objects (`seo_aliases:[]`, `aka:[]` defaults) with verified `lat`/`lng`;
  - is idempotent on slug (duplicate verified localities collapse to one).

- [ ] **Step 3: Run both, expect FAIL.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/generate-city-draft.test.ts test/generate-city-emit.test.ts
```
Expected: FAIL — `"buildDraftPrompt"`/`"buildCityFiles" is not exported`.

- [ ] **Step 4: Append the AI-draft + orchestrator to `generate-city-helpers.ts`.** `readAiConfig()` reads `AZURE_OPENAI_ENDPOINT`/`AZURE_OPENAI_API_KEY`/`AZURE_OPENAI_CHAT_DEPLOYMENT`(||`_EXTRACT_DEPLOYMENT`) and a `SEO_GENERATE_TIMEOUT_MS` (min 10000, default 30000). `buildDraftPrompt` requests the three arrays AND `aka` (landmarks) / `seo_aliases` (micros) as "common alternative spellings/abbreviations locals search for", requires `name_hi` in Devanagari, lists the 12 allowed types, and says every entry is Google-verified so hallucinations are discarded. `parseDraftResponse` slugifies, filters, dedupes, reads `c.seo_aliases` for micros. `draftCity` posts to `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=2024-10-21` with `response_format:{type:"json_object"}`, `AbortController` timeout, returns empty on any failure. Then:

```ts
export interface CityFiles {
  localities: LocalityOut[];
  micro_localities: MicroLocalityOut[];
  landmarks: LandmarkOut[];
  dropped: string[];
}

export async function buildCityFiles(
  cityName: string,
  stateName: string,
  citySlug: string,
  draft: DraftResult,
  verify: (query: string) => Promise<VerifiedPlace | null>
): Promise<CityFiles> {
  const q = (name: string) => `${name}, ${stateName}, India`; // strong disambiguation (Review 4 MAJOR 3)
  const dropped: string[] = [];
  const localities: LocalityOut[] = [];
  const micro_localities: MicroLocalityOut[] = [];
  const landmarks: LandmarkOut[] = [];

  for (const cand of dedupeBySlug(draft.localities)) {
    const v = await verify(q(cand.name_en));
    if (!v) { dropped.push(`locality:${cand.slug}`); continue; }
    localities.push(toLocalityOut(citySlug, cand, v));
  }
  const keptLocalitySlugs = new Set(localities.map((l) => l.slug));

  for (const cand of dedupeBySlug(draft.micro_localities)) {
    if (!keptLocalitySlugs.has(cand.parent_slug)) { dropped.push(`micro:${cand.slug}`); continue; } // Review 4 MAJOR 5
    const v = await verify(q(cand.name_en));
    if (!v) { dropped.push(`micro:${cand.slug}`); continue; }
    micro_localities.push(toMicroLocalityOut(cand, v));
  }

  for (const cand of dedupeBySlug(draft.landmarks)) {
    const v = await verify(q(cand.name_en));
    if (!v) { dropped.push(`landmark:${cand.slug}`); continue; }
    landmarks.push(toLandmarkOut(cand, v, mapLandmarkType(cand.type) ?? "monument"));
  }

  return {
    localities: dedupeBySlug(localities),
    micro_localities: dedupeBySlug(micro_localities),
    landmarks: dedupeBySlug(landmarks),
    dropped
  };
}
```

- [ ] **Step 5: Create the CLI `data/seeds/generate-city.ts`.** It: parses `--city <slug>` (exit 1 with usage if missing); loads the city `{name_en,state_en}` from `data/seeds/cities.json` (error if absent); reads `readAiConfig()` (error if unconfigured) and `GOOGLE_MAPS_APIKEY ?? NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (error if absent); `draftCity(name_en, state_en, aiConfig)`; wraps `verify = (query) => verifyPlace(query, googleKey)`; calls `buildCityFiles(name_en, state_en, citySlug, draft, verify)` **inside a try/catch that, on `GeocodeAbortError`, prints the status and exits 1 WITHOUT writing any files** (Review 4 BLOCKER 2); **aborts (exit 1, no write) if `dropped.length / totalCandidates > 0.30`** so a throttled/misconfigured run never overwrites good JSON with empties; on success writes `data/seeds/<slug>/micro-localities.json` and `landmarks.json`, and merges this city's rows into the shared `data/seeds/localities.json` via a `mergeLocalities()` that replaces only `row.city_slug === citySlug` (all output pretty-printed with a trailing newline); logs each `Dropped (unverified): <k>` and a final `REVIEW THE GIT DIFF before committing`. It NEVER touches the DB or `seo_city_config`. (Note for the operator: running `--city noida` will overwrite the pre-existing committed `sector-62` Noida locality in `localities.json` — this is intended, flagged per Review 4 cross-lens note.)

- [ ] **Step 6: Add the scripts.** First read the existing `apps/api` `db:seed` script and mirror its exact ts-node invocation (same flags / tsconfig resolution) for `generate:city` targeting `../../data/seeds/generate-city.ts` (Review 2 MAJOR 6 — do NOT invent an inline `--compiler-options` JSON). In root `package.json` add `"generate:city": "pnpm --filter @cribliv/api generate:city --"`.

- [ ] **Step 7: Run both tests, expect PASS.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/generate-city-draft.test.ts test/generate-city-emit.test.ts
```
Expected: PASS — draft + emit suites green.

- [ ] **Step 8: Verify the CLI arg-guard runs (no network).**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api generate:city; echo "exit=$?"
```
Expected: prints `Usage: generate-city --city <slug>` and `exit=1`. (If this does not parse, the ts-node invocation is wrong — fix per Step 6 before proceeding.)

- [ ] **Step 9: Commit.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && git add data/seeds/generate-city-helpers.ts data/seeds/generate-city.ts apps/api/test/generate-city-draft.test.ts apps/api/test/generate-city-emit.test.ts apps/api/package.json package.json && git commit -m "feat(seeds): generate-city CLI (draft->verify->emit) with abort-on-throttle + parent validation

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Generalize `seed.ts` loaders to every `data/seeds/<city>/` dir + seed config rows

**Files:**
- Create `data/seeds/seed-helpers.ts`
- Modify `data/seeds/seed.ts` (import helper; replace the two hardcoded-`lucknow` loader blocks at lines 201–345; add the `seo_city_config` upsert before `await client.end();` at line 347)
- Create `apps/api/test/seed-city-dirs.test.ts`
- Create `apps/api/test/seed-seo-city-config.integration.test.ts`

**Interfaces:**
- Consumes: `cityBySlug` (`Map<string,number>`, `seed.ts:75`); `cities` array (for `knownCitySlugs`); table `seo_city_config` (Task 1); `fs`/`path`.
- Produces: `listSeedCityDirs(seedDir: string, candidates: string[], probe: (dir: string) => boolean): string[]` — returns `candidates.filter((slug) => probe(join(seedDir, slug)))` where `probe` answers "is a directory holding micro-localities.json or landmarks.json". **No `DEFAULT_CANDIDATES` fallback** (Review 2 MAJOR 5); the real caller passes `knownCitySlugs` from `cities.json` and a real fs `probe`; the unit test passes a temp-dir fixture and the real `probe`.

- [ ] **Step 1: Write the failing `listSeedCityDirs` test.** Create `apps/api/test/seed-city-dirs.test.ts` that builds a **real temp directory** (via `fs.mkdtempSync`) with `lucknow/landmarks.json`, `noida/micro-localities.json`, an empty `emptycity/` dir, plus stray top-level files (`cities.json`), and asserts the production `probe` (`existsSync(join(dir,'micro-localities.json')) || existsSync(join(dir,'landmarks.json'))`, guarded by `existsSync(dir) && statSync(dir).isDirectory()`) returns exactly `["lucknow","noida"]` when `candidates=["lucknow","noida","emptycity","cities.json"]`. This exercises the real filesystem predicate, not a hardcoded array (Review 2 MAJOR 5).

- [ ] **Step 2: Write the failing seed-config integration test.** Create `apps/api/test/seed-seo-city-config.integration.test.ts` (`describe.runIf(!!TEST_DATABASE_URL)`; `MIG = join(__dirname, "../../../infra/migrations")` — the correct depth, Review 4 note flagged the wrong `../../infra`). In `beforeAll`: apply `0043_seo_city_config.sql`, upsert `cities` rows for `lucknow`+`noida`, run the exact upsert the seed block runs (`INSERT ... ('lucknow',true,now()),('noida',false,NULL) ON CONFLICT (city_slug) DO NOTHING`), then set noida to `true` and re-run the upsert to prove idempotency. Assert lucknow is enabled with `enabled_at` non-null, and that the re-run did NOT reset an admin-set noida flag (stays `true`). `afterAll` deletes the rows and applies the rollback.

- [ ] **Step 3: Run both, expect FAIL.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/seed-city-dirs.test.ts
export TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test'
pnpm --filter @cribliv/api exec vitest run test/seed-seo-city-config.integration.test.ts
```
Expected: first FAILs on `Failed to resolve import "../../../data/seeds/seed-helpers"`; second FAILs on lucknow row assertions (or is skipped without `TEST_DATABASE_URL`).

- [ ] **Step 4: Create `data/seeds/seed-helpers.ts`:**

```ts
// Pure, importable helpers for data/seeds/seed.ts (which runs on import).
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** Production probe: is <dir> a directory with micro-localities.json or landmarks.json? */
export function seedCityProbe(dir: string): boolean {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return existsSync(join(dir, "micro-localities.json")) || existsSync(join(dir, "landmarks.json"));
}

/** City-slug dirs to iterate. candidates are the known slugs from cities.json. */
export function listSeedCityDirs(
  seedDir: string,
  candidates: string[],
  probe: (dir: string) => boolean = seedCityProbe
): string[] {
  return candidates.filter((slug) => probe(join(seedDir, slug)));
}
```

- [ ] **Step 5: Rewrite the loader blocks in `seed.ts`.** Add near the top: `const { listSeedCityDirs } = require("./seed-helpers") as typeof import("./seed-helpers");`. Replace lines 201–345 with a single loop over `listSeedCityDirs(seedDir, cities.map((c) => c.slug))`. For each `citySlug` resolve `cityId = cityBySlug.get(citySlug)` (skip+warn if missing); load `micro-localities.json` (if present) upserting into `localities` with `ON CONFLICT (city_id, slug) DO UPDATE`; load `landmarks.json` (if present) upserting into `landmarks` with `$5::landmark_type` and `ON CONFLICT (city_id, slug) DO UPDATE`. **Hoist BOTH `geo_point` backfill `UPDATE`s out of the micro/landmark branches to run once per `citySlug` after both loaders** (Review 2 MAJOR 5 — so a landmarks-only city still backfills locality geo): one `UPDATE localities SET geo_point=... WHERE city_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL`, one `UPDATE landmarks SET geo_point=... WHERE city_id=$1 AND geo_point IS NULL`, each wrapped in try/catch for PostGIS-absent. SQL/params identical to today's Lucknow path (only the log text changes `Lucknow` → `lucknow`).

- [ ] **Step 6: Add the `seo_city_config` upsert** immediately before `await client.end();` (line 347), after the landmarks loop closes:

```ts
  // seo_city_config: which cities have programmatic SEO live. Idempotent —
  // ON CONFLICT DO NOTHING so a re-seed never clobbers an admin-set flag.
  try {
    await client.query(
      `INSERT INTO seo_city_config (city_slug, programmatic_enabled, enabled_at)
       VALUES ('lucknow', true, now()), ('noida', false, NULL)
       ON CONFLICT (city_slug) DO NOTHING`
    );
    console.log("Seeded seo_city_config: lucknow (enabled), noida (disabled).");
  } catch (err) {
    console.warn("seo_city_config seed skipped:", err instanceof Error ? err.message : err);
  }
```

- [ ] **Step 7: Run the unit test, expect PASS; run the integration test (with DB), expect PASS.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/seed-city-dirs.test.ts test/seed-seo-city-config.integration.test.ts
```
Expected: both green.

- [ ] **Step 8: Verify Lucknow load stays equivalent (local DB).**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm db:seed 2>&1 | grep -E "lucknow (micro-localities|landmarks)"
```
Expected: `Seeded <N> lucknow micro-localities.` and `Seeded <M> lucknow landmarks.` where N/M equal the array lengths in `data/seeds/lucknow/{micro-localities,landmarks}.json` (only log casing changed).

- [ ] **Step 9: Typecheck the seeds compile.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec tsc --noEmit --esModuleInterop --module CommonJS --moduleResolution Node --target ES2020 --resolveJsonModule --skipLibCheck data/seeds/seed.ts data/seeds/seed-helpers.ts data/seeds/generate-city-helpers.ts 2>&1 | head -20 || true
```
Expected: empty output (no errors).

- [ ] **Step 10: Commit.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && git add data/seeds/seed.ts data/seeds/seed-helpers.ts apps/api/test/seed-city-dirs.test.ts apps/api/test/seed-seo-city-config.integration.test.ts && git commit -m "feat(seeds): generalize loaders to every data/seeds/<city>/ + seed seo_city_config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Generator regression gate (full API suite green)

**Files:** none (verification only).

- [ ] **Step 1: Run all generator/seed unit tests together, expect PASS.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api exec vitest run test/generate-city-helpers.test.ts test/generate-city-verify.test.ts test/generate-city-draft.test.ts test/generate-city-emit.test.ts test/seed-city-dirs.test.ts
```
Expected: all files pass.

- [ ] **Step 2: Run the whole API suite (no regression).**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm --filter @cribliv/api test 2>&1 | tail -15
```
Expected: `Test Files  <N> passed`, no new failures. If anything fails, fix within the owning task (3–6) before proceeding. No commit.

---

## Task 8: `SeoCityConfigService` — DB-only list/toggle/counts

**Files:**
- Create `apps/api/src/modules/seo/seo-city-config.service.ts`
- Create `apps/api/test/seo-city-config.service.test.ts`

**Interfaces:**
- Consumes: `DatabaseService` (`isEnabled()`, `query<T>()`); `SeoAggregatesService.localitiesForCity(citySlug)` and `.metroStationsForCity(citySlug)`; table `seo_city_config` (Task 1).
- Produces (relied on by Tasks 9, 16): `export const INDEXABLE_MIN = 3`; `interface SeoCityConfigRow`; `interface SeoCityConfigWithCity extends SeoCityConfigRow { name_en; name_hi; is_active }`; `interface RefreshedCounts`; `listEnabled(): Promise<SeoCityConfigRow[]>` (`[]` when DB off); `listAllWithCounts(): Promise<SeoCityConfigWithCity[]>` (`[]` when DB off); `computeCounts(citySlug): Promise<RefreshedCounts>` (indexable = localities with `listing_count >= INDEXABLE_MIN`); `setEnabled(citySlug, enabled, notes?): Promise<SeoCityConfigRow | null>`.

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/seo-city-config.service.test.ts` (mock DB; no migration needed) covering: DB-off → `listEnabled`/`listAllWithCounts` return `[]` and `query` is never called; `listEnabled` SQL matches `programmatic_enabled = true` and is not a JOIN; `listAllWithCounts` SQL `FROM cities` + `LEFT JOIN seo_city_config` + `COALESCE(scc.programmatic_enabled, false)`; `computeCounts` derives `indexable_count` from `listing_count >= 3` (e.g. one of two localities), counts landmarks via a `FROM landmarks` query and metros via aggregates; `setEnabled` upserts with `enabled_at = CASE WHEN $2 THEN now() ELSE NULL END`, passes refreshed counts as params `[slug, enabled, notes, locality, landmark, metro, indexable]`, and returns the row; DB-off `setEnabled` → `null`.

- [ ] **Step 2: Run it, expect FAIL.**

```bash
pnpm --filter @cribliv/api exec vitest run test/seo-city-config.service.test.ts
```
Expected: `Cannot find module ../src/modules/seo/seo-city-config.service`.

- [ ] **Step 3: Write the service.** Create `apps/api/src/modules/seo/seo-city-config.service.ts` — `@Injectable`, injects `DatabaseService` + `SeoAggregatesService`, `export const INDEXABLE_MIN = 3`. `listEnabled` selects the config columns (`enabled_at::text`) `WHERE programmatic_enabled = true ORDER BY city_slug`. `listAllWithCounts` selects `c.slug AS city_slug, c.name_en, c.name_hi, c.is_active, COALESCE(...)` from `cities c LEFT JOIN seo_city_config scc ON scc.city_slug=c.slug ORDER BY COALESCE(scc.programmatic_enabled,false) DESC, c.slug`. `computeCounts` runs `localitiesForCity`/`metroStationsForCity`, computes `indexable = localities.filter(l => l.listing_count >= INDEXABLE_MIN).length`, and a `SELECT COUNT(*)::int FROM landmarks lm JOIN cities c ON c.id=lm.city_id WHERE c.slug=$1` (try/catch → 0). `setEnabled` (guard DB-off → null) computes counts, then `INSERT INTO seo_city_config (...) VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $2 THEN now() ELSE NULL END, now()) ON CONFLICT (city_slug) DO UPDATE SET ... enabled_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() RETURNING ... enabled_at::text`.

- [ ] **Step 4: Run tests, expect PASS.**

```bash
pnpm --filter @cribliv/api exec vitest run test/seo-city-config.service.test.ts
```
Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/seo/seo-city-config.service.ts apps/api/test/seo-city-config.service.test.ts
git commit -m "feat(seo): SeoCityConfigService — DB-only enabled-city config + counts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Wire `SeoCityConfigService` into `SeoModule` + public `GET /v1/seo/cities`

**Files:**
- Modify `apps/api/src/modules/seo/seo.module.ts` (add provider + export)
- Modify `apps/api/src/modules/seo/seo.controller.ts` (import + constructor + public route after `getMetro`)
- Create `apps/api/test/seo-cities.controller.test.ts`

**Interfaces:**
- Consumes: `SeoCityConfigService.listEnabled()` (Task 8); `ok<T>()`.
- Produces (relied on by Tasks 11, 14, 16): `GET /v1/seo/cities` (public, no guard) → `ok({ items: SeoCityConfigRow[] })`, enabled-only.

- [ ] **Step 1: Write the failing test.** Create `apps/api/test/seo-cities.controller.test.ts` — a Nest testing module with `SeoController`, stubbed `SeoAggregatesService`/`SeoCopyService`, and `SeoCityConfigService: { listEnabled: vi.fn(async () => ENABLED) }`. Assert `Reflect.getMetadata(GUARDS_METADATA, SeoController.prototype.listCities)` is `undefined` (public) and `GET /seo/cities` returns `200` with `{ data: { items: ENABLED } }`.

- [ ] **Step 2: Run it, expect FAIL.**

```bash
pnpm --filter @cribliv/api exec vitest run test/seo-cities.controller.test.ts
```
Expected: `SeoController.prototype.listCities` is undefined / compile failure.

- [ ] **Step 3: Wire the module + controller.** In `seo.module.ts` add `SeoCityConfigService` to `providers` and `exports`. In `seo.controller.ts` import it, add `private readonly cityConfig: SeoCityConfigService` to the constructor, and add after the `getMetro` handler:

```ts
  @Get("cities")
  async listCities() {
    return ok({ items: await this.cityConfig.listEnabled() });
  }
```

- [ ] **Step 4: Run tests, expect PASS (plus existing security test).**

```bash
pnpm --filter @cribliv/api exec vitest run test/seo-cities.controller.test.ts test/seo.controller.security.test.ts
```
Expected: both pass.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/modules/seo/seo.module.ts apps/api/src/modules/seo/seo.controller.ts apps/api/test/seo-cities.controller.test.ts
git commit -m "feat(seo): public GET /v1/seo/cities returns enabled cities only

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Feature flag `ff_programmatic_seo_cities_enabled`

**Files:**
- Modify `apps/api/src/config/feature-flags.ts` (interface after `ff_pg_admin_analytics`; `defaultFeatureFlags`; `readFeatureFlags()`)
- Create `apps/api/src/config/__tests__/feature-flags.seo.test.ts` (**`.test.ts`, not `.spec.ts`** — Review 2 MAJOR 4)

**Interfaces:**
- Produces: `FeatureFlags.ff_programmatic_seo_cities_enabled: boolean` (default `true`), env `FF_PROGRAMMATIC_SEO_CITIES_ENABLED`. Master kill-switch; real per-city control is `seo_city_config`.

- [ ] **Step 1: Write the failing test.** Create `apps/api/src/config/__tests__/feature-flags.seo.test.ts` asserting `defaultFeatureFlags.ff_programmatic_seo_cities_enabled === true`, `readFeatureFlags()` returns `true` when env unset, and `false` when `FF_PROGRAMMATIC_SEO_CITIES_ENABLED=off` (restore env in `afterEach`).

- [ ] **Step 2: Run it, expect FAIL.**

```bash
pnpm --filter @cribliv/api exec vitest run src/config/__tests__/feature-flags.seo.test.ts
```
Expected: `Property 'ff_programmatic_seo_cities_enabled' does not exist` / `expected undefined to be true`. (The `.test.ts` name IS collected by the `src/**/__tests__/**/*.test.ts` glob.)

- [ ] **Step 3: Add the flag** to the interface, `defaultFeatureFlags` (`ff_programmatic_seo_cities_enabled: true`), and `readFeatureFlags()` (`ff_programmatic_seo_cities_enabled: parseBooleanEnv("FF_PROGRAMMATIC_SEO_CITIES_ENABLED", defaultFeatureFlags.ff_programmatic_seo_cities_enabled)`), each after the `ff_pg_admin_analytics` entry.

- [ ] **Step 4: Run tests, expect PASS.**

```bash
pnpm --filter @cribliv/api exec vitest run src/config/__tests__/feature-flags.seo.test.ts
```
Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Commit.**

```bash
git add apps/api/src/config/feature-flags.ts apps/api/src/config/__tests__/feature-flags.seo.test.ts
git commit -m "feat(flags): add ff_programmatic_seo_cities_enabled (default on)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Admin SEO controller — GET + audited PATCH + deterministic UUID

**Files:**
- Create `apps/api/src/common/deterministic-uuid.ts`
- Create `apps/api/src/modules/admin/dto/toggle-seo-city.dto.ts`
- Create `apps/api/src/modules/admin/admin-seo.controller.ts`
- Modify `apps/api/src/modules/admin/admin.module.ts` (import `SeoModule`; register `AdminSeoController`)
- Create `apps/api/test/deterministic-uuid.test.ts`
- Create `apps/api/test/admin-seo.controller.test.ts`

**Interfaces:**
- Consumes: `SeoCityConfigService.listAllWithCounts()`/`setEnabled()` (Task 8, exported via Task 9); `DatabaseService`; `AuthGuard`/`RolesGuard`/`Roles`; `ok()`; `logTelemetry()`; the enum values `'seo_city'`/`'toggle_seo_city'` from Task 1.
- Produces (relied on by Task 15): `deterministicUuidV5(name: string, namespace?: string): string`; `GET /v1/admin/seo/cities` (`@Roles("admin")`) → `ok({ items: SeoCityConfigWithCity[] })`; `PATCH /v1/admin/seo/cities/:slug` body `{ programmatic_enabled: boolean; notes?: string }` → `ok(SeoCityConfigRow)`, writes an `admin_actions` audit row (`target_id = deterministicUuidV5(slug)`).

- [ ] **Step 1: Write the failing UUID test.** Create `apps/api/test/deterministic-uuid.test.ts` asserting: valid v5 shape, stability, difference across inputs, and the RFC 4122 vector `deterministicUuidV5("python.org","6ba7b810-9dad-11d1-80b4-00c04fd430c8") === "886313e1-3b8a-5372-9b90-0c9aee199e5d"`.

- [ ] **Step 2: Run it, expect FAIL** (`Cannot find module ../src/common/deterministic-uuid`).

```bash
pnpm --filter @cribliv/api exec vitest run test/deterministic-uuid.test.ts
```

- [ ] **Step 3: Implement `deterministic-uuid.ts`** — zero-dep SHA-1 name-based v5 over `namespaceBytes || nameBytes`, set version nibble to 5 and RFC variant bits, format hyphenated; default namespace `1b671a64-40d5-491e-99b0-da01ff1f3341`.

- [ ] **Step 4: Run the UUID test, expect PASS.**

```bash
pnpm --filter @cribliv/api exec vitest run test/deterministic-uuid.test.ts
```
Expected: `Tests  4 passed (4)`.

- [ ] **Step 5: Write the failing controller test.** Create `apps/api/test/admin-seo.controller.test.ts` — a test module with `AdminSeoController`, a stubbed `SeoCityConfigService` (`listAllWithCounts`, `setEnabled`), a mock `DatabaseService.query`, `RolesGuard` real, and `AuthGuard` overridden to inject `req.user`. Assert: a tenant gets `403`; as admin, `GET /admin/seo/cities` returns `{ data: { items: ALL } }`; `PATCH /admin/seo/cities/noida` with `{programmatic_enabled:true,notes:"reviewed"}` returns `200`, calls `setEnabled("noida", true, "reviewed")`, and issues an `INSERT INTO admin_actions` casting `'seo_city'::admin_target_type` + `'toggle_seo_city'::admin_action_type` with params `[user.id, deterministicUuidV5("noida"), notes, after_state_json]`; a non-boolean `programmatic_enabled` yields `400`.

- [ ] **Step 6: Run it, expect FAIL** (`Cannot find module ../src/modules/admin/admin-seo.controller`).

```bash
pnpm --filter @cribliv/api exec vitest run test/admin-seo.controller.test.ts
```

- [ ] **Step 7: Write the DTO + controller.** `dto/toggle-seo-city.dto.ts` = `interface ToggleSeoCityDto { programmatic_enabled: boolean; notes?: string }`. `admin-seo.controller.ts` = `@Controller("admin/seo") @UseGuards(AuthGuard, RolesGuard) @Roles("admin")`, injects `SeoCityConfigService` + `DatabaseService`; `GET cities` → `ok({ items: await cityConfig.listAllWithCounts() })`; `PATCH cities/:slug` validates the boolean (400 on bad payload), calls `setEnabled` (400 `db_disabled` if null), best-effort `admin_actions` INSERT (`.catch(() => undefined)`) with `deterministicUuidV5(slug)`, `logTelemetry("admin.seo_city_toggled", ...)`, returns `ok(row)`.

- [ ] **Step 8: Register in `admin.module.ts`** — import `AdminSeoController` + `SeoModule`; add `SeoModule` to `imports`; add `AdminSeoController` to `controllers`.

- [ ] **Step 9: Run both tests, expect PASS.**

```bash
pnpm --filter @cribliv/api exec vitest run test/admin-seo.controller.test.ts test/deterministic-uuid.test.ts
```
Expected: `Tests  8 passed (8)`.

- [ ] **Step 10: Commit.**

```bash
git add apps/api/src/common/deterministic-uuid.ts apps/api/src/modules/admin/admin-seo.controller.ts apps/api/src/modules/admin/dto/toggle-seo-city.dto.ts apps/api/src/modules/admin/admin.module.ts apps/api/test/admin-seo.controller.test.ts apps/api/test/deterministic-uuid.test.ts
git commit -m "feat(admin): admin SEO city endpoints (list + audited toggle)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: API regression + typecheck + build gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck.** `pnpm --filter @cribliv/api typecheck` — expect exit 0.
- [ ] **Step 2: Full API suite.** `pnpm --filter @cribliv/api test` — expect all files pass, including the new SEO service/controller/flag/uuid tests plus pre-existing `seo.controller.security.test.ts`.
- [ ] **Step 3: Nest build.** `pnpm --filter @cribliv/api build` — expect exit 0, `dist/` emitted. No commit unless lint auto-fixed files.

---

## Task 13: `fetchEnabledCities()` in seo-api with Lucknow fallback (returns `Set<string>`)

**Files:**
- Modify `apps/web/lib/seo-api.ts` (add `FALLBACK_CITY_SLUGS`, `SeoCityRow`, and `fetchEnabledCities` after `fetchLocalities`)
- Create `apps/web/lib/__tests__/seo-enabled-cities.test.ts`

**Interfaces:**
- Consumes: `fetchApi<T>()` (already imported); `GET /v1/seo/cities` → `{ items: Array<{ city_slug; programmatic_enabled }> }` (Task 9).
- Produces (relied on by Tasks 14 & 16 — SINGLE contract): `export async function fetchEnabledCities(): Promise<Set<string>>` — enabled slugs; on ANY error or empty result → `new Set(["lucknow"])`. Called WITHOUT `{ server: true }` and WITH `{ next: { revalidate: 3600 } }` so Next's fetch cache honors hourly revalidation.

- [ ] **Step 1: Write the failing test.** Create `apps/web/lib/__tests__/seo-enabled-cities.test.ts` (mock `../api`). Assert: enabled slugs returned as a `Set` (`.has("lucknow")`/`.has("noida")` true) and `fetchApi` called with `("/seo/cities", { next: { revalidate: 3600 } })`; disabled cities excluded; `f.mockRejectedValueOnce(...)` → `[...set]` equals `["lucknow"]`; `{}` payload → `["lucknow"]`; a payload with no enabled cities → `["lucknow"]`.

- [ ] **Step 2: Run it, expect FAIL.**

```bash
pnpm --filter @cribliv/web test seo-enabled-cities
```
Expected: `does not provide an export named 'fetchEnabledCities'`.

- [ ] **Step 3: Implement.** Add to `apps/web/lib/seo-api.ts`:

```ts
const FALLBACK_CITY_SLUGS = ["lucknow"];

interface SeoCityRow {
  city_slug: string;
  programmatic_enabled: boolean;
}

/**
 * Set of city slugs whose programmatic SEO pages are live (GET /v1/seo/cities).
 * Cached via Next fetch revalidation (1h). On ANY error — or no enabled cities —
 * falls back to ["lucknow"] so the reference city never goes dark.
 */
export async function fetchEnabledCities(): Promise<Set<string>> {
  try {
    const res = await fetchApi<{ items: SeoCityRow[] }>("/seo/cities", {
      next: { revalidate: 3600 }
    });
    const enabled = (res.items ?? []).filter((c) => c.programmatic_enabled).map((c) => c.city_slug);
    if (enabled.length === 0) return new Set(FALLBACK_CITY_SLUGS);
    return new Set(enabled);
  } catch {
    return new Set(FALLBACK_CITY_SLUGS);
  }
}
```

- [ ] **Step 4: Run tests, expect PASS.** `pnpm --filter @cribliv/web test seo-enabled-cities` — `Tests  5 passed (5)`.
- [ ] **Step 5: Typecheck.** `pnpm --filter @cribliv/web typecheck` — exit 0.
- [ ] **Step 6: Commit.**

```bash
git add apps/web/lib/seo-api.ts apps/web/lib/__tests__/seo-enabled-cities.test.ts
git commit -m "feat(web-seo): fetchEnabledCities() -> Set<string> with lucknow fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: City gate + thin-content noindex across all 6 templates

**Files (each modified):**
- `apps/web/app/[locale]/city/[citySlug]/[locality]/page.tsx`
- `apps/web/app/[locale]/city/[citySlug]/[locality]/[intent]/page.tsx`
- `apps/web/app/[locale]/city/[citySlug]/metro/[station]/page.tsx`
- `apps/web/app/[locale]/city/[citySlug]/metro/[station]/[intent]/page.tsx`
- `apps/web/app/[locale]/city/[citySlug]/near/[landmark]/page.tsx`
- `apps/web/app/[locale]/city/[citySlug]/near/[landmark]/[intent]/page.tsx`

**Interfaces:**
- Consumes: `fetchEnabledCities()` (Task 13, `Set<string>`); each template's existing place fetch; `buildPageMetadata({ noindex })` from `apps/web/lib/seo.ts` → `robots:{index:false,follow:true}`.
- Produces: none (leaf routes). Per template, apply the same 4 edits.

For **every** template:
1. Add `fetchEnabledCities` to the `seo-api` import.
2. Delete the `const SUPPORTED_CITIES = new Set(["lucknow"]);` line.
3. In `generateMetadata` success path, add `noindex: <thinExpr> < 3` to `buildPageMetadata(...)`.
4. Replace the runtime gate `if (!SUPPORTED_CITIES.has(params.citySlug)) notFound();` with:
   ```ts
   const enabledCities = await fetchEnabledCities();
   if (!enabledCities.has(params.citySlug)) notFound();
   ```

Thin-expression per template (spec §6.6 — intent pages proxy the parent place count):
- `[locality]/page.tsx`: `data.aggregates.listing_count`
- `[locality]/[intent]/page.tsx`: `data.aggregates.listing_count` (parent locality already fetched)
- `metro/[station]/page.tsx`: `data.aggregates.listing_count`
- `metro/[station]/[intent]/page.tsx`: `data.aggregates.listing_count`
- `near/[landmark]/page.tsx`: add `const bundle = await fetchLandmarkListings(params.citySlug, params.landmark, { radiusKm: 2, limit: 24 }); const listingCount = bundle?.items.length ?? 0;` → `noindex: listingCount < 3`
- `near/[landmark]/[intent]/page.tsx`: add `const parentCount = await fetchListings({ city: params.citySlug, lat: landmark.lat, lng: landmark.lng, radius_km: 2, page_size: 1 });` → `noindex: parentCount.total < 3`

- [ ] **Step 1: Apply the 4 edits to all 6 templates** (order-independent; different files).

- [ ] **Step 2: Typecheck, expect PASS.**

```bash
pnpm --filter @cribliv/web typecheck
```
Expected: exit 0 (fails until every `SUPPORTED_CITIES` reference is removed and every import added; `bundle?.items.length` / `parentCount.total` typecheck against the existing return types).

- [ ] **Step 3: Lint, expect PASS.** `pnpm --filter @cribliv/web lint` — no unused-import / undefined-name errors in the 6 files.

- [ ] **Step 4: Commit.**

```bash
git add "apps/web/app/[locale]/city/[citySlug]"
git commit -m "feat(web-seo): db-driven city gate + thin-content noindex across all 6 templates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 15: Sitemap — DB-driven per-city chunks + hand-written index route

**Files:**
- Create `apps/web/app/sitemap-chunks.ts` (pure builders)
- Modify `apps/web/app/sitemap.ts` (full rewrite: `generateSitemaps()` + `sitemap({ id })`)
- Create `apps/web/app/sitemap_index.xml/route.ts` (hand-written `<sitemapindex>` — Review 3 BLOCKER)
- Modify `apps/web/app/robots.txt/route.ts` (point `Sitemap:` at `/sitemap_index.xml`)
- Create `apps/web/app/__tests__/sitemap-chunks.test.ts`
- Create `apps/web/app/__tests__/sitemap.test.ts`

**Interfaces:**
- Consumes: `ALL_INTENTS`/`IntentDefinition` from `../lib/intent-filters`; `fetchEnabledCities()` (Task 13, `Set<string>`), `fetchLocalities`/`fetchLandmarks`/`fetchMetroStationsForCity` from `../lib/seo-api`; `buildSearchQuery`/`getApiBaseUrl` from `../lib/api`.
- Produces: pure builders `LOCALES`, `entry(baseUrl, path, opts?)`, `metroSlug(stationName)` (**no hyphen trim** — Review 1/3 MINOR), `LOCALITY_INTENTS`/`METRO_INTENTS`/`LANDMARK_INTENTS`, `buildCityLocalityEntries(baseUrl, citySlug, localities)` (thin `listing_count < 3` excluded), `buildCityMetroEntries`, `buildCityLandmarkEntries`; and in `sitemap.ts`: `resolveChunks()`, `generateSitemaps(): Promise<{id:number}[]>`, `default sitemap({ id }): Promise<MetadataRoute.Sitemap>`.

- [ ] **Step 1: Write the failing chunk-builder test.** Create `apps/web/app/__tests__/sitemap-chunks.test.ts` asserting: `entry` emits one row per locale with hreflang alternates; `metroSlug("Bhootnath Market") === "bhootnath-market"` and (regression guard) a station name with trailing punctuation keeps the trailing hyphen — i.e. `metroSlug` does the SAME transform as `stationName.toLowerCase().replace(/[^a-z0-9]+/g,"-")` with NO trim; intent counts 26/26/25; `buildCityLocalityEntries` excludes `listing_count < 3` (kept locality yields `(1 + 26) * 2` rows, thin fully absent); metro/landmark builders yield hub+intents per place × 2 locales.

- [ ] **Step 2: Run it, expect FAIL.** `pnpm --filter @cribliv/web exec vitest run app/__tests__/sitemap-chunks.test.ts` → `Cannot find module '../sitemap-chunks'`.

- [ ] **Step 3: Implement `sitemap-chunks.ts`.** `THIN_LISTING_THRESHOLD = 3`; `LOCALES = ["en","hi"] as const`; `entry()` maps both locales with `alternates.languages`; and **crucially**:

```ts
/** Byte-identical to the template link + API resolver rule — NO hyphen trim. */
export function metroSlug(stationName: string): string {
  return stationName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
```

`LOCALITY_INTENTS`/`METRO_INTENTS`/`LANDMARK_INTENTS` filter `ALL_INTENTS` by `applies_to`. `buildCityLocalityEntries` skips `listing_count < THIN_LISTING_THRESHOLD`, else emits hub (priority 0.75) + each locality intent (0.6). `buildCityMetroEntries`/`buildCityLandmarkEntries` emit hub + intents (metro/landmark thin pages are guarded by the per-page `noindex` from Task 14, since those list endpoints carry no `listing_count`).

- [ ] **Step 4: Run the chunk test, expect PASS.** `pnpm --filter @cribliv/web exec vitest run app/__tests__/sitemap-chunks.test.ts` → `Tests  7 passed (7)`.

- [ ] **Step 5: Write the failing sitemap test.** Create `apps/web/app/__tests__/sitemap.test.ts` (mock `../../lib/seo-api` so `fetchEnabledCities` resolves a **`Set`**, and the three fetchers resolve arrays; stub global `fetch` for listings). Assert: `generateSitemaps()` returns `[{id:0},{id:1},{id:2},{id:3}]` for `new Set(["lucknow","noida"])`; falls back to `[{id:0},{id:1},{id:2}]` when `fetchEnabledCities` rejects; `sitemap({id:0})` is the core chunk (home, city hubs, marketing pages, NO programmatic `/metro//near/` URLs); `sitemap({id:2})` builds Lucknow programmatic URLs from mocked DB data excluding thin localities; out-of-range id → `[]`; city fetches failing → `[]` (never throws).

- [ ] **Step 6: Run it, expect FAIL.** `pnpm --filter @cribliv/web exec vitest run app/__tests__/sitemap.test.ts` → `generateSitemaps is not a function`.

- [ ] **Step 7: Rewrite `sitemap.ts`.** Imports from `sitemap-chunks` + `seo-api` + `api`. `resolveChunks()`:

```ts
async function resolveChunks(): Promise<ChunkDescriptor[]> {
  let cities: string[];
  try {
    const enabled = [...(await fetchEnabledCities())]; // Set -> array (Reviews 1/2/3)
    cities = enabled.length > 0 ? enabled : FALLBACK_CITIES;
  } catch {
    cities = FALLBACK_CITIES;
  }
  return [{ kind: "core" }, { kind: "listings" }, ...cities.map((c) => ({ kind: "city" as const, citySlug: c }))];
}
```

`generateSitemaps()` returns `chunks.map((_, id) => ({ id }))`. `buildCoreChunk()` emits home + `HUB_CITIES` hubs + search/map + rent-in/pg + marketing pages. `buildListingsChunk()` pages `/listings/search` up to 5×60, try/catch → partial. `buildCityChunk(citySlug)` `Promise.all` the three fetchers (each `.catch(() => [])`) and concatenates the three builders (mapping `listing_count ?? 0`). `default sitemap({ id })` resolves chunks, returns `[]` for unknown id, else dispatches by kind.

- [ ] **Step 8: Create `app/sitemap_index.xml/route.ts`** (Review 3 BLOCKER — Next 14.2.13 does not auto-emit an index):

```ts
import { resolveChunkCount } from "../sitemap";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";
export const revalidate = 3600;

export async function GET(): Promise<Response> {
  const count = await resolveChunkCount(); // number of {id} chunks
  const now = new Date().toISOString();
  const entries = Array.from({ length: count }, (_, id) =>
    `  <sitemap><loc>${BASE_URL}/sitemap/${id}.xml</loc><lastmod>${now}</lastmod></sitemap>`
  ).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml" } });
}
```

Add `export async function resolveChunkCount(): Promise<number> { return (await resolveChunks()).length; }` to `sitemap.ts`.

- [ ] **Step 9: Point robots at the index.** In `apps/web/app/robots.txt/route.ts`, change the `Sitemap:` line from `${BASE_URL}/sitemap.xml` to `${BASE_URL}/sitemap_index.xml`.

- [ ] **Step 10: Confirm the hardcoded Lucknow JSON imports are gone.**

```bash
grep -nE "lucknow(Landmarks|MicroLocalities|Metro)|LUCKNOW_PARENT_LOCALITIES|metro-stations-lucknow|lucknow/landmarks|lucknow/micro-localities" apps/web/app/sitemap.ts; echo "exit=$?"
```
Expected: no matches, `exit=1`.

- [ ] **Step 11: Run both sitemap tests + typecheck, expect PASS.**

```bash
pnpm --filter @cribliv/web exec vitest run app/__tests__/sitemap.test.ts app/__tests__/sitemap-chunks.test.ts
pnpm --filter @cribliv/web exec tsc --noEmit
```
Expected: both suites pass; tsc exit 0.

- [ ] **Step 12: Commit.**

```bash
git add apps/web/app/sitemap.ts apps/web/app/sitemap-chunks.ts "apps/web/app/sitemap_index.xml/route.ts" apps/web/app/robots.txt/route.ts apps/web/app/__tests__/sitemap.test.ts apps/web/app/__tests__/sitemap-chunks.test.ts
git commit -m "feat(web,sitemap): DB-driven per-city chunks + hand-written sitemap index route

Removes hardcoded Lucknow JSON; robots points at /sitemap_index.xml; thin
localities excluded; metroSlug matches the resolver rule; graceful API-down fallback.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 16: Admin "Programmatic SEO" tab — admin-api client + tab component + shell wiring

**Files:**
- Modify `apps/web/lib/admin-api.ts` (append `SeoCityConfigVm`, `listSeoCities`, `setSeoCityEnabled`)
- Create `apps/web/lib/__tests__/admin-api-seo.test.ts`
- Create `apps/web/components/admin/tabs/SeoProgrammaticPages.tsx`
- Create `apps/web/components/admin/tabs/__tests__/SeoProgrammaticPages.test.tsx`
- Modify `apps/web/components/admin/shell/AdminSidebar.tsx` (`AdminTab` union + `Globe` icon + `understand` nav)
- Modify `apps/web/components/admin/shell/AdminShell.tsx` (import + `TAB_TITLES` + `switch` case)
- Create `apps/web/components/admin/shell/__tests__/AdminShell.seo-tab.test.tsx`

**Interfaces:**
- Consumes: `GET /v1/admin/seo/cities` / `PATCH /v1/admin/seo/cities/:slug` (Task 11); `fetchApi`/`authHeaders`; admin primitives `DataTable`/`Column`/`StatCard`/`StatusPill`.
- Produces: `interface SeoCityConfigVm { citySlug; nameEn; programmaticEnabled; localityCount; landmarkCount; metroCount; indexableCount; enabledAt; notes; updatedAt }`; `listSeoCities(accessToken): Promise<SeoCityConfigVm[]>`; `setSeoCityEnabled(accessToken, slug, enabled, notes?): Promise<SeoCityConfigVm>`; `SeoProgrammaticPages({ accessToken, onToast })`; `AdminTab` union gains `"seo"`.

- [ ] **Step 1: Write the failing admin-api test.** Create `apps/web/lib/__tests__/admin-api-seo.test.ts` (mock `../api`). Assert `listSeoCities("tok")` GETs `/admin/seo/cities` with `Authorization: Bearer tok`, maps snake_case→camelCase, tolerates missing `items` (→ `[]`); `setSeoCityEnabled("tok","noida",false,"note")` PATCHes with body `{programmatic_enabled:false,notes:"note"}`, maps the returned row; omits `notes` from the body when `undefined`.

- [ ] **Step 2: Run it, expect FAIL.** `pnpm --filter @cribliv/web test -- admin-api-seo` → `listSeoCities is not a function`.

- [ ] **Step 3: Append the client** to `apps/web/lib/admin-api.ts`: `SeoCityConfigVm` + internal `SeoCityConfigRaw` + `mapSeoCityRow` + `listSeoCities` (GET, `raw.items ?? []`) + `setSeoCityEnabled` (PATCH, conditional `notes`), all using `authHeaders(accessToken)`.

- [ ] **Step 4: Run tests, expect PASS.** `pnpm --filter @cribliv/web test -- admin-api-seo` → `4 passed`.

- [ ] **Step 5: Write the failing tab test.** Create `apps/web/components/admin/tabs/__tests__/SeoProgrammaticPages.test.tsx` (mock `../../../../lib/admin-api`). Assert: renders one row per city with counts; clicking "Enable Noida" calls `setSeoCityEnabled("tok","noida",true,undefined)` and fires `onToast`; empty list shows "No cities configured".

- [ ] **Step 6: Run it, expect FAIL.** `pnpm --filter @cribliv/web test -- SeoProgrammaticPages` → `Failed to resolve import "../SeoProgrammaticPages"`.

- [ ] **Step 7: Implement `SeoProgrammaticPages.tsx`** — `"use client"`, `Props { accessToken; onToast }` (mirrors `FraudTab`), loads via `listSeoCities`, toggles via `setSeoCityEnabled` (optimistic per-row `pending`), renders `admin-main__section` + `admin-page-title` + `admin-stat-grid` (StatCards: cities configured / live / indexable) + `DataTable` (columns: City, Status via `StatusPill` active/draft, Localities, Landmarks, Metro, Indexable, Enabled date, and an Enable/Disable `admin-btn` with `aria-label` `${willEnable?"Enable":"Disable"} ${nameEn}`), empty state "No cities configured".

- [ ] **Step 8: Run tab tests, expect PASS.** `pnpm --filter @cribliv/web test -- SeoProgrammaticPages` → `3 passed`.

- [ ] **Step 9: Write the failing shell test.** Create `apps/web/components/admin/shell/__tests__/AdminShell.seo-tab.test.tsx` (stub `../../tabs/SeoProgrammaticPages`). Render `<AdminShell accessToken="tok" />`, click the nav button `/programmatic seo/i`, assert the stubbed `seo-tab` renders with `seo:tok`.

- [ ] **Step 10: Run it, expect FAIL.** `pnpm --filter @cribliv/web test -- AdminShell.seo-tab` → no nav item named "programmatic seo".

- [ ] **Step 11: Wire the shell.** In `AdminSidebar.tsx`: import `Globe`; add `"seo"` to `AdminTab` before `"system"`; append `{ id: "seo", label: "Programmatic SEO", icon: Globe }` to the `understand` nav array. In `AdminShell.tsx`: import `SeoProgrammaticPages`; add `seo: "Programmatic SEO"` to `TAB_TITLES`; add before `case "system":` → `case "seo": return <SeoProgrammaticPages key={\`seo-${k}\`} accessToken={accessToken} onToast={push} />;`.

- [ ] **Step 12: Run the shell test, expect PASS.** `pnpm --filter @cribliv/web test -- AdminShell.seo-tab` → `1 passed`.

- [ ] **Step 13: Web build compiles (exhaustive `switch` forces the new case).**

```bash
pnpm --filter @cribliv/web build
```
Expected: `✓ Compiled successfully`, no TS errors.

- [ ] **Step 14: Commit.**

```bash
git add apps/web/lib/admin-api.ts apps/web/lib/__tests__/admin-api-seo.test.ts apps/web/components/admin/tabs/SeoProgrammaticPages.tsx apps/web/components/admin/tabs/__tests__/SeoProgrammaticPages.test.tsx apps/web/components/admin/shell/AdminSidebar.tsx apps/web/components/admin/shell/AdminShell.tsx apps/web/components/admin/shell/__tests__/AdminShell.seo-tab.test.tsx
git commit -m "feat(admin): Programmatic SEO tab (client + table + shell wiring)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 17: Generate + review + seed Noida (operator-run, live APIs)

**Files:**
- Create `data/seeds/noida/micro-localities.json`, `data/seeds/noida/landmarks.json` (generated + human-reviewed)
- Modify `data/seeds/localities.json` (Noida rows merged by the CLI)

**Interfaces:**
- Consumes: Task 5 `generate:city` CLI (needs live `AZURE_OPENAI_*` + `GOOGLE_MAPS_APIKEY`); `noida` already exists in `data/seeds/cities.json`.
- Produces: reviewed Noida seed data; Noida stays `programmatic_enabled = false` (Task 6 seed) until the admin toggle. NEVER auto-enable (spec §7).

- [ ] **Step 1: Dry-run the generator for Noida.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm generate:city --city noida
```
Expected: draft + verify logs, `Dropped (unverified): …` lines, a final `REVIEW THE GIT DIFF before committing`. If it exits 1 with a `GeocodeAbortError` (denied/throttled key) or a >30% drop-rate abort, fix the key/quotas and re-run — no files are written on abort (Task 5).

- [ ] **Step 2: Human-review the diff** (spec §7/§9.2). Inspect `git diff -- data/seeds/noida data/seeds/localities.json`: sanity-check locality/micro/landmark names, `name_hi` Devanagari present, `type` values valid, coords plausibly inside Noida, and that only Noida's rows changed in the shared `localities.json`. Delete any wrong-city or junk rows by hand.

- [ ] **Step 3: Seed locally and confirm Noida loads without disturbing Lucknow.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && pnpm db:seed 2>&1 | grep -E "(lucknow|noida) (micro-localities|landmarks)"
```
Expected: both cities' counts print; Lucknow counts unchanged from Task 6 Step 8.

- [ ] **Step 4: Confirm Noida is seeded disabled.**

```bash
psql "$DATABASE_URL" -c "SELECT city_slug, programmatic_enabled FROM seo_city_config ORDER BY city_slug;"
```
Expected: `lucknow | t` and `noida | f`.

- [ ] **Step 5: Commit the reviewed data.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master && git add data/seeds/noida/micro-localities.json data/seeds/noida/landmarks.json data/seeds/localities.json && git commit -m "data(seeds): reviewed Noida localities/micro-localities/landmarks (disabled)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 18: Full-stack verification

**Files:**
- Create `apps/web/scripts/verify-sitemap.mjs`
- Create/update `.claude/launch.json` (web + api entries, if needed for the preview server)

**Interfaces:**
- Consumes: everything above. Requires a migrated+seeded Postgres (Task 6 + Task 17), the API on 4000, and web on 3000.

- [ ] **Step 1: API build + full suite + typecheck.**

```bash
cd /Users/aryantripathi/Developer/Cribliv_v2-master
pnpm --filter @cribliv/api typecheck && pnpm --filter @cribliv/api test 2>&1 | tail -20 && pnpm --filter @cribliv/api build
```
Expected: typecheck exit 0; all API test files pass; Nest build succeeds.

- [ ] **Step 2: DB migrate + seed clean.**

```bash
pnpm db:migrate && pnpm db:seed 2>&1 | tail -20
```
Expected: `Applied 0043_seo_city_config.sql` (first run) then idempotent on re-run; seed logs show lucknow + noida micro/landmark counts and `Seeded seo_city_config: lucknow (enabled), noida (disabled).`

- [ ] **Step 3: Web build (all 6 templates + sitemap + admin tab).**

```bash
pnpm --filter @cribliv/web build
```
Expected: `✓ Compiled successfully`; no `SUPPORTED_CITIES` reference; the 6 `city/[citySlug]/**` routes appear as dynamic/ISR.

- [ ] **Step 4: Bring the stack up.** Start API (4000) and web (3000) with the DB seeded. Wait until `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/sitemap_index.xml` returns `200`.

- [ ] **Step 5: Curl the sitemap index + a city chunk.**

```bash
curl -s http://localhost:3000/sitemap_index.xml | grep -c '<sitemapindex'          # expect 1
curl -s http://localhost:3000/sitemap_index.xml | grep -oE '/sitemap/[0-9]+\.xml'   # list child chunks
curl -s http://localhost:3000/sitemap/2.xml | grep -oE '/en/city/lucknow/[a-z0-9-]+' | head   # Lucknow programmatic URLs
```
Expected: exactly one `<sitemapindex>`; ≥3 child `/sitemap/<id>.xml` locs; the Lucknow chunk lists locality/metro/near URLs. (robots now advertises `/sitemap_index.xml`, which resolves — Review 3 BLOCKER fixed.)

- [ ] **Step 6: Run the sitemap verification script.** Create `apps/web/scripts/verify-sitemap.mjs` that fetches `/sitemap_index.xml`, asserts it is a `<sitemapindex>`, fetches every child `<urlset>`, unions their `<loc>`s, and cross-checks against `GET /v1/seo/localities/lucknow`: every Lucknow locality with `listing_count >= 3` is present AND every `listing_count < 3` locality is absent (Review 1 BLOCKER 1 — assert the deliberate thin-exclusion, NOT raw "equivalence"), and each chunk has `<= 50000` URLs. Then:

```bash
BASE=http://localhost:3000 API_BASE=http://localhost:4000/v1 node apps/web/scripts/verify-sitemap.mjs
```
Expected: prints `thin excluded: N, kept present: M` then `SITEMAP VERIFICATION PASSED`, exit 0.

- [ ] **Step 7: Toggle a city via the admin PATCH and confirm it appears.** As an admin token, enable Noida and re-check the index grew a chunk:

```bash
curl -s -X PATCH http://localhost:4000/v1/admin/seo/cities/noida \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"programmatic_enabled":true,"notes":"launch verification"}' | grep -o '"programmatic_enabled":true'
psql "$DATABASE_URL" -c "SELECT target_type, action FROM admin_actions WHERE action='toggle_seo_city' ORDER BY created_at DESC LIMIT 1;"
curl -s http://localhost:3000/en/city/noida/sector-62 -o /dev/null -w "%{http_code}\n"   # was 404, now 200 after enable
```
Expected: PATCH returns `programmatic_enabled:true`; an `admin_actions` row `seo_city | toggle_seo_city` exists (proves the enum values from Task 1 work — Review 1/2 BLOCKER fixed); the Noida page returns `200` (was `404` while disabled). Toggle Noida back to `false` afterward to restore the launch state.

- [ ] **Step 8: Confirm a thin page noindexes and a healthy page does not.**

```bash
# find a Lucknow locality with listing_count < 3
THIN=$(curl -s "http://localhost:4000/v1/seo/localities/lucknow" | grep -oE '"slug":"[a-z0-9-]+","[^}]*"listing_count":[0-2]' | head -1)
echo "thin candidate: $THIN"
curl -s "http://localhost:3000/en/city/lucknow/<thin-slug>" | grep -o '<meta name="robots" content="noindex[^>]*>'
curl -s http://localhost:3000/en/city/lucknow/gomti-nagar | grep -c 'name="robots" content="noindex'
```
Expected: the thin page emits `<meta name="robots" content="noindex, follow">`; `gomti-nagar` (healthy, `listing_count >= 3`) prints `0` (no noindex).

- [ ] **Step 9: Fallback smoke — API down, Lucknow still resolves.** Stop the API, then:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/en/city/lucknow/gomti-nagar
```
Expected: `200` (`fetchEnabledCities` falls back to `["lucknow"]`). Restart the API afterward.

- [ ] **Step 10: Run both web + api full suites once more, tear down, commit the script.**

```bash
pnpm --filter @cribliv/web test 2>&1 | tail -10
pnpm --filter @cribliv/api test 2>&1 | tail -10
git add apps/web/scripts/verify-sitemap.mjs .claude/launch.json 2>/dev/null || git add apps/web/scripts/verify-sitemap.mjs
git commit -m "test(seo): full-stack sitemap + gate + noindex verification harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: both suites green; clean commit.
