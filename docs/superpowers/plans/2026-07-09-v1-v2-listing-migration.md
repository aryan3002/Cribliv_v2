# v1 → v2 Listing Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the 86 **verified** v1 listings (67 `properties` → flats, 19 `pgs` → PGs) from live MongoDB into v2 Postgres — with owners, photos (Cloudinary → Azure), geo, and a `v1_id → v2_id` map — via an idempotent, dry-run-by-default script the user runs.

**Architecture:** One standalone TypeScript entrypoint (`apps/api/src/migration/v1/migrate.ts`) run via ts-node, mirroring the existing `data/seeds/load-city.ts` safety harness (dry-run default → `--apply` commits; explicit `DATABASE_URL` in env, never reads `.env`; masked-host logging; per-listing transactions; `SAVEPOINT` for optional PostGIS). Pure mapping logic lives in dependency-free modules with vitest unit tests; I/O modules (Mongo read, Excel read, Azure upload, Postgres write) are thin and verified via dry-run reconciliation reports. A new migration `0052_v1_migration_map` provides the idempotency key and the 301-redirect source.

**Tech Stack:** TypeScript + ts-node (transpile-only), `pg` (already in api), `@azure/storage-blob@^12.31.0` (already in api), `mongodb` + `xlsx` (added to api), Node 25 global `fetch` (Cloudinary download), vitest@^2.1.8 (already in api).

**Spec:** `docs/superpowers/specs/2026-07-08-v1-v2-listing-migration-design.md`.

## Global Constraints

- **Location refinement:** code lives at `apps/api/src/migration/v1/` (spec said `scripts/migrate-v1-listings/`; moved for vitest coverage + dependency resolution — api's `node_modules` and vitest `include: src/**/__tests__/**`). Entry wired as api script `migrate:v1`.
- **Dry-run by default.** No flag → `BEGIN … ROLLBACK`, prints report, zero writes. `--apply` → `COMMIT`.
- **`DATABASE_URL` must be passed explicitly in the env.** The script does NOT read any `.env` file (so it can never accidentally hit the wrong DB). Same rule for `MONGO_URL`, `CLOUDINARY_CLOUD_NAME`, `EXCEL_PATH`, and the `AZURE_STORAGE_*` vars.
- **MongoDB access is READ-ONLY.** Only `.find()`/`.aggregate()`/`.countDocuments()`. Never write to Mongo.
- **Prod writes are the USER's.** The sandbox guard blocks prod DB/Azure writes. Run order: local v2 (dry-run → apply → eyeball) first, then the user runs prod.
- **Scope = `verified: true` only** — 67 properties + 19 pgs = 86. Never migrate unverified rows.
- **Idempotent:** keyed on `v1_id` in `v1_migration_map`, owners on `phone_e164`, photos on `(listing_id, client_upload_id)` with a deterministic `client_upload_id = 'v1:'+public_id`, deterministic blob paths.
- **Phone → E.164:** strip whitespace, strip leading zeros, keep an existing `+91`, else prepend `+91`; the 10 digits must form a valid Indian mobile — assert `/^[6-9]\d{9}$/` (leading 6–9), reject otherwise.
- **Owner phones verified 2026-07-09:** 86/86 clean 10-digit `ownerPhone` → Tier-1 covers all; Excel/import-fallback are safety nets.
- **Migration number:** `0051` is taken (`repair_listing_embeddings`) → this migration is **`0052`**.
- Commits end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

```
apps/api/src/migration/v1/
  migrate.ts            # entrypoint: arg parse, orchestration, dry-run/apply harness
  config.ts             # env read + validation (no dotenv); masked-host logging
  phone.ts              # E.164 normalize + validate (pure)
  cities.ts             # city-name → v2 slug map (pure) + ensureCity(client) DB helper
  v1-url.ts             # extract trailing ObjectId; build cloudinary URL (pure)
  types.ts              # shared TS shapes for source docs + mapped inputs
  mongo-source.ts       # read-only Mongo reader (verified properties + pgs)
  excel-source.ts       # Excel "Property Master" → Map<normName, phoneE164>
  owners.ts             # 3-tier resolve (pure) + upsertOwner(client, phone, name)
  cloudinary.ts         # downloadImage(url) → {buffer, contentType}
  azure-photos.ts       # buildBlobName + uploadPhoto(buffer, contentType, ...)
  map-flat.ts           # property doc → FlatInput (pure)
  write-flat.ts         # insert flat chain in a txn (listings→locations→geo→photos→map)
  map-pg.ts             # pg doc → PgInput (pure): amenities/rooms/bathrooms mappers
  write-pg.ts           # insert pg chain in a txn (pg_properties→pg_listings→…→map)
  report.ts             # reconciliation report accumulator + printer
  README.md             # how to run (env, dry-run, apply, order)
  __tests__/
    phone.test.ts
    cities.test.ts
    v1-url.test.ts
    owners.test.ts
    map-flat.test.ts
    map-pg.test.ts

infra/migrations/
  0052_v1_migration_map.sql
  0052_v1_migration_map.rollback.sql
```

---

# PHASE A — Shared pipeline + 67 flats

Phase-A milestone (after Task A9): all 67 verified `properties` migrate into local v2 with owners, geo, photos, and a complete `v1_migration_map`, idempotently.

---

## Task A1: Migration `0052_v1_migration_map`

**Files:**

- Create: `infra/migrations/0052_v1_migration_map.sql`
- Create: `infra/migrations/0052_v1_migration_map.rollback.sql`

**Interfaces:**

- Produces: table `v1_migration_map(v1_id text PK, v1_collection text, v1_name text, v2_listing_id uuid FK→listings(id), owner_source text, migrated_at timestamptz)`.

- [ ] **Step 1: Write the forward migration**

`infra/migrations/0052_v1_migration_map.sql`:

```sql
-- Migration 0052: v1 → v2 listing migration map.
-- One row per migrated v1 document. Two jobs:
--   (1) idempotency key — the migration script upserts keyed on v1_id, so a
--       re-run never creates duplicate listings.
--   (2) 301 source — the cutover redirect generator reads this to pair each old
--       v1 URL (…/properties/<slug>-<v1_id>) to its v2 canonical URL.
CREATE TABLE IF NOT EXISTS v1_migration_map (
  v1_id         text PRIMARY KEY,                        -- Mongo _id (24-hex string)
  v1_collection text NOT NULL,                           -- 'properties' | 'pgs'
  v1_name       text,                                    -- nameListing (for reporting / URL join)
  v2_listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  owner_source  text NOT NULL,                           -- 'mongo' | 'excel' | 'import_fallback'
  migrated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_v1_migration_map_listing ON v1_migration_map (v2_listing_id);
CREATE INDEX IF NOT EXISTS idx_v1_migration_map_collection ON v1_migration_map (v1_collection);
```

- [ ] **Step 2: Write the rollback**

`infra/migrations/0052_v1_migration_map.rollback.sql`:

```sql
-- Rollback for 0052_v1_migration_map.sql
DROP INDEX IF EXISTS idx_v1_migration_map_collection;
DROP INDEX IF EXISTS idx_v1_migration_map_listing;
DROP TABLE IF EXISTS v1_migration_map;
```

- [ ] **Step 3: Apply against the LOCAL dev DB and verify**

Run (local dev DB — never prod):

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2" \
  node infra/migrations/run-migrations.js
```

Expected: `Applied 0052_v1_migration_map.sql` (and any prior unapplied). Then:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2" \
  -c "\d v1_migration_map"
```

Expected: table with the 6 columns + PK on `v1_id`.

- [ ] **Step 4: Commit**

```bash
git add infra/migrations/0052_v1_migration_map.sql infra/migrations/0052_v1_migration_map.rollback.sql
git commit -m "feat(migration): 0052 v1_migration_map table

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A2: Dependencies + config + entrypoint harness

**Files:**

- Modify: `apps/api/package.json` (add `mongodb`, `xlsx` deps; add `migrate:v1` script)
- Create: `apps/api/src/migration/v1/config.ts`
- Create: `apps/api/src/migration/v1/migrate.ts`
- Create: `apps/api/src/migration/v1/README.md`

**Interfaces:**

- Produces: `loadConfig(): MigrationConfig` where
  `MigrationConfig = { databaseUrl: string; mongoUrl: string; mongoDb: string; cloudinaryCloud: string; excelPath?: string; azure: { account: string; key: string; container: string }; apply: boolean; collection: 'properties' | 'pgs' | 'both'; maskedDbHost: string }`.
- Produces: `pnpm --filter @cribliv/api migrate:v1 [--apply] [--collection properties|pgs|both]`.

- [ ] **Step 1: Add deps and the script to `apps/api/package.json`**

In `"dependencies"` add (keep alphabetical near existing entries):

```json
"mongodb": "^6.12.0",
"xlsx": "^0.18.5",
```

In `"scripts"` add (mirrors the `generate:city` invocation):

```json
"migrate:v1": "ts-node --files --transpile-only --compiler-options '{\"module\":\"CommonJS\",\"moduleResolution\":\"Node\",\"target\":\"ES2020\",\"esModuleInterop\":true}' src/migration/v1/migrate.ts"
```

Then install:

```bash
pnpm install
```

Expected: `mongodb` and `xlsx` resolve under `apps/api/node_modules`.

- [ ] **Step 2: Write `config.ts` (env read + validation, NO dotenv)**

`apps/api/src/migration/v1/config.ts`:

```ts
export type Collection = "properties" | "pgs" | "both";

export interface MigrationConfig {
  databaseUrl: string;
  mongoUrl: string;
  mongoDb: string;
  cloudinaryCloud: string;
  excelPath?: string;
  azure: { account: string; key: string; container: string };
  apply: boolean;
  skipPhotos: boolean;
  collection: Collection;
  maskedDbHost: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v)
    throw new Error(
      `Missing required env ${name} (pass it explicitly; this script never reads .env)`
    );
  return v;
}

export function maskDbHost(url: string): string {
  return url.replace(/:\/\/[^@]*@/, "://***@").replace(/\?.*$/, "");
}

