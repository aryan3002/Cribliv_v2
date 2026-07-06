/**
 * load-city.ts — safely load ONE city's reference geo data into a database.
 *
 * Upsert-only, single-city scoped, transactional, DRY-RUN BY DEFAULT. Built for
 * loading a reviewed city (e.g. Noida) into PRODUCTION without the broad blast
 * radius of the full `db:seed`:
 *   - Touches ONLY the target city's rows (localities / micro-localities /
 *     landmarks for that city_id). Never other cities.
 *   - NEVER deletes anything (unlike the metro block in seed.ts).
 *   - NEVER writes users, wallets, metro_stations, or seo_city_config.
 *   - Wrapped in a transaction: dry-run ROLLBACKs, --apply COMMITs.
 *
 * Usage:
 *   DATABASE_URL="postgres://…" pnpm load:city --city noida            # dry-run
 *   DATABASE_URL="postgres://…" pnpm load:city --city noida --apply    # commit
 *
 * DATABASE_URL must be provided explicitly in the environment — this script does
 * NOT read any .env file, so it can never accidentally hit the wrong database.
 */
const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const { createRequire } = require("module") as typeof import("module");

const seedDir = __dirname;
const repoRoot = path.resolve(seedDir, "../..");
const requireFromApi = createRequire(path.resolve(repoRoot, "apps/api/package.json"));
const { Client } = requireFromApi("pg") as {
  Client: new (input: { connectionString: string; ssl?: unknown }) => any;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const citySlug = arg("city");
  const apply = hasFlag("apply");
  const databaseUrl = process.env.DATABASE_URL;

  if (!citySlug) throw new Error("Missing --city <slug>");
  if (!databaseUrl) throw new Error("DATABASE_URL is required (pass it explicitly in the env)");

  const maskedHost = databaseUrl.replace(/:\/\/[^@]*@/, "://***@").replace(/\?.*$/, "");
  console.log(`\n=== load-city: ${citySlug} → ${maskedHost} ===`);
  console.log(
    apply ? "MODE: APPLY (will COMMIT)\n" : "MODE: DRY-RUN (will ROLLBACK — no changes)\n"
  );

  // Read reviewed seed data
  const allLocalities = JSON.parse(
    fs.readFileSync(path.join(seedDir, "localities.json"), "utf8")
  ) as Array<{
    city_slug: string;
    slug: string;
    name_en: string;
    name_hi: string;
    pincode?: string;
    lat?: number;
    lng?: number;
  }>;
  const localities = allLocalities.filter((l) => l.city_slug === citySlug);

  const microPath = path.join(seedDir, citySlug, "micro-localities.json");
  const micros = fs.existsSync(microPath)
    ? (JSON.parse(fs.readFileSync(microPath, "utf8")) as Array<{
        slug: string;
        name_en: string;
        name_hi: string;
        parent_slug: string;
        lat?: number;
        lng?: number;
        seo_aliases?: string[];
      }>)
    : [];

  const landmarksPath = path.join(seedDir, citySlug, "landmarks.json");
  const landmarks = fs.existsSync(landmarksPath)
    ? (JSON.parse(fs.readFileSync(landmarksPath, "utf8")) as Array<{
        slug: string;
        name_en: string;
        name_hi: string;
        type: string;
        aka?: string[];
        lat: number;
        lng: number;
        primary_locality_slug?: string;
      }>)
    : [];

  console.log(
    `Loaded from disk: ${localities.length} localities, ${micros.length} micro-localities, ${landmarks.length} landmarks.`
  );
  if (localities.length === 0 && micros.length === 0 && landmarks.length === 0) {
    throw new Error(`No seed data found on disk for "${citySlug}" — nothing to do.`);
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const q = async (s: string, p: unknown[] = []) => (await client.query(s, p)).rows;

  try {
    // Guard: city must already exist. This script never creates cities.
    const cityRow = await q("SELECT id FROM cities WHERE slug = $1", [citySlug]);
    if (cityRow.length === 0)
      throw new Error(`City "${citySlug}" not found in cities table — aborting.`);
    const cityId = cityRow[0].id;

    const before = {
      localities: (
        await q("SELECT count(*)::int n FROM localities WHERE city_id = $1", [cityId])
      )[0].n,
      landmarks: (await q("SELECT count(*)::int n FROM landmarks WHERE city_id = $1", [cityId]))[0]
        .n,
      users: (await q("SELECT count(*)::int n FROM users"))[0].n
    };
    console.log(
      `\nBEFORE — ${citySlug}: ${before.localities} localities, ${before.landmarks} landmarks | users (all): ${before.users}`
    );

    await client.query("BEGIN");

    // 1. Localities (top-level) — upsert only
    for (const l of localities) {
      await client.query(
        `INSERT INTO localities(city_id, slug, name_en, name_hi, pincode, lat, lng)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(city_id, slug) DO UPDATE SET
           name_en=EXCLUDED.name_en, name_hi=EXCLUDED.name_hi,
           pincode=EXCLUDED.pincode, lat=EXCLUDED.lat, lng=EXCLUDED.lng`,
        [cityId, l.slug, l.name_en, l.name_hi, l.pincode ?? null, l.lat ?? null, l.lng ?? null]
      );
    }

    // 2. Micro-localities (child localities) — upsert only
    const parentRows = await q("SELECT id, slug FROM localities WHERE city_id = $1", [cityId]);
    const parentBySlug = new Map(
      parentRows.map((r: { id: number; slug: string }) => [r.slug, r.id])
    );
    for (const m of micros) {
      await client.query(
        `INSERT INTO localities(city_id, slug, name_en, name_hi, lat, lng, parent_locality_id, seo_aliases)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(city_id, slug) DO UPDATE SET
           name_en=EXCLUDED.name_en, name_hi=EXCLUDED.name_hi,
           lat=EXCLUDED.lat, lng=EXCLUDED.lng,
           parent_locality_id=EXCLUDED.parent_locality_id, seo_aliases=EXCLUDED.seo_aliases`,
        [
          cityId,
          m.slug,
          m.name_en,
          m.name_hi,
          m.lat ?? null,
          m.lng ?? null,
          parentBySlug.get(m.parent_slug) ?? null,
          m.seo_aliases ?? []
        ]
      );
    }

    // 3. Landmarks — upsert only
    const locRows = await q("SELECT id, slug FROM localities WHERE city_id = $1", [cityId]);
    const locBySlug = new Map(locRows.map((r: { id: number; slug: string }) => [r.slug, r.id]));
    for (const l of landmarks) {
      await client.query(
        `INSERT INTO landmarks(city_id, slug, name_en, name_hi, type, aka, lat, lng, primary_locality_id)
         VALUES ($1,$2,$3,$4,$5::landmark_type,$6,$7,$8,$9)
         ON CONFLICT(city_id, slug) DO UPDATE SET
           name_en=EXCLUDED.name_en, name_hi=EXCLUDED.name_hi, type=EXCLUDED.type,
           aka=EXCLUDED.aka, lat=EXCLUDED.lat, lng=EXCLUDED.lng,
           primary_locality_id=EXCLUDED.primary_locality_id, updated_at=now()`,
        [
          cityId,
          l.slug,
          l.name_en,
          l.name_hi,
          l.type,
          l.aka ?? [],
          l.lat,
          l.lng,
          l.primary_locality_slug ? (locBySlug.get(l.primary_locality_slug) ?? null) : null
        ]
      );
    }

    // 4. geo_point backfills (best-effort; PostGIS may be absent). Wrapped in a
    // SAVEPOINT: inside a transaction, a failed statement aborts the WHOLE txn,
    // so a plain try/catch can't recover — ROLLBACK TO SAVEPOINT keeps the main
    // transaction alive if PostGIS/geo is unavailable.
    await client.query("SAVEPOINT geo");
    try {
      await client.query(
        `UPDATE localities SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
         WHERE city_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL`,
        [cityId]
      );
      await client.query(
        `UPDATE landmarks SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
         WHERE city_id = $1 AND geo_point IS NULL`,
        [cityId]
      );
      await client.query("RELEASE SAVEPOINT geo");
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT geo");
      console.warn("geo_point backfill skipped:", e instanceof Error ? e.message : e);
    }

    const after = {
      localities: (
        await q("SELECT count(*)::int n FROM localities WHERE city_id = $1", [cityId])
      )[0].n,
      landmarks: (await q("SELECT count(*)::int n FROM landmarks WHERE city_id = $1", [cityId]))[0]
        .n,
      users: (await q("SELECT count(*)::int n FROM users"))[0].n
    };
    console.log(
      `AFTER  — ${citySlug}: ${after.localities} localities, ${after.landmarks} landmarks | users (all): ${after.users}`
    );
    console.log(
      `DELTA  — localities +${after.localities - before.localities}, landmarks +${after.landmarks - before.landmarks}, users ${after.users - before.users} (MUST be 0)`
    );

    if (after.users !== before.users)
      throw new Error("SAFETY ABORT: user count changed — rolling back.");

    if (apply) {
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