export function loadConfig(): MigrationConfig {
  const databaseUrl = required("DATABASE_URL");
  const collectionArg = (arg("collection") ?? "both") as Collection;
  if (!["properties", "pgs", "both"].includes(collectionArg)) {
    throw new Error(`--collection must be properties | pgs | both (got "${collectionArg}")`);
  }
  // Azure Blob is NOT transactional — an upload sticks even on dry-run ROLLBACK.
  // Skip photos for LOCAL validation so prod Azure stays clean until cutover.
  const skipPhotos = hasFlag("skip-photos");
  // Azure creds only required when we actually copy photos (i.e. NOT --skip-photos).
  const azureReq = skipPhotos ? (name: string) => process.env[name]?.trim() || "" : required;
  return {
    databaseUrl,
    mongoUrl: required("MONGO_URL"),
    mongoDb: process.env.MONGO_DB?.trim() || "test",
    cloudinaryCloud: required("CLOUDINARY_CLOUD_NAME"),
    excelPath: process.env.EXCEL_PATH?.trim() || undefined,
    azure: {
      account: azureReq("AZURE_STORAGE_ACCOUNT_NAME"),
      key: azureReq("AZURE_STORAGE_ACCOUNT_KEY"),
      container: process.env.AZURE_STORAGE_CONTAINER_LISTING_PHOTOS?.trim() || "listing-photos"
    },
    apply: hasFlag("apply"),
    skipPhotos,
    collection: collectionArg,
    maskedDbHost: maskDbHost(databaseUrl)
  };
}
```

- [ ] **Step 3: Write the `migrate.ts` harness skeleton**

`apps/api/src/migration/v1/migrate.ts` (orchestration is filled in later tasks; this establishes the safety harness):

```ts
import { loadConfig } from "./config";

const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const { Client } = requireFromApi("pg") as {
  Client: new (input: { connectionString: string; ssl?: unknown }) => any;
};

async function main() {
  const cfg = loadConfig();
  console.log(`\n=== v1→v2 migration → ${cfg.maskedDbHost} ===`);
  console.log(`collection: ${cfg.collection}`);
  console.log(
    cfg.apply ? "MODE: APPLY (will COMMIT)\n" : "MODE: DRY-RUN (will ROLLBACK — no changes)\n"
  );

  const client = new Client({
    connectionString: cfg.databaseUrl,
    ssl:
      cfg.databaseUrl.includes("127.0.0.1") || cfg.databaseUrl.includes("localhost")
        ? undefined
        : { rejectUnauthorized: false }
  });
  await client.connect();

  try {
    await client.query("BEGIN");
    // --- orchestration added in later tasks ---
    console.log("(no migration steps wired yet)");
    if (cfg.apply) {
      await client.query("COMMIT");
      console.log("\n✅ COMMITTED.");
    } else {
      await client.query("ROLLBACK");
      console.log("\n↩️  DRY-RUN — rolled back, no changes. Re-run with --apply to commit.");
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("\n❌", e instanceof Error ? e.message : e);
  process.exit(1);
});
```

- [ ] **Step 4: Write `README.md`**

`apps/api/src/migration/v1/README.md`: document required env vars (`DATABASE_URL`, `MONGO_URL`, `MONGO_DB`, `CLOUDINARY_CLOUD_NAME`, `EXCEL_PATH`, `AZURE_STORAGE_ACCOUNT_NAME`, `AZURE_STORAGE_ACCOUNT_KEY`, `AZURE_STORAGE_CONTAINER_LISTING_PHOTOS`), the dry-run/apply flags, and the run order (local dry-run → local apply → prod apply by the user). Include a copy-paste block that exports env inline (never a committed file) and the read-only reminder for `MONGO_URL`.

- [ ] **Step 5: Verify the harness fails safe and dry-runs**

```bash
# Missing DATABASE_URL must throw:
( cd apps/api && pnpm migrate:v1 ) ; echo "exit=$?"
```

Expected: `❌ Missing required env DATABASE_URL …`, `exit=1`.

```bash
# Dry-run against local with a dummy Mongo (only DB connect is exercised here):
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2" \
MONGO_URL="mongodb://placeholder" CLOUDINARY_CLOUD_NAME="dia01qg8p" \
AZURE_STORAGE_ACCOUNT_NAME="x" AZURE_STORAGE_ACCOUNT_KEY="y" \
  bash -c 'cd apps/api && pnpm migrate:v1'
```

Expected: prints masked host, `MODE: DRY-RUN`, `(no migration steps wired yet)`, `↩️  DRY-RUN — rolled back`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/migration/v1/config.ts apps/api/src/migration/v1/migrate.ts apps/api/src/migration/v1/README.md pnpm-lock.yaml
git commit -m "feat(migration): v1 script scaffold + config + dry-run harness

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A3: Phone E.164 normalizer (pure, TDD)

**Files:**

- Create: `apps/api/src/migration/v1/phone.ts`
- Test: `apps/api/src/migration/v1/__tests__/phone.test.ts`

**Interfaces:**

- Produces: `normalizeE164(raw: string | number | null | undefined): string | null` — returns `+91XXXXXXXXXX` or `null` if not a valid 10-digit Indian number.

- [ ] **Step 1: Write the failing test**

`apps/api/src/migration/v1/__tests__/phone.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeE164 } from "../phone";

describe("normalizeE164", () => {
  it("prefixes a bare 10-digit string", () => {
    expect(normalizeE164("9998887776")).toBe("+919998887776");
  });
  it("keeps an existing +91", () => {
    expect(normalizeE164("+919998887776")).toBe("+919998887776");
  });
  it("strips spaces and leading zeros", () => {
    expect(normalizeE164(" 09998887776 ")).toBe("+919998887776");
  });
  it("accepts a numeric (Excel float artifact)", () => {
    expect(normalizeE164(9998887776)).toBe("+919998887776");
  });
  it("strips a 91 country prefix without +", () => {
    expect(normalizeE164("919998887776")).toBe("+919998887776");
  });
  it("rejects a 9-digit number", () => {
    expect(normalizeE164("904440412")).toBeNull();
  });
  it("rejects empty / null", () => {
    expect(normalizeE164("")).toBeNull();
    expect(normalizeE164(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/migration/v1/__tests__/phone.test.ts`
Expected: FAIL — `Cannot find module '../phone'`.

- [ ] **Step 3: Write the implementation**

`apps/api/src/migration/v1/phone.ts`:

```ts
/** Normalize a raw Indian phone to E.164 (+91XXXXXXXXXX) or null if invalid. */
export function normalizeE164(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  // Excel stores mobiles as floats (e.g. 9998887776.0) — drop any decimal.
  let s = typeof raw === "number" ? Math.trunc(raw).toString() : String(raw);
  s = s.trim().replace(/\s+/g, "").replace(/[()-]/g, "");
  if (!s) return null;
  if (s.startsWith("+91")) s = s.slice(3);
  else if (s.startsWith("91") && s.length === 12) s = s.slice(2);
  s = s.replace(/^0+/, "");
  // Valid Indian mobile: exactly 10 digits, leading 6-9. Rejects garbage 10-digit strings.
  if (!/^[6-9]\d{9}$/.test(s)) return null;
  return `+91${s}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/migration/v1/__tests__/phone.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migration/v1/phone.ts apps/api/src/migration/v1/__tests__/phone.test.ts
git commit -m "feat(migration): E.164 phone normalizer + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A4: City normalization + ensureCity

**Files:**

- Create: `apps/api/src/migration/v1/cities.ts`
- Test: `apps/api/src/migration/v1/__tests__/cities.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `normalizeCitySlug(rawCity: string): string | null` (pure); `CITY_SEED: Record<string, {name_en,name_hi,state_en,state_hi}>`; `ensureCities(client): Promise<Map<string, number>>` — inserts any missing seed city (notably **Varanasi**) and returns `slug → cities.id`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/migration/v1/__tests__/cities.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeCitySlug } from "../cities";

describe("normalizeCitySlug", () => {
  it("maps known cities", () => {
    expect(normalizeCitySlug("Gurugram")).toBe("gurugram");
    expect(normalizeCitySlug("Lucknow")).toBe("lucknow");
    expect(normalizeCitySlug("Varanasi")).toBe("varanasi");
  });
  it("trims the trailing-space Lucknow variant", () => {
    expect(normalizeCitySlug("Lucknow ")).toBe("lucknow");
  });
  it("is case-insensitive", () => {
    expect(normalizeCitySlug("GURUGRAM")).toBe("gurugram");
  });
  it("returns null for an unknown city", () => {
    expect(normalizeCitySlug("Atlantis")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/migration/v1/__tests__/cities.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

`apps/api/src/migration/v1/cities.ts`:

```ts
export const CITY_SEED: Record<
  string,
  { name_en: string; name_hi: string; state_en: string; state_hi: string }
> = {
  gurugram: { name_en: "Gurugram", name_hi: "गुरुग्राम", state_en: "Haryana", state_hi: "हरियाणा" },
  lucknow: {
    name_en: "Lucknow",
    name_hi: "लखनऊ",
    state_en: "Uttar Pradesh",
    state_hi: "उत्तर प्रदेश"
  },
  varanasi: {
    name_en: "Varanasi",
    name_hi: "वाराणसी",
    state_en: "Uttar Pradesh",
    state_hi: "उत्तर प्रदेश"
  }
};

/** v1 free-text city → canonical v2 slug (trims the "Lucknow " variant). */
export function normalizeCitySlug(rawCity: string): string | null {
  const key = (rawCity ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const direct = key.replace(/\s+/g, "");
  if (CITY_SEED[direct]) return direct;
  const byName = Object.entries(CITY_SEED).find(
    ([slug, v]) => v.name_en.toLowerCase() === key || slug === direct
  );
  return byName ? byName[0] : null;
}

/**
 * Ensure every seed city exists; returns slug → cities.id. Idempotent
 * (ON CONFLICT (slug) DO NOTHING). Adds Varanasi, which v2 lacks.
 */
export async function ensureCities(client: {
  query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }>;
}): Promise<Map<string, number>> {
  for (const [slug, c] of Object.entries(CITY_SEED)) {
    await client.query(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi, is_active)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (slug) DO NOTHING`,
      [slug, c.name_en, c.name_hi, c.state_en, c.state_hi]
    );
  }
  const { rows } = await client.query(`SELECT id, slug FROM cities`);
  return new Map(rows.map((r: { id: number; slug: string }) => [r.slug, r.id]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/migration/v1/__tests__/cities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migration/v1/cities.ts apps/api/src/migration/v1/__tests__/cities.test.ts
git commit -m "feat(migration): city slug normalization + ensureCities (adds Varanasi)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A5: v1-url + cloudinary URL helpers (pure, TDD)

**Files:**

- Create: `apps/api/src/migration/v1/v1-url.ts`
- Test: `apps/api/src/migration/v1/__tests__/v1-url.test.ts`

**Interfaces:**

- Produces: `extractV1ObjectId(url: string): string | null` (trailing 24-hex token); `cloudinaryUrl(cloud: string, publicId: string): string`; `extFromContentType(ct: string): 'jpg'|'png'|'webp'|'bin'`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/migration/v1/__tests__/v1-url.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { extractV1ObjectId, cloudinaryUrl, extFromContentType } from "../v1-url";

describe("extractV1ObjectId", () => {
  it("pulls the trailing 24-hex ObjectId", () => {
    expect(
      extractV1ObjectId(
        "https://cribliv.com/properties/3-bhk-for-rent-near-krishna-nagar-alambagh-69940773dd3811521305c48c"
      )
    ).toBe("69940773dd3811521305c48c");
  });
  it("handles the slug-format-drift variant", () => {
    expect(
      extractV1ObjectId(
        "https://cribliv.com/properties/3bhk-for-rent-near-rashmi-khand-bangla-bazaar-699805342d0966d6047925b0"
      )
    ).toBe("699805342d0966d6047925b0");
  });
  it("returns null when no ObjectId is present", () => {
    expect(extractV1ObjectId("https://cribliv.com/about")).toBeNull();
  });
});

describe("cloudinaryUrl", () => {
  it("builds the delivery URL", () => {
    expect(cloudinaryUrl("dia01qg8p", "cribliv/properties/abc/img.png")).toBe(
      "https://res.cloudinary.com/dia01qg8p/image/upload/cribliv/properties/abc/img.png"
    );
  });
});

describe("extFromContentType", () => {
  it("maps mimes", () => {
    expect(extFromContentType("image/jpeg")).toBe("jpg");
    expect(extFromContentType("image/png")).toBe("png");
    expect(extFromContentType("image/webp")).toBe("webp");
    expect(extFromContentType("application/octet-stream")).toBe("bin");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (module not found).

- [ ] **Step 3: Write the implementation**

`apps/api/src/migration/v1/v1-url.ts`:

```ts
/** Extract the trailing 24-hex Mongo ObjectId from a v1 /properties/…-<id> URL. */
export function extractV1ObjectId(url: string): string | null {
  const m = String(url).match(/([a-f0-9]{24})(?:[/?#].*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

export function cloudinaryUrl(cloud: string, publicId: string): string {
  return `https://res.cloudinary.com/${cloud}/image/upload/${publicId}`;
}

export function extFromContentType(ct: string): "jpg" | "png" | "webp" | "bin" {
  const t = (ct || "").split(";")[0].trim().toLowerCase();
  if (t === "image/jpeg" || t === "image/jpg") return "jpg";
  if (t === "image/png") return "png";
  if (t === "image/webp") return "webp";
  return "bin";
}
```

- [ ] **Step 4: Run test — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migration/v1/v1-url.ts apps/api/src/migration/v1/__tests__/v1-url.test.ts
git commit -m "feat(migration): v1 ObjectId extractor + cloudinary URL helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A6: Source readers (Mongo read-only + Excel) + shared types

**Files:**

- Create: `apps/api/src/migration/v1/types.ts`
- Create: `apps/api/src/migration/v1/mongo-source.ts`
- Create: `apps/api/src/migration/v1/excel-source.ts`

**Interfaces:**

- Produces `types.ts`:

```ts
export interface V1Property {
  _id: string;
  nameListing?: string;
  description?: string;
  ownerPhone?: string;
  owner?: string;
  ownerEmail?: string;
  userId?: string;
  bedrooms?: number;
  bathrooms?: number;
  area?: number;
  floor?: string | number;
  furnishing?: string;
  type?: string;
  pref_tenant?: string;
  expected_rent?: number | string;
  expected_deposit?: number | string;
  avail_from?: string | Date;
  houseNum?: string;
  society?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string | number;
  amenities?: string[];
  location?: { type?: string; coordinates?: [number, number] }; // [lng, lat]
  cloudinary_public_ids?: string[];
  verified?: boolean;
}
export interface V1Pg extends V1Property {
  rooms?: Array<{
    roomNumber?: string | number;
    beds?: Array<{ type?: string; count?: number }>;
    bathrooms?: Array<{ type?: string }>;
    expected_rent?: number | string;
    expected_deposit?: number | string;
    floor?: string | number;
    area?: number;
  }>;
  services?: string[];
  // pgs store amenities as objects, not strings:
  amenities?: any; // overridden — see map-pg.ts (Array<{amenityName}> | string[])
}
export type OwnerSource = "mongo" | "excel" | "import_fallback";
```

- Produces `mongo-source.ts`: `fetchVerified(cfg, collection: 'properties'|'pgs'): Promise<any[]>` — read-only.
- Produces `excel-source.ts`: `loadOwnerPhoneByName(excelPath): Map<string, string>` — normalized Property Name → E.164 phone.

- [ ] **Step 1: Write `mongo-source.ts` (READ-ONLY)**

```ts
import type { MigrationConfig } from "./config";
const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const { MongoClient } = requireFromApi("mongodb");

/** Read-only fetch of verified docs. Never writes to Mongo. */
export async function fetchVerified(
  cfg: MigrationConfig,
  collection: "properties" | "pgs"
): Promise<any[]> {
  const client = new MongoClient(cfg.mongoUrl);
  await client.connect();
  try {
    const db = client.db(cfg.mongoDb);
    const docs = await db.collection(collection).find({ verified: true }).toArray();
    // Coerce ObjectId _id → hex string for stable keys.
    return docs.map((d: any) => ({ ...d, _id: String(d._id) }));
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 2: Write `excel-source.ts`**

```ts
import { normalizeE164 } from "./phone";
const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const XLSX = requireFromApi("xlsx");

export function normName(s: string): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Property Name (normalized) → E.164 phone, from the "Property Master" sheet. */
export function loadOwnerPhoneByName(excelPath: string): Map<string, string> {
  const wb = XLSX.readFile(excelPath);
  const sheet = wb.Sheets["Property Master"] ?? wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  const map = new Map<string, string>();
  for (const r of rows) {
    const name = normName(r["Property Name"]);
    const phone = normalizeE164(r["Owner Mobile"]);
    if (name && phone && !map.has(name)) map.set(name, phone);
  }
  return map;
}
```

- [ ] **Step 3: Verify Mongo read against the live DB (read-only) — user runs, or dry connectivity check**

Run (user provides read-only `MONGO_URL`):

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2" \
MONGO_URL="<read-only-mongo-url>" MONGO_DB="test" CLOUDINARY_CLOUD_NAME="dia01qg8p" \
AZURE_STORAGE_ACCOUNT_NAME="x" AZURE_STORAGE_ACCOUNT_KEY="y" \
  bash -c 'cd apps/api && node -e "require(\"ts-node/register/transpile-only\"); (async()=>{const {loadConfig}=require(\"./src/migration/v1/config\");const {fetchVerified}=require(\"./src/migration/v1/mongo-source\");const c=loadConfig();console.log(\"props\", (await fetchVerified(c,\"properties\")).length);console.log(\"pgs\", (await fetchVerified(c,\"pgs\")).length);})()"'
```

Expected: `props 67`, `pgs 19`.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/migration/v1/types.ts apps/api/src/migration/v1/mongo-source.ts apps/api/src/migration/v1/excel-source.ts
git commit -m "feat(migration): read-only Mongo reader + Excel owner-phone reader

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A7: Owner resolution + upsert

**Files:**

- Create: `apps/api/src/migration/v1/owners.ts`
- Test: `apps/api/src/migration/v1/__tests__/owners.test.ts`

**Interfaces:**

- Consumes: `normalizeE164` (A3), `normName` (A6), `OwnerSource` (A6).
- Produces: `resolveOwnerPhone(doc, excelByName): { phone: string | null; source: OwnerSource }` (pure); `upsertOwner(client, phoneE164, fullName): Promise<string>` (returns `users.id`); `IMPORT_FALLBACK_PHONE` constant.

- [ ] **Step 1: Write the failing test**

`apps/api/src/migration/v1/__tests__/owners.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveOwnerPhone } from "../owners";

describe("resolveOwnerPhone", () => {
  const excel = new Map<string, string>([["green villa", "+919111111111"]]);
  it("Tier 1: uses mongo ownerPhone", () => {
    const r = resolveOwnerPhone({ ownerPhone: "9998887776", nameListing: "Green Villa" }, excel);
    expect(r).toEqual({ phone: "+919998887776", source: "mongo" });
  });
  it("Tier 2: falls back to Excel by name", () => {
    const r = resolveOwnerPhone({ ownerPhone: "", nameListing: "Green Villa" }, excel);
    expect(r).toEqual({ phone: "+919111111111", source: "excel" });
  });
  it("Tier 3: import fallback when neither present", () => {
    const r = resolveOwnerPhone({ ownerPhone: "", nameListing: "Unknown" }, excel);
    expect(r.source).toBe("import_fallback");
    expect(r.phone).toBeNull();
  });
  it("Tier 3: import fallback when mongo phone is malformed", () => {
    const r = resolveOwnerPhone({ ownerPhone: "904440412", nameListing: "Unknown" }, excel);
    expect(r.source).toBe("import_fallback");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.**

- [ ] **Step 3: Write the implementation**

`apps/api/src/migration/v1/owners.ts`:

```ts
import { normalizeE164 } from "./phone";
import { normName } from "./excel-source";
import type { OwnerSource } from "./types";

/** Dedicated fallback owner account for listings with no resolvable phone. */
export const IMPORT_FALLBACK_PHONE = "+910000000001";
export const IMPORT_FALLBACK_NAME = "Cribliv Import";

export function resolveOwnerPhone(
  doc: { ownerPhone?: string | number; nameListing?: string },
  excelByName: Map<string, string>
): { phone: string | null; source: OwnerSource } {
  const fromMongo = normalizeE164(doc.ownerPhone);
  if (fromMongo) return { phone: fromMongo, source: "mongo" };
  const fromExcel = excelByName.get(normName(doc.nameListing ?? ""));
  if (fromExcel) return { phone: fromExcel, source: "excel" };
  return { phone: null, source: "import_fallback" };
}

/** Idempotent upsert of an owner by phone. Returns users.id. */
export async function upsertOwner(
  client: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  phoneE164: string,
  fullName: string | null
): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO users (phone_e164, role, full_name, preferred_language)
     VALUES ($1, 'owner'::user_role, $2, 'en')
     ON CONFLICT (phone_e164) DO UPDATE SET
       role = 'owner',
       is_blocked = false,
       full_name = COALESCE(users.full_name, EXCLUDED.full_name)
     RETURNING id::text`,
    [phoneE164, fullName]
  );
  return rows[0].id;
}
```

- [ ] **Step 4: Run test — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migration/v1/owners.ts apps/api/src/migration/v1/__tests__/owners.test.ts
git commit -m "feat(migration): 3-tier owner resolution + phone-keyed owner upsert

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A8: Flat mapper (property → FlatInput) + photo I/O

**Files:**

- Create: `apps/api/src/migration/v1/map-flat.ts`
- Create: `apps/api/src/migration/v1/cloudinary.ts`
- Create: `apps/api/src/migration/v1/azure-photos.ts`
- Test: `apps/api/src/migration/v1/__tests__/map-flat.test.ts`

**Interfaces:**

- Produces `map-flat.ts`: `mapFurnishing(v1?: string): 'unfurnished'|'semi_furnished'|'fully_furnished'|null`; `mapTenantPref(v1?: string): 'any'|'family'|'bachelor'|'female'|'male'|null`; `toInt(v): number|null`; `mapFlat(doc: V1Property): FlatInput` where

```ts
export interface FlatInput {
  v1Id: string;
  titleEn: string;
  descriptionEn: string | null;
  monthlyRent: number;
  securityDeposit: number | null;
  bhk: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  furnishing: string | null;
  preferredTenant: string | null;
  availableFrom: string | null;
  whatsappAvailable: boolean;
  amenities: string[];
  citySlug: string | null;
  addressLine1: string;
  landmark: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  publicIds: string[];
  warnings: string[]; // e.g. "no rent", "unknown city", "no geo"
}
```

- Produces `cloudinary.ts`: `downloadImage(url): Promise<{ buffer: Buffer; contentType: string }>`.
- Produces `azure-photos.ts`: `buildBlobName(listingId, publicId, ext): string`; `makeContainerClient(azureCfg): ContainerClient`; `uploadPhoto(container, blobName, buffer, contentType): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/migration/v1/__tests__/map-flat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapFlat, mapFurnishing, mapTenantPref } from "../map-flat";

describe("mapFurnishing", () => {
  it("maps known values", () => {
    expect(mapFurnishing("Fully Furnished")).toBe("fully_furnished");
    expect(mapFurnishing("semi furnished")).toBe("semi_furnished");
    expect(mapFurnishing("Unfurnished")).toBe("unfurnished");
  });
  it("returns null for unknown", () => {
    expect(mapFurnishing("banana")).toBeNull();
    expect(mapFurnishing(undefined)).toBeNull();
  });
});

describe("mapTenantPref", () => {
  it("maps values", () => {
    expect(mapTenantPref("Family")).toBe("family");
    expect(mapTenantPref("Bachelors")).toBe("bachelor");
    expect(mapTenantPref("Anyone")).toBe("any");
  });
});

describe("mapFlat", () => {
  const doc = {
    _id: "abc",
    nameListing: "3 BHK near Alambagh",
    description: "Nice flat",
    expected_rent: 18000,
    expected_deposit: 36000,
    bedrooms: 3,
    bathrooms: 2,
    area: 1200,
    furnishing: "Semi Furnished",
    pref_tenant: "Family",
    city: "Lucknow ",
    houseNum: "12",
    society: "Green Society",
    landmark: "Near Metro",
    pincode: 226005,
    amenities: ["Lift", "Parking"],
    location: { type: "Point", coordinates: [80.9, 26.8] as [number, number] },
    cloudinary_public_ids: ["cribliv/properties/abc/1.png"],
    verified: true
  };
  it("maps core fields and [lng,lat] geo", () => {
    const f = mapFlat(doc);
    expect(f.v1Id).toBe("abc");
    expect(f.monthlyRent).toBe(18000);
    expect(f.bhk).toBe(3);
    expect(f.citySlug).toBe("lucknow");
    expect(f.lat).toBe(26.8);
    expect(f.lng).toBe(80.9);
    expect(f.addressLine1).toContain("Green Society");
    expect(f.publicIds).toEqual(["cribliv/properties/abc/1.png"]);
    expect(f.warnings).toEqual([]);
  });
  it("warns and defaults when rent missing / city unknown / no geo", () => {
    const f = mapFlat({ _id: "x", nameListing: "X", city: "Atlantis" } as any);
    expect(f.warnings).toContain("no rent");
    expect(f.warnings).toContain("unknown city: Atlantis");
    expect(f.warnings).toContain("no geo");
    expect(f.addressLine1.length).toBeGreaterThan(0); // never empty (NOT NULL col)
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.**

- [ ] **Step 3: Write `map-flat.ts`**

```ts
import { normalizeCitySlug } from "./cities";
import type { V1Property } from "./types";

export interface FlatInput {
  v1Id: string;
  titleEn: string;
  descriptionEn: string | null;
  monthlyRent: number;
  securityDeposit: number | null;
  bhk: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  furnishing: string | null;
  preferredTenant: string | null;
  availableFrom: string | null;
  whatsappAvailable: boolean;
  amenities: string[];
  citySlug: string | null;
  addressLine1: string;
  landmark: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  publicIds: string[];
  warnings: string[];
}

export function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v).replace(/[^\d.-]/g, ""), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function mapFurnishing(
  v1?: string
): "unfurnished" | "semi_furnished" | "fully_furnished" | null {
  const k = (v1 ?? "").trim().toLowerCase();
  if (!k) return null;
  if (k.includes("unfurnish") || k === "none" || k === "no") return "unfurnished";
  if (k.includes("semi")) return "semi_furnished";
  if (k.includes("fully") || k === "furnished") return "fully_furnished";
  return null;
}

export function mapTenantPref(
  v1?: string
): "any" | "family" | "bachelor" | "female" | "male" | null {
  const k = (v1 ?? "").trim().toLowerCase();
  if (!k) return null;
  if (k.startsWith("famil")) return "family";
  if (k.startsWith("bachelor")) return "bachelor";
  if (k === "female" || k === "girls" || k === "women") return "female";
  if (k === "male" || k === "boys" || k === "men") return "male";
  if (k.startsWith("any") || k === "all") return "any";
  return "any";
}

/**
 * Title from stored `nameListing`, else composed from address parts (v1's own
 * fallback). De-dups repeated tokens ("Lucknow, Lucknow" → "Lucknow") and drops
 * empty slots ("Near,"). Used for PGs (all 19 have empty nameListing) and any
 * blank flat. `prefix` e.g. "PG in".
 */
export function composeTitleFromAddress(
  doc: { nameListing?: string; society?: string; landmark?: string; city?: string },
  prefix = ""
): string {
  const stored = (doc.nameListing ?? "").toString().trim();
  if (stored) return stored.slice(0, 300);
  const raw = [doc.society, doc.landmark, doc.city]
    .map((s) => (s ?? "").toString())
    .join(", ")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const clean: string[] = [];
  for (const p of raw) {
    const k = p.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      clean.push(p);
    }
  }
  const body = clean.join(", ") || "Listing";
  return `${prefix ? prefix + " " : ""}${body}`.slice(0, 300);
}

function pincode6(v: unknown): string | null {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(0, 6) : null;
}

function isoDate(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(v as any);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function mapFlat(doc: V1Property): FlatInput {
  const warnings: string[] = [];
  const rent = toInt(doc.expected_rent);
  if (!rent || rent <= 0) warnings.push("no rent");

  const citySlug = normalizeCitySlug(doc.city ?? "");
  if (!citySlug) warnings.push(`unknown city: ${doc.city ?? "(none)"}`);

  const coords = doc.location?.coordinates;
  const lng = Array.isArray(coords) ? (coords[0] ?? null) : null;
  const lat = Array.isArray(coords) ? (coords[1] ?? null) : null;
  if (lat == null || lng == null) warnings.push("no geo");

  const addressParts = [doc.houseNum, doc.society, doc.landmark, doc.city]
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean);
  const addressLine1 = addressParts.join(", ") || (doc.nameListing ?? "Address unavailable");

  return {
    v1Id: String(doc._id),
    titleEn: composeTitleFromAddress(doc),
    descriptionEn: doc.description ? String(doc.description) : null,
    monthlyRent: rent && rent > 0 ? rent : 0,
    securityDeposit: toInt(doc.expected_deposit),
    bhk: toInt(doc.bedrooms),
    bathrooms: toInt(doc.bathrooms),
    areaSqft: toInt(doc.area),
    furnishing: mapFurnishing(doc.furnishing),
    preferredTenant: mapTenantPref(doc.pref_tenant),
    availableFrom: isoDate(doc.avail_from),
    whatsappAvailable: false,
    amenities: Array.isArray(doc.amenities)
      ? doc.amenities.map((a) => String(a)).filter(Boolean)
      : [],
    citySlug,
    addressLine1: addressLine1.slice(0, 500),
    landmark: doc.landmark ? String(doc.landmark) : null,
    pincode: pincode6(doc.pincode),
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
    publicIds: Array.isArray(doc.cloudinary_public_ids)
      ? doc.cloudinary_public_ids.map((p) => String(p)).filter(Boolean)
      : [],
    warnings
  };
}
```

- [ ] **Step 4: Write `cloudinary.ts` (uses global fetch — Node 25)**

```ts
export async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cloudinary ${res.status} for ${url}`);
  const contentType = res.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}
```

- [ ] **Step 5: Write `azure-photos.ts` (mirrors the app's upload pattern)**

```ts
const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const { BlobServiceClient, StorageSharedKeyCredential } = requireFromApi("@azure/storage-blob");
import { extFromContentType } from "./v1-url";

export interface AzureCfg {
  account: string;
  key: string;
  container: string;
}

/** Deterministic blob path so re-runs overwrite the same blob (idempotent). */
export function buildBlobName(listingId: string, publicId: string, ext: string): string {
  const safe = publicId.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return `${listingId}/v1-${safe}.${ext}`;
}

export function makeContainerClient(cfg: AzureCfg) {
  const cred = new StorageSharedKeyCredential(cfg.account, cfg.key);
  const svc = new BlobServiceClient(`https://${cfg.account}.blob.core.windows.net`, cred);
  return svc.getContainerClient(cfg.container);
}

export async function uploadPhoto(
  container: any,
  blobName: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  const mime = ["image/jpeg", "image/png", "image/webp"].includes(contentType.split(";")[0])
    ? contentType.split(";")[0]
    : `image/${extFromContentType(contentType) === "bin" ? "jpeg" : extFromContentType(contentType)}`;
  const blob = container.getBlockBlobClient(blobName);
  await blob.upload(buffer, buffer.length, { blobHTTPHeaders: { blobContentType: mime } });
}
```

- [ ] **Step 6: Run test — expect PASS** (`map-flat.test.ts`; the two I/O modules have no unit test — they're exercised in Task A9's dry-run/apply).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/migration/v1/map-flat.ts apps/api/src/migration/v1/cloudinary.ts apps/api/src/migration/v1/azure-photos.ts apps/api/src/migration/v1/__tests__/map-flat.test.ts
git commit -m "feat(migration): flat mapper + cloudinary download + azure upload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A9: Flat writer + orchestration + reconciliation report

**Files:**

- Create: `apps/api/src/migration/v1/write-flat.ts`
- Create: `apps/api/src/migration/v1/report.ts`
- Modify: `apps/api/src/migration/v1/migrate.ts` (wire flats end-to-end)

**Interfaces:**

- Consumes: `FlatInput` (A8), `ensureCities` (A4), `resolveOwnerPhone`/`upsertOwner`/`IMPORT_FALLBACK_*` (A7), `fetchVerified` (A6), `loadOwnerPhoneByName` (A6), photo I/O (A8).
- Produces `write-flat.ts`: `writeFlat(client, container, cfg, flat, cityId, ownerId, ownerSource, report): Promise<void>` — inserts the full chain + `v1_migration_map`, idempotent by `v1_id`.
- Produces `report.ts`: `newReport()`, `report.add(kind, msg)`, `report.print()`, counters for migrated/skipped/photos/owner-source/dupes.

- [ ] **Step 1: Write `report.ts`**

```ts
export interface Report {
  migrated: number;
  skipped: number;
  photosOk: number;
  photosFail: number;
  ownerSource: Record<string, number>;
  dupes: string[];
  warnings: string[];
  add(kind: "warn" | "dupe", msg: string): void;
  print(label: string): void;
}
export function newReport(): Report {
  return {
    migrated: 0,
    skipped: 0,
    photosOk: 0,
    photosFail: 0,
    ownerSource: { mongo: 0, excel: 0, import_fallback: 0 },
    dupes: [],
    warnings: [],
    add(kind, msg) {
      (kind === "dupe" ? this.dupes : this.warnings).push(msg);
    },
    print(label) {
      console.log(`\n──── ${label} ────`);
      console.log(`migrated:      ${this.migrated}`);
      console.log(`skipped:       ${this.skipped}`);
      console.log(`photos ok/fail:${this.photosOk}/${this.photosFail}`);
      console.log(`owner source:  ${JSON.stringify(this.ownerSource)}`);
      if (this.dupes.length) {
        console.log(`\npossible duplicates (review):`);
        this.dupes.forEach((d) => console.log("  " + d));
      }
      if (this.warnings.length) {
        console.log(`\nwarnings:`);
        this.warnings.slice(0, 100).forEach((w) => console.log("  " + w));
      }
    }
  };
}
```

- [ ] **Step 2: Write `write-flat.ts`**

```ts
import type { MigrationConfig } from "./config";
import type { FlatInput } from "./map-flat";
import type { Report } from "./report";
import { buildBlobName, uploadPhoto } from "./azure-photos";
import { cloudinaryUrl, extFromContentType } from "./v1-url";
import { downloadImage } from "./cloudinary";

type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> };

export async function writeFlat(
  client: Q,
  container: any,
  cfg: MigrationConfig,
  flat: FlatInput,
  cityId: number | null,
  ownerId: string,
  ownerSource: string,
  report: Report
): Promise<void> {
  if (!cityId) {
    report.skipped++;
    report.add("warn", `SKIP ${flat.v1Id} — ${flat.warnings.join("; ")}`);
    return;
  }
  if (flat.monthlyRent <= 0) {
    report.skipped++;
    report.add("warn", `SKIP ${flat.v1Id} — no rent`);
    return;
  }

  // Idempotency: has this v1_id already been migrated?
  const existing = await client.query(
    `SELECT v2_listing_id::text AS id FROM v1_migration_map WHERE v1_id=$1`,
    [flat.v1Id]
  );
  let listingId: string;
  if (existing.rows[0]) {
    listingId = existing.rows[0].id;
    await client.query(
      `UPDATE listings SET title_en=$2, description_en=$3, monthly_rent=$4, security_deposit=$5,
         bhk=$6, bathrooms=$7, area_sqft=$8, furnishing=$9::furnishing_type,
         preferred_tenant=$10::tenant_pref, available_from=$11, contact_phone_encrypted=$12,
         status='active', verification_status='verified', updated_at=now()
       WHERE id=$1::uuid`,
      [
        listingId,
        flat.titleEn,
        flat.descriptionEn,
        flat.monthlyRent,
        flat.securityDeposit,
        flat.bhk,
        flat.bathrooms,
        flat.areaSqft,
        flat.furnishing,
        flat.preferredTenant,
        flat.availableFrom,
        await ownerPhone(client, ownerId)
      ]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO listings
         (owner_user_id, listing_type, title_en, description_en, status, verification_status,
          monthly_rent, security_deposit, bhk, bathrooms, area_sqft, furnishing, preferred_tenant,
          available_from, contact_phone_encrypted, whatsapp_available, amenities)
       VALUES ($1::uuid,'flat_house',$2,$3,'active','verified',$4,$5,$6,$7,$8,$9::furnishing_type,
          $10::tenant_pref,$11,$12,$13,$14::jsonb)
       RETURNING id::text`,
      [
        ownerId,
        flat.titleEn,
        flat.descriptionEn,
        flat.monthlyRent,
        flat.securityDeposit,
        flat.bhk,
        flat.bathrooms,
        flat.areaSqft,
        flat.furnishing,
        flat.preferredTenant,
        flat.availableFrom,
        await ownerPhone(client, ownerId),
        flat.whatsappAvailable,
        JSON.stringify(flat.amenities ?? [])
      ]
    );
    listingId = ins.rows[0].id;
  }

  // Location (upsert). Fires trigger → listings.city_slug.
  await client.query(
    `INSERT INTO listing_locations (listing_id, city_id, address_line1, landmark, pincode, lat, lng)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (listing_id) DO UPDATE SET city_id=EXCLUDED.city_id, address_line1=EXCLUDED.address_line1,
       landmark=EXCLUDED.landmark, pincode=EXCLUDED.pincode, lat=EXCLUDED.lat, lng=EXCLUDED.lng, updated_at=now()`,
    [listingId, cityId, flat.addressLine1, flat.landmark, flat.pincode, flat.lat, flat.lng]
  );

  // geo_point (best-effort; PostGIS may be absent locally).
  if (flat.lat != null && flat.lng != null) {
    await client.query("SAVEPOINT geo");
    try {
      await client.query(
        `UPDATE listing_locations
           SET geo_point = ST_SetSRID(ST_MakePoint($2::float8,$3::float8),4326)::geography
         WHERE listing_id=$1::uuid`,
        [listingId, flat.lng, flat.lat]
      );
      await client.query("RELEASE SAVEPOINT geo");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT geo");
    }
  }

  // Photos (download from Cloudinary → upload to Azure → record).
  // Skipped for local validation (--skip-photos): Azure Blob isn't transactional,
  // so we don't touch prod storage until the real prod apply.
  let cover = true;
  let idx = 0;
  for (const publicId of cfg.skipPhotos ? [] : flat.publicIds) {
    try {
      const { buffer, contentType } = await downloadImage(
        cloudinaryUrl(cfg.cloudinaryCloud, publicId)
      );
      const ext =
        extFromContentType(contentType) === "bin" ? "jpg" : extFromContentType(contentType);
      const blobName = buildBlobName(listingId, publicId, ext);
      await uploadPhoto(container, blobName, buffer, contentType);
      await client.query(
        `INSERT INTO listing_photos (listing_id, blob_path, sort_order, is_cover, moderation_status, client_upload_id)
         VALUES ($1::uuid,$2,$3,$4,'approved',$5)
         ON CONFLICT (listing_id, client_upload_id) DO UPDATE SET
           blob_path=EXCLUDED.blob_path, sort_order=EXCLUDED.sort_order, is_cover=EXCLUDED.is_cover, updated_at=now()`,
        [listingId, blobName, idx, cover, `v1:${publicId}`]
      );
      report.photosOk++;
      cover = false;
      idx++;
    } catch (e) {
      report.photosFail++;
      report.add(
        "warn",
        `photo fail ${flat.v1Id} ${publicId}: ${e instanceof Error ? e.message : e}`
      );
    }
  }
  if (report.photosOk === 0 && flat.publicIds.length > 0)
    report.add("warn", `${flat.v1Id} — all photos failed`);

  // Map row (idempotency key + 301 source).
  await client.query(
    `INSERT INTO v1_migration_map (v1_id, v1_collection, v1_name, v2_listing_id, owner_source)
     VALUES ($1,'properties',$2,$3::uuid,$4)
     ON CONFLICT (v1_id) DO UPDATE SET v2_listing_id=EXCLUDED.v2_listing_id, v1_name=EXCLUDED.v1_name, owner_source=EXCLUDED.owner_source`,
    [flat.v1Id, flat.titleEn, listingId, ownerSource]
  );
  report.migrated++;
  report.ownerSource[ownerSource] = (report.ownerSource[ownerSource] ?? 0) + 1;
}

async function ownerPhone(client: Q, ownerId: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT phone_e164 FROM users WHERE id=$1::uuid`, [ownerId]);
  return rows[0]?.phone_e164 ?? null;
}
```

- [ ] **Step 3: Wire flats into `migrate.ts`**

Replace the `// --- orchestration added in later tasks ---` block with:

```ts
const { ensureCities } = require("./cities");
const { fetchVerified } = require("./mongo-source");
const { loadOwnerPhoneByName } = require("./excel-source");
const {
  resolveOwnerPhone,
  upsertOwner,
  IMPORT_FALLBACK_PHONE,
  IMPORT_FALLBACK_NAME
} = require("./owners");
const { mapFlat } = require("./map-flat");
const { writeFlat } = require("./write-flat");
const { makeContainerClient } = require("./azure-photos");
const { newReport } = require("./report");

const cityIdBySlug = await ensureCities(client);
const excelByName = cfg.excelPath ? loadOwnerPhoneByName(cfg.excelPath) : new Map();
const container = cfg.skipPhotos ? null : makeContainerClient(cfg.azure);

if (cfg.collection === "properties" || cfg.collection === "both") {
  const report = newReport();
  const docs = await fetchVerified(cfg, "properties");
  console.log(`fetched ${docs.length} verified properties from Mongo`);

  // Duplicate detection (same name + near-identical geo).
  const seen = new Map<string, string>();
  for (const doc of docs) {
    const flat = mapFlat(doc);
    const key = `${flat.titleEn.toLowerCase()}|${flat.lat?.toFixed(3)}|${flat.lng?.toFixed(3)}`;
    if (seen.has(key)) report.add("dupe", `${flat.v1Id} ~ ${seen.get(key)} (${flat.titleEn})`);
    else seen.set(key, flat.v1Id);

    const { phone, source } = resolveOwnerPhone(doc, excelByName);
    const ownerPhone = phone ?? IMPORT_FALLBACK_PHONE;
    const ownerName = source === "import_fallback" ? IMPORT_FALLBACK_NAME : (doc.owner ?? null);
    const ownerId = await upsertOwner(client, ownerPhone, ownerName);
    const cityId = flat.citySlug ? (cityIdBySlug.get(flat.citySlug) ?? null) : null;
    await writeFlat(client, container, cfg, flat, cityId, ownerId, source, report);
  }
  report.print("PROPERTIES → flats");
}
```

- [ ] **Step 4: Local dry-run (no writes)**

Run (user supplies read-only `MONGO_URL`, real Azure creds, Excel path):

```bash
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2" \
MONGO_URL="<read-only>" MONGO_DB="test" CLOUDINARY_CLOUD_NAME="dia01qg8p" \
EXCEL_PATH="/Users/aryantripathi/Downloads/Cribliv_Property_Location.xlsx" \
AZURE_STORAGE_ACCOUNT_NAME="criblivimgstorage" AZURE_STORAGE_ACCOUNT_KEY="<key>" \
  bash -c 'cd apps/api && pnpm migrate:v1 --collection properties --skip-photos'
```

Expected: `fetched 67 verified properties`, report with `migrated: 67` (or fewer + skips), `owner source: {"mongo":67,…}`, `↩️  DRY-RUN — rolled back`. Note: photos DO upload to Azure even in dry-run (blob storage isn't transactional) — that's fine and idempotent; only the Postgres rows roll back.

- [ ] **Step 5: Local apply + verify row counts**

```bash
# same env + --apply (LOCAL keeps --skip-photos; no prod Azure writes)
… pnpm migrate:v1 --collection properties --skip-photos --apply
psql "postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2" -c \
  "SELECT count(*) FROM v1_migration_map WHERE v1_collection='properties';
   SELECT count(*) FROM listings WHERE listing_type='flat_house' AND status='active';"
```

Expected: map rows = migrated count; listings present. (`listing_photos` stays
empty locally — photos copy on the prod apply, or a deliberate local photo pass
without `--skip-photos`.)

- [ ] **Step 6: Idempotency check — re-run apply, counts unchanged**

Re-run Step 5's apply, then the counts query. Expected: identical counts (no duplicates).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/migration/v1/write-flat.ts apps/api/src/migration/v1/report.ts apps/api/src/migration/v1/migrate.ts
git commit -m "feat(migration): flat writer + orchestration + reconciliation report (Phase A milestone)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE B — 19 PGs

Depends on all Phase-A shared infra. Milestone (after Task B4): 19 verified PGs migrate into local v2 (7-table chain), idempotently.

---

## Task B1: v1 PG data discovery → mapping tables

**Files:** none (discovery + recording into the next tasks' constants).

- [x] **Step 1: Discovery COMPLETE (2026-07-09, read-only Compass).** Recorded distinct values:
  - `property.type`: Apartment, House/Villa, Independent House, Single Rooms, Villa — _no v2 column; not migrated._
  - `property.furnishing`: Fully Furnished, Semi Furnished, Unfurnished — all covered by `mapFurnishing`.
  - `property.pref_tenant`: Anyone, Family, Family/Girls, Girls — covered by `mapTenantPref` (Anyone→any, Girls→female, Family\*→family).
  - **pg amenity names**: Air Conditioner, Fridge, Microwave, Room Heater, Television, Wardrobe, Washing Machine, Water Geyser, WiFi.
  - **pg bed types** — the `type` string **IS the sharing kind**; `count` is the quantity/vacancy: single, double, triple, four/Four (`four`→`quad`).
  - **pg bathroom types**: shared, private (no western/indian split → default western).
  - **PG room shape**: `rooms[].{ roomNumber, beds:[{type,count}], bathrooms:[{type}], balconies:[{type}], kitchens:[{type}], expected_rent, expected_deposit, floor, area }`; `amenities:[{amenityName, amenityImages}]`. `area` is frequently `0` → treat as null.

- [x] **Step 2: Lookup tables filled** from the values above — `AMENITY_ALIAS` (B2), `SHARING_ALIAS` + `BATHROOM_ALIAS` (B3). "Room Heater" has no v2 amenity code → intentionally reported as **unmapped** (not silently dropped).

_(No commit — discovery recorded into B2/B3 below.)_

---

## Task B2: PG amenity + field mapper (pure, TDD)

**Files:**

- Create: `apps/api/src/migration/v1/map-pg.ts` (amenity + top-level PG fields; rooms added in B3)
- Test: `apps/api/src/migration/v1/__tests__/map-pg.test.ts`

**Interfaces:**

- Produces: `mapPgAmenities(v1Amenities): { core:string[]; room:string[]; services:string[]; extras:string[]; unmapped:string[] }`; `AMENITY_ALIAS: Record<string,[bucket,code]>`.

- [ ] **Step 1: Write the failing test**

`apps/api/src/migration/v1/__tests__/map-pg.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapPgAmenities } from "../map-pg";

describe("mapPgAmenities", () => {
  it("buckets the real v1 PG amenity names", () => {
    const r = mapPgAmenities([
      { amenityName: "Air Conditioner" },
      { amenityName: "Water Geyser" },
      { amenityName: "WiFi" },
      { amenityName: "Television" },
      { amenityName: "Wardrobe" },
      { amenityName: "Washing Machine" },
      { amenityName: "Fridge" },
      { amenityName: "Microwave" }
    ]);
    expect(r.room).toEqual(expect.arrayContaining(["ac", "tv", "wardrobe"]));
    expect(r.core).toEqual(expect.arrayContaining(["hot_water", "wifi"]));
    expect(r.services).toContain("laundry"); // Washing Machine
    expect(r.extras).toEqual(expect.arrayContaining(["fridge", "microwave"]));
  });
  it("accepts a bare string[] too", () => {
    expect(mapPgAmenities(["Parking"]).extras).toContain("parking_2w");
  });
  it("reports Room Heater as unmapped (no v2 code) without throwing", () => {
    const r = mapPgAmenities([{ amenityName: "Room Heater" }]);
    expect(r.unmapped).toContain("Room Heater");
    expect(r.core.length + r.room.length + r.services.length + r.extras.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.**

- [ ] **Step 3: Write `map-pg.ts` (amenities portion)**

```ts
type Bucket = "core" | "room" | "services" | "extras";

/** v1 free-text amenity name (lowercased) → [v2 bucket, v2 code]. Extend from B1 discovery. */
export const AMENITY_ALIAS: Record<string, [Bucket, string]> = {
  wifi: ["core", "wifi"],
  "wi-fi": ["core", "wifi"],
  internet: ["core", "wifi"],
  "hot water": ["core", "hot_water"],
  geyser: ["core", "hot_water"],
  "water geyser": ["core", "hot_water"],
  "power backup": ["core", "power_backup"],
  inverter: ["core", "power_backup"],
  generator: ["core", "power_backup"],
  cctv: ["core", "cctv"],
  "security camera": ["core", "cctv"],
  security: ["core", "security_guard"],
  guard: ["core", "security_guard"],
  "security guard": ["core", "security_guard"],
  ac: ["room", "ac"],
  "air conditioner": ["room", "ac"],
  "air conditioning": ["room", "ac"],
  tv: ["room", "tv"],
  television: ["room", "tv"],
  "study table": ["room", "study_table"],
  desk: ["room", "study_table"],
  wardrobe: ["room", "wardrobe"],
  almirah: ["room", "wardrobe"],
  cupboard: ["room", "wardrobe"],
  locker: ["room", "safety_locker"],
  "safety locker": ["room", "safety_locker"],
  mattress: ["room", "mattress"],
  bed: ["room", "mattress"],
  housekeeping: ["services", "housekeeping"],
  cleaning: ["services", "housekeeping"],
  laundry: ["services", "laundry"],
  "washing machine": ["services", "laundry"],
  biometric: ["services", "biometric_access"],
  "biometric access": ["services", "biometric_access"],
  parking: ["extras", "parking_2w"],
  "bike parking": ["extras", "parking_2w"],
  "2 wheeler parking": ["extras", "parking_2w"],
  "car parking": ["extras", "parking_4w"],
  "4 wheeler parking": ["extras", "parking_4w"],
  fridge: ["extras", "fridge"],
  refrigerator: ["extras", "fridge"],
  microwave: ["extras", "microwave"],
  oven: ["extras", "microwave"],
  gym: ["extras", "gym"],
  gymnasium: ["extras", "gym"],
  games: ["extras", "indoor_games"],
  "indoor games": ["extras", "indoor_games"]
};

function amenityNames(v1: any): string[] {
  if (!Array.isArray(v1)) return [];
  return v1
    .map((a) => (typeof a === "string" ? a : a?.amenityName))
    .filter(Boolean)
    .map(String);
}

export function mapPgAmenities(v1: any): {
  core: string[];
  room: string[];
  services: string[];
  extras: string[];
  unmapped: string[];
} {
  const out = {
    core: new Set<string>(),
    room: new Set<string>(),
    services: new Set<string>(),
    extras: new Set<string>()
  };
  const unmapped: string[] = [];
  for (const name of amenityNames(v1)) {
    const hit = AMENITY_ALIAS[name.trim().toLowerCase()];
    if (hit) out[hit[0]].add(hit[1]);
    else unmapped.push(name);
  }
  return {
    core: [...out.core],
    room: [...out.room],
    services: [...out.services],
    extras: [...out.extras],
    unmapped
  };
}
```

- [ ] **Step 4: Run test — expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migration/v1/map-pg.ts apps/api/src/migration/v1/__tests__/map-pg.test.ts
git commit -m "feat(migration): PG amenity bucket mapper + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B3: PG room-type mapper (pure, TDD)

**Files:**

- Modify: `apps/api/src/migration/v1/map-pg.ts` (add room mapping + `mapPg` assembling `PgInput`)
- Modify: `apps/api/src/migration/v1/__tests__/map-pg.test.ts` (add room tests)

**Interfaces:**

- Consumes: `mapFlat` field helpers reused where sensible (`toInt` from `map-flat`), `mapPgAmenities` (B2).
- Produces: `mapRoomTypes(rooms): RoomType[]` where `RoomType = { sharing:'single'|'double'|'triple'|'quad'|'dorm'; ac:boolean; bathroomKind:'attached_western'|'attached_indian'|'shared_western'|'shared_indian'; furnishing:'unfurnished'|'semi_furnished'|'fully_furnished'; roomSizeSqft:number|null; monthlyRentPaise:number; vacancyCount:number; availableFrom:string|null }`; `mapPg(doc): PgInput` (extends the flat-shared fields + `{ totalBeds:number; startingRentPaise:number; rooms:RoomType[]; amenities:…; unmappedAmenities:string[]; displayName:string }`).

- [ ] **Step 1: Add the failing room tests**

Append to `map-pg.test.ts`:

```ts
import { mapRoomTypes, sharingFromBedType } from "../map-pg";

describe("sharingFromBedType", () => {
  it("maps bed.type string → sharing kind (four → quad)", () => {
    expect(sharingFromBedType("single")).toBe("single");
    expect(sharingFromBedType("double")).toBe("double");
    expect(sharingFromBedType("triple")).toBe("triple");
    expect(sharingFromBedType("four")).toBe("quad");
    expect(sharingFromBedType("Four")).toBe("quad");
  });
});

describe("mapRoomTypes", () => {
  it("uses bed.type as sharing, count as vacancy, rent → paise, shared → shared_western", () => {
    // Real v1 shape: beds:[{type: <sharing>, count: <quantity>}], area often 0.
    const rt = mapRoomTypes([
      {
        beds: [{ type: "double", count: 5 }],
        bathrooms: [{ type: "shared" }],
        expected_rent: 4000,
        area: 0
      }
    ]);
    expect(rt[0].sharing).toBe("double");
    expect(rt[0].vacancyCount).toBe(5);
    expect(rt[0].monthlyRentPaise).toBe(400000);
    expect(rt[0].bathroomKind).toBe("shared_western");
    expect(rt[0].roomSizeSqft).toBeNull(); // area 0 → null
    expect(rt[0].ac).toBe(false); // v1 has no per-room AC
  });
  it("aggregates rooms that collapse to the same (sharing,ac,bathroom,furnishing) tuple", () => {
    // The pg_room_types UNIQUE key would otherwise ON CONFLICT-overwrite the first.
    const rt = mapRoomTypes([
      {
        beds: [{ type: "single", count: 2 }],
        bathrooms: [{ type: "private" }],
        expected_rent: 8000
      },
      {
        beds: [{ type: "single", count: 3 }],
        bathrooms: [{ type: "private" }],
        expected_rent: 7000
      }
    ]);
    expect(rt).toHaveLength(1);
    expect(rt[0].vacancyCount).toBe(5); // 2 + 3
    expect(rt[0].monthlyRentPaise).toBe(700000); // min positive rent
    expect(rt[0].bathroomKind).toBe("attached_western"); // private → attached_western
  });
});
```

- [ ] **Step 2: Run test — expect FAIL.**

- [ ] **Step 3: Extend `map-pg.ts`**

```ts
import { toInt, mapFurnishing, composeTitleFromAddress } from "./map-flat";
import { normalizeCitySlug } from "./cities";

export type Sharing = "single" | "double" | "triple" | "quad" | "dorm";
export type BathroomKind =
  | "attached_western"
  | "attached_indian"
  | "shared_western"
  | "shared_indian";

/** v1 bed.type IS the sharing kind (count = quantity). 'four'/'Four' → quad. */
export const SHARING_ALIAS: Record<string, Sharing> = {
  single: "single",
  double: "double",
  triple: "triple",
  four: "quad",
  quad: "quad",
  dorm: "dorm"
};
export function sharingFromBedType(type: string): Sharing {
  return SHARING_ALIAS[(type ?? "").trim().toLowerCase()] ?? "single";
}

/** v1 bathroom label → v2 kind. v1 only has shared/private; no western/indian split → default western. */
export const BATHROOM_ALIAS: Record<string, BathroomKind> = {
  private: "attached_western",
  attached: "attached_western",
  western: "attached_western",
  "attached indian": "attached_indian",
  indian: "attached_indian",
  shared: "shared_western",
  common: "shared_western",
  "shared indian": "shared_indian"
};

export interface RoomType {
  sharing: Sharing;
  ac: boolean;
  bathroomKind: BathroomKind;
  furnishing: "unfurnished" | "semi_furnished" | "fully_furnished";
  roomSizeSqft: number | null;
  monthlyRentPaise: number;
  vacancyCount: number;
  availableFrom: string | null;
}

/**
 * Map v1 rooms[] → pg_room_types rows. v1 room.beds is [{type: sharing-kind,
 * count: quantity}], one entry per sharing option. Rows are AGGREGATED by the
 * DB's UNIQUE key (sharing, ac, bathroom_kind, furnishing) — summing vacancy and
 * taking the min positive rent — so the writer's ON CONFLICT never silently
 * overwrites two colliding rooms. v1 has no per-room AC → ac=false (PG-level
 * "Air Conditioner" amenity lands on pg_details.amenities.room instead).
 */
export function mapRoomTypes(rooms: any[]): RoomType[] {
  if (!Array.isArray(rooms)) return [];
  const byKey = new Map<string, RoomType>();
  for (const r of rooms) {
    const beds = Array.isArray(r.beds) && r.beds.length ? r.beds : [{ type: "single", count: 1 }];
    const bathLabel = (
      Array.isArray(r.bathrooms) && r.bathrooms[0]?.type ? String(r.bathrooms[0].type) : ""
    ).toLowerCase();
    const furnishing = mapFurnishing(r.furnishing) ?? "semi_furnished";
    const bathroomKind = BATHROOM_ALIAS[bathLabel] ?? "attached_western";
    const rent = toInt(r.expected_rent) ?? 0;
    const paise = rent > 0 ? rent * 100 : 0;
    const area = toInt(r.area);
    for (const b of beds) {
      const sharing = sharingFromBedType(String(b?.type ?? "single"));
      const ac = false;
      const vacancy = Math.max(1, toInt(b?.count) ?? 1);
      const key = `${sharing}|${ac}|${bathroomKind}|${furnishing}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.vacancyCount += vacancy;
        if (paise > 0 && (existing.monthlyRentPaise === 0 || paise < existing.monthlyRentPaise))
          existing.monthlyRentPaise = paise;
        if (area && area > 0 && !existing.roomSizeSqft) existing.roomSizeSqft = area;
      } else {
        byKey.set(key, {
          sharing,
          ac,
          bathroomKind,
          furnishing,
          roomSizeSqft: area && area > 0 ? area : null,
          monthlyRentPaise: paise,
          vacancyCount: vacancy,
          availableFrom: null
        });
      }
    }
  }
  return [...byKey.values()];
}

export interface PgInput {
  v1Id: string;
  titleEn: string;
  descriptionEn: string | null;
  displayName: string;
  citySlug: string | null;
  addressLine1: string;
  landmark: string | null;
  pincode: string | null;
  lat: number | null;
  lng: number | null;
  totalBeds: number;
  startingRentPaise: number;
  monthlyRentRupees: number;
  rooms: RoomType[];
  amenities: { core: string[]; room: string[]; services: string[]; extras: string[] };
  unmappedAmenities: string[];
  publicIds: string[];
  warnings: string[];
}

export function mapPg(doc: any): PgInput {
  const warnings: string[] = [];
  const rooms = mapRoomTypes(doc.rooms ?? []);
  if (rooms.length === 0) warnings.push("no rooms");
  const rents = rooms.map((r) => r.monthlyRentPaise).filter((p) => p > 0);
  const startingRentPaise = rents.length ? Math.min(...rents) : 0;
  if (startingRentPaise <= 0) warnings.push("no room rent");
  const totalBeds =
    rooms.reduce((s, r) => s + r.vacancyCount, 0) || (toInt(doc.total_beds) ?? rooms.length);

  const citySlug = normalizeCitySlug(doc.city ?? "");
  if (!citySlug) warnings.push(`unknown city: ${doc.city ?? "(none)"}`);
  const coords = doc.location?.coordinates;
  const lng = Array.isArray(coords) ? (coords[0] ?? null) : null;
  const lat = Array.isArray(coords) ? (coords[1] ?? null) : null;
  if (lat == null || lng == null) warnings.push("no geo");

  const am = mapPgAmenities(doc.amenities);
  if (am.unmapped.length) warnings.push(`unmapped amenities: ${am.unmapped.join(", ")}`);

  const addr = [doc.houseNum, doc.society, doc.landmark, doc.city]
    .map((s) => (s ?? "").toString().trim())
    .filter(Boolean)
    .join(", ");
  return {
    v1Id: String(doc._id),
    titleEn: composeTitleFromAddress(doc, "PG in"),
    descriptionEn: doc.description ? String(doc.description) : null,
    displayName: composeTitleFromAddress(doc, "PG in").slice(0, 200),
    citySlug,
    addressLine1: (addr || String(doc.nameListing ?? "Address unavailable")).slice(0, 500),
    landmark: doc.landmark ? String(doc.landmark) : null,
    pincode:
      String(doc.pincode ?? "")
        .replace(/\D/g, "")
        .slice(0, 6) || null,
    lat: typeof lat === "number" ? lat : null,
    lng: typeof lng === "number" ? lng : null,
    totalBeds,
    startingRentPaise,
    monthlyRentRupees: startingRentPaise > 0 ? Math.round(startingRentPaise / 100) : 0,
    rooms,
    amenities: { core: am.core, room: am.room, services: am.services, extras: am.extras },
    unmappedAmenities: am.unmapped,
    publicIds: Array.isArray(doc.cloudinary_public_ids)
      ? doc.cloudinary_public_ids.map(String).filter(Boolean)
      : [],
    warnings
  };
}
```

- [ ] **Step 4: Run test — expect PASS** (all `map-pg.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migration/v1/map-pg.ts apps/api/src/migration/v1/__tests__/map-pg.test.ts
git commit -m "feat(migration): PG room-type mapper + mapPg assembler

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B4: PG writer (7-table chain) + orchestration

**Files:**

- Create: `apps/api/src/migration/v1/write-pg.ts`
- Modify: `apps/api/src/migration/v1/migrate.ts` (wire PGs)

**Interfaces:**

- Consumes: `PgInput` (B3), owner + city + photo infra (Phase A).
- Produces: `writePg(client, container, cfg, pg, cityId, operatorId, ownerSource, report): Promise<void>` — inserts `pg_properties → pg_listings → pg_details → pg_room_types → listings(projection) → listing_locations → geo → photos → v1_migration_map`, idempotent by `v1_id`.

- [ ] **Step 1: Write `write-pg.ts`**

```ts
import type { MigrationConfig } from "./config";
import type { PgInput } from "./map-pg";
import type { Report } from "./report";
import { buildBlobName, uploadPhoto } from "./azure-photos";
import { cloudinaryUrl, extFromContentType } from "./v1-url";
import { downloadImage } from "./cloudinary";

const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const { randomUUID } = requireFromApi("crypto");

type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> };

export async function writePg(
  client: Q,
  container: any,
  cfg: MigrationConfig,
  pg: PgInput,
  cityId: number | null,
  operatorId: string,
  ownerSource: string,
  report: Report
): Promise<void> {
  if (!cityId) {
    report.skipped++;
    report.add("warn", `SKIP PG ${pg.v1Id} — ${pg.warnings.join("; ")}`);
    return;
  }
  if (pg.rooms.length === 0 || pg.startingRentPaise <= 0) {
    report.skipped++;
    report.add("warn", `SKIP PG ${pg.v1Id} — no priced rooms`);
    return;
  }

  // Reuse the same id across pg_listings + listings projection. Idempotent via map.
  const existing = await client.query(
    `SELECT v2_listing_id::text AS id FROM v1_migration_map WHERE v1_id=$1`,
    [pg.v1Id]
  );
  const listingId: string = existing.rows[0]?.id ?? randomUUID();
  const ownerPhone =
    (await client.query(`SELECT phone_e164 FROM users WHERE id=$1::uuid`, [operatorId])).rows[0]
      ?.phone_e164 ?? null;

  // 1. pg_properties (operator-owned building). Upsert by a deterministic id derived from listingId.
  const propId: string = existing.rows[0]
    ? ((
        await client.query(`SELECT pg_property_id::text AS id FROM listings WHERE id=$1::uuid`, [
          listingId
        ])
      ).rows[0]?.id ?? randomUUID())
    : randomUUID();
  await client.query(
    `INSERT INTO pg_properties (id, operator_id, display_name, city_id, status, is_primary)
     VALUES ($1::uuid,$2::uuid,$3,$4,'active',true)
     ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, city_id=EXCLUDED.city_id`,
    [propId, operatorId, pg.displayName, cityId]
  );

  // 2. pg_listings (head).
  await client.query(
    `INSERT INTO pg_listings (id, operator_user_id, pg_property_id, title, starting_rent_paise, status, verification_status)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'active'::listing_status,'verified')
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, starting_rent_paise=EXCLUDED.starting_rent_paise, status='active'`,
    [listingId, operatorId, propId, pg.titleEn, pg.startingRentPaise]
  );

  // 3. pg_details (FK → pg_listings.id).
  await client.query(
    `INSERT INTO pg_details (listing_id, total_beds, amenities, house_rules, payment_modes, onboarding_path)
     VALUES ($1::uuid,$2,$3::jsonb,'{}'::jsonb,'[]'::jsonb,'self_serve')
     ON CONFLICT (listing_id) DO UPDATE SET total_beds=EXCLUDED.total_beds, amenities=EXCLUDED.amenities`,
    [listingId, pg.totalBeds, JSON.stringify(pg.amenities)]
  );

  // 4. pg_room_types (per room). Upsert key (listing_id, sharing, ac, bathroom_kind, furnishing).
  for (const rt of pg.rooms) {
    await client.query(
      `INSERT INTO pg_room_types (listing_id, sharing, ac, bathroom_kind, furnishing, room_size_sqft, monthly_rent_paise, vacancy_count, available_from)
       VALUES ($1::uuid,$2::pg_sharing_kind,$3,$4::pg_bathroom_kind,$5::furnishing_type,$6,$7,$8,$9)
       ON CONFLICT (listing_id, sharing, ac, bathroom_kind, furnishing) DO UPDATE SET
         monthly_rent_paise=EXCLUDED.monthly_rent_paise, vacancy_count=EXCLUDED.vacancy_count`,
      [
        listingId,
        rt.sharing,
        rt.ac,
        rt.bathroomKind,
        rt.furnishing,
        rt.roomSizeSqft,
        rt.monthlyRentPaise,
        rt.vacancyCount,
        rt.availableFrom
      ]
    );
  }

  // 5. listings projection (SAME id, listing_type='pg', amenities '[]').
  await client.query(
    `INSERT INTO listings (id, owner_user_id, listing_type, title_en, description_en, status, verification_status,
        monthly_rent, amenities, pg_property_id, contact_phone_encrypted, whatsapp_available)
     VALUES ($1::uuid,$2::uuid,'pg',$3,$4,'active','verified',$5,'[]'::jsonb,$6::uuid,$7,false)
     ON CONFLICT (id) DO UPDATE SET title_en=EXCLUDED.title_en, description_en=EXCLUDED.description_en,
       monthly_rent=EXCLUDED.monthly_rent, status='active', verification_status='verified', updated_at=now()`,
    [listingId, operatorId, pg.titleEn, pg.descriptionEn, pg.monthlyRentRupees, propId, ownerPhone]
  );

  // 6. listing_locations + 7. geo (same as flats).
  await client.query(
    `INSERT INTO listing_locations (listing_id, city_id, address_line1, landmark, pincode, lat, lng)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (listing_id) DO UPDATE SET city_id=EXCLUDED.city_id, address_line1=EXCLUDED.address_line1,
       landmark=EXCLUDED.landmark, pincode=EXCLUDED.pincode, lat=EXCLUDED.lat, lng=EXCLUDED.lng, updated_at=now()`,
    [listingId, cityId, pg.addressLine1, pg.landmark, pg.pincode, pg.lat, pg.lng]
  );
  if (pg.lat != null && pg.lng != null) {
    await client.query("SAVEPOINT geo");
    try {
      await client.query(
        `UPDATE listing_locations SET geo_point = ST_SetSRID(ST_MakePoint($2::float8,$3::float8),4326)::geography WHERE listing_id=$1::uuid`,
        [listingId, pg.lng, pg.lat]
      );
      await client.query("RELEASE SAVEPOINT geo");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT geo");
    }
  }

  // 8. photos (skipped for local via --skip-photos; Azure Blob isn't transactional).
  let cover = true,
    idx = 0;
  for (const publicId of cfg.skipPhotos ? [] : pg.publicIds) {
    try {
      const { buffer, contentType } = await downloadImage(
        cloudinaryUrl(cfg.cloudinaryCloud, publicId)
      );
      const ext =
        extFromContentType(contentType) === "bin" ? "jpg" : extFromContentType(contentType);
      const blobName = buildBlobName(listingId, publicId, ext);
      await uploadPhoto(container, blobName, buffer, contentType);
      await client.query(
        `INSERT INTO listing_photos (listing_id, blob_path, sort_order, is_cover, moderation_status, client_upload_id)
         VALUES ($1::uuid,$2,$3,$4,'approved',$5)
         ON CONFLICT (listing_id, client_upload_id) DO UPDATE SET blob_path=EXCLUDED.blob_path, updated_at=now()`,
        [listingId, blobName, idx, cover, `v1:${publicId}`]
      );
      report.photosOk++;
      cover = false;
      idx++;
    } catch (e) {
      report.photosFail++;
      report.add(
        "warn",
        `photo fail PG ${pg.v1Id} ${publicId}: ${e instanceof Error ? e.message : e}`
      );
    }
  }

  // 9. map row.
  await client.query(
    `INSERT INTO v1_migration_map (v1_id, v1_collection, v1_name, v2_listing_id, owner_source)
     VALUES ($1,'pgs',$2,$3::uuid,$4)
     ON CONFLICT (v1_id) DO UPDATE SET v2_listing_id=EXCLUDED.v2_listing_id, v1_name=EXCLUDED.v1_name, owner_source=EXCLUDED.owner_source`,
    [pg.v1Id, pg.titleEn, listingId, ownerSource]
  );
  report.migrated++;
  report.ownerSource[ownerSource] = (report.ownerSource[ownerSource] ?? 0) + 1;
}
```

- [ ] **Step 2: Wire PGs into `migrate.ts`**

After the properties block, add:

```ts
if (cfg.collection === "pgs" || cfg.collection === "both") {
  const { mapPg } = require("./map-pg");
  const { writePg } = require("./write-pg");
  const report = newReport();
  const docs = await fetchVerified(cfg, "pgs");
  console.log(`fetched ${docs.length} verified pgs from Mongo`);
  for (const doc of docs) {
    const pg = mapPg(doc);
    const { phone, source } = resolveOwnerPhone(doc, excelByName);
    const operatorPhone = phone ?? IMPORT_FALLBACK_PHONE;
    const operatorName = source === "import_fallback" ? IMPORT_FALLBACK_NAME : (doc.owner ?? null);
    // PG operators get role pg_operator (not owner) — matches v2 PG model.
    const opId = (
      await client.query(
        `INSERT INTO users (phone_e164, role, full_name, preferred_language)
           VALUES ($1,'pg_operator'::user_role,$2,'en')
           ON CONFLICT (phone_e164) DO UPDATE SET role='pg_operator', is_blocked=false,
             full_name=COALESCE(users.full_name, EXCLUDED.full_name)
           RETURNING id::text`,
        [operatorPhone, operatorName]
      )
    ).rows[0].id;
    const cityId = pg.citySlug ? (cityIdBySlug.get(pg.citySlug) ?? null) : null;
    await writePg(client, container, cfg, pg, cityId, opId, source, report);
  }
  report.print("PGS → pg listings");
}
```

Note: move the `mapPg`/`writePg` requires to the top of the `try` block alongside the others if preferred; inline require works with ts-node transpile-only.

- [ ] **Step 3: Local dry-run then apply (PGs)**

```bash
… pnpm migrate:v1 --collection pgs --skip-photos            # dry-run: fetched 19 verified pgs, report
… pnpm migrate:v1 --collection pgs --skip-photos --apply    # commit (local)
psql "postgresql://postgres:postgres@127.0.0.1:5432/cribliv_v2" -c \
  "SELECT count(*) FROM v1_migration_map WHERE v1_collection='pgs';
   SELECT count(*) FROM listings WHERE listing_type='pg' AND status='active';
   SELECT count(*) FROM pg_room_types;"
```

Expected: 19 map rows, 19 pg listings, room-type rows ≥ 19.

- [ ] **Step 4: Idempotency — re-run apply, counts unchanged.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/migration/v1/write-pg.ts apps/api/src/migration/v1/migrate.ts
git commit -m "feat(migration): PG writer (7-table chain) + orchestration (Phase B milestone)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# PHASE C — Verify + prod

## Task C1: Full-suite green + local render spot-check

**Files:** none (verification).

- [ ] **Step 1: Run the migration test suite**

Run: `pnpm --filter @cribliv/api exec vitest run src/migration/v1`
Expected: all Phase A/B unit suites PASS.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @cribliv/api typecheck`
Expected: no errors from `src/migration/v1/**`.

- [ ] **Step 3: Spot-check rendered listings on local web**

Start web + api locally (`pnpm dev`), open 3–5 migrated listings (flats + PGs) by their v2 UUID, confirm photos + geo + city page + owner contact render. Fix any mapper gap surfaced, re-run the relevant apply.

- [ ] **Step 4: Commit any fixes; no-op if none.**

---

## Task C2: Production apply (USER runs)

**Files:** none (operational).

- [ ] **Step 1: Apply migration 0052 to prod** — the USER runs `run-migrations.js` with the prod `DATABASE_URL` (root `.env`). Verify `\d v1_migration_map`.

- [ ] **Step 2: Prod dry-run** — the USER runs `pnpm migrate:v1 --collection both` with prod `DATABASE_URL` + read-only `MONGO_URL` + real Azure creds + Excel path. **Omit `--skip-photos`** so photos copy to prod Azure. Review the reconciliation report (expect `owner source: {"mongo":86}`, `migrated: 86`, `photos ok` ≈ all, dupes reviewed).

- [ ] **Step 3: Prod apply** — the USER re-runs with `--apply` (no `--skip-photos`). Verify counts (86 map rows), photos copied, and spot-check 3 prod listings render.

- [ ] **Step 4: Record outcome** — note final counts + any skipped rows in the spec's §11 or a short run log. The 301-map generator (GSC-driven) is a separate cutover-time task (out of scope for this plan; tracked in the spec §7).

---

## Notes on deferred / out-of-scope items (YAGNI)

- **301 redirect map generator** — separate cutover-time script; reads `v1_migration_map` + the GSC "Pages" export, extracts the trailing ObjectId, emits `old_url → new_url`. Not built here.
- **v1 `type`/`balconies`** (flat subtype, balcony count) — no v2 column; intentionally not migrated.
- **PG rich terms** (deposit/notice/lock-in/electricity/meals) — v1 lacks structured equivalents; left to `pg_details` defaults. Add later only if a real need appears.
- **`pgs.services[]`** — not migrated as a separate field; its entries overlap the amenity set and v2 has no distinct services column. If B1 discovery shows service names worth keeping, fold them into `AMENITY_ALIAS` (Task B2) so `mapPgAmenities` also reads `doc.services` — a one-line change, deferred until the data justifies it.
- **`pg_rooms`/`pg_beds`** — schema-only, no UI in v2; not populated.
- **Wallets for owners** — not required (no FK forces them); skipped.
