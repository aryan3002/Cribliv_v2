const fs = require("fs") as typeof import("fs");
const path = require("path") as typeof import("path");
const { createRequire } = require("module") as typeof import("module");

const seedDir = __dirname;
const repoRoot = path.resolve(seedDir, "../..");
const requireFromApi = createRequire(path.resolve(repoRoot, "apps/api/package.json"));

const dotenv = requireFromApi("dotenv");
dotenv.config({ path: path.resolve(repoRoot, ".env") });

const { Client } = requireFromApi("pg") as {
  Client: new (input: { connectionString: string }) => any;
};

function normalizeLocalhostConnectionString(connectionString: string) {
  try {
    const parsed = new URL(connectionString);
    if (parsed.hostname === "localhost") {
      parsed.hostname = "127.0.0.1";
    }
    return parsed.toString();
  } catch {
    return connectionString;
  }
}

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const resolvedDatabaseUrl = normalizeLocalhostConnectionString(databaseUrl);
  const client = new Client({ connectionString: resolvedDatabaseUrl });
  await client.connect();

  const cities = JSON.parse(fs.readFileSync(path.join(seedDir, "cities.json"), "utf8")) as Array<{
    slug: string;
    name_en: string;
    name_hi: string;
    state_en: string;
    state_hi: string;
  }>;

  const localities = JSON.parse(
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

  for (const city of cities) {
    await client.query(
      `
      INSERT INTO cities(slug, name_en, name_hi, state_en, state_hi, is_active)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT(slug) DO UPDATE SET
        name_en = EXCLUDED.name_en,
        name_hi = EXCLUDED.name_hi,
        state_en = EXCLUDED.state_en,
        state_hi = EXCLUDED.state_hi,
        is_active = true
      `,
      [city.slug, city.name_en, city.name_hi, city.state_en, city.state_hi]
    );
  }

  const cityRows = await client.query("SELECT id, slug FROM cities");
  const cityBySlug = new Map(
    cityRows.rows.map((row: { id: number; slug: string }) => [row.slug, row.id])
  );

  for (const locality of localities) {
    const cityId = cityBySlug.get(locality.city_slug);
    if (!cityId) {
      continue;
    }

    await client.query(
      `
      INSERT INTO localities(city_id, slug, name_en, name_hi, pincode, lat, lng)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(city_id, slug) DO UPDATE SET
        name_en = EXCLUDED.name_en,
        name_hi = EXCLUDED.name_hi,
        pincode = EXCLUDED.pincode,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng
      `,
      [
        cityId,
        locality.slug,
        locality.name_en,
        locality.name_hi,
        locality.pincode ?? null,
        locality.lat ?? null,
        locality.lng ?? null
      ]
    );
  }

  console.log(`Seeded ${cities.length} cities and ${localities.length} localities.`);

  // ── Dev seed users ─────────────────────────────────────────────────────────
  // These are idempotent: safe to re-run. They only exist in dev environments.
  const seedUsers = [
    { phone: "+919999999901", role: "owner" },
    { phone: "+919999999902", role: "tenant" },
    { phone: "+919999999903", role: "admin" },
    { phone: "+919999999904", role: "pg_operator" }
  ];

  for (const u of seedUsers) {
    await client.query(
      `
      INSERT INTO users (phone_e164, role, preferred_language)
      VALUES ($1, $2::user_role, 'en')
      ON CONFLICT (phone_e164) DO UPDATE SET
        role = EXCLUDED.role,
        is_blocked = false
      `,
      [u.phone, u.role]
    );
  }

  // Give tenant seed user 2 credits; ensure all have wallets
  await client.query(`
    INSERT INTO wallets (user_id, balance_credits, free_credits_granted)
    SELECT id,
      CASE WHEN role = 'tenant' THEN 2 ELSE 0 END,
      CASE WHEN role = 'tenant' THEN 2 ELSE 0 END
    FROM users
    WHERE phone_e164 IN ('+919999999901','+919999999902','+919999999903','+919999999904')
    ON CONFLICT (user_id) DO NOTHING
  `);

  console.log("Seeded dev users: owner/tenant/admin/pg_operator (phones ending 901–904).");

  // ── Metro station seed data ────────────────────────────────────────────────
  // Loads every `metro-stations*.json` file in the seeds dir so we can add a
  // new city by dropping in a new file (e.g. metro-stations-lucknow.json) with
  // no loader change.
  try {
    type MetroSeedFile = {
      city: string;
      lines: Array<{
        line_name: string;
        line_color: string;
        stations: Array<{ name: string; lat: number; lng: number; seq: number }>;
      }>;
    };

    const metroFiles = fs
      .readdirSync(seedDir)
      .filter((f) => /^metro-stations.*\.json$/i.test(f))
      .sort();

    for (const filename of metroFiles) {
      const metroData = JSON.parse(
        fs.readFileSync(path.join(seedDir, filename), "utf8")
      ) as MetroSeedFile;

      // Clear existing metro data for this city and re-insert (idempotent)
      await client.query(`DELETE FROM metro_stations WHERE city = $1`, [metroData.city]);

      let stationCount = 0;
      for (const line of metroData.lines) {
        for (const station of line.stations) {
          await client.query(
            `INSERT INTO metro_stations (city, line_name, line_color, station_name, lat, lng, sequence)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              metroData.city,
              line.line_name,
              line.line_color,
              station.name,
              station.lat,
              station.lng,
              station.seq
            ]
          );
          stationCount++;
        }
      }

      console.log(
        `Seeded ${stationCount} metro stations across ${metroData.lines.length} lines for ${metroData.city}.`
      );
    }
  } catch (err) {
    // Metro table may not exist yet — non-fatal
    console.warn("Metro station seed skipped:", err instanceof Error ? err.message : err);
  }

  // ── Lucknow micro-localities (city-scoped sub-areas inside parent localities) ─
  try {
    type MicroLocality = {
      slug: string;
      name_en: string;
      name_hi: string;
      parent_slug: string;
      lat?: number;
      lng?: number;
      seo_aliases?: string[];
    };

    const microPath = path.join(seedDir, "lucknow", "micro-localities.json");
    if (fs.existsSync(microPath)) {
      const micros = JSON.parse(fs.readFileSync(microPath, "utf8")) as MicroLocality[];
      const lucknowId = cityBySlug.get("lucknow");
      if (lucknowId) {
        // Resolve parent locality ids in one query
        const parentRows = await client.query(
          `SELECT id, slug FROM localities WHERE city_id = $1`,
          [lucknowId]
        );
        const parentBySlug = new Map(
          parentRows.rows.map((r: { id: number; slug: string }) => [r.slug, r.id])
        );

        for (const m of micros) {
          const parentId = parentBySlug.get(m.parent_slug) ?? null;
          await client.query(
            `INSERT INTO localities (city_id, slug, name_en, name_hi, lat, lng, parent_locality_id, seo_aliases)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (city_id, slug) DO UPDATE SET
               name_en = EXCLUDED.name_en,
               name_hi = EXCLUDED.name_hi,
               lat = EXCLUDED.lat,
               lng = EXCLUDED.lng,
               parent_locality_id = EXCLUDED.parent_locality_id,
               seo_aliases = EXCLUDED.seo_aliases`,
            [
              lucknowId,
              m.slug,
              m.name_en,
              m.name_hi,
              m.lat ?? null,
              m.lng ?? null,
              parentId,
              m.seo_aliases ?? []
            ]
          );
        }
        console.log(`Seeded ${micros.length} Lucknow micro-localities.`);

        // Best-effort: backfill geo_point if PostGIS available
        try {
          await client.query(
            `UPDATE localities
             SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
             WHERE city_id = $1 AND lat IS NOT NULL AND lng IS NOT NULL AND geo_point IS NULL`,
            [lucknowId]
          );
        } catch {
          /* PostGIS not available, skip */
        }
      }
    }
  } catch (err) {
    console.warn(
      "Lucknow micro-localities seed skipped:",
      err instanceof Error ? err.message : err
    );
  }

  // ── Lucknow landmarks (colleges, hospitals, malls, etc.) ────────────────────
  try {
    type Landmark = {
      slug: string;
      name_en: string;
      name_hi: string;
      type: string;
      aka?: string[];
      lat: number;
      lng: number;
      primary_locality_slug?: string;
    };

    const landmarksPath = path.join(seedDir, "lucknow", "landmarks.json");
    if (fs.existsSync(landmarksPath)) {
      const landmarks = JSON.parse(fs.readFileSync(landmarksPath, "utf8")) as Landmark[];
      const lucknowId = cityBySlug.get("lucknow");
      if (lucknowId) {
        const localityRows = await client.query(
          `SELECT id, slug FROM localities WHERE city_id = $1`,
          [lucknowId]
        );
        const localityBySlug = new Map(
          localityRows.rows.map((r: { id: number; slug: string }) => [r.slug, r.id])
        );

        for (const l of landmarks) {
          const primaryLocalityId = l.primary_locality_slug
            ? (localityBySlug.get(l.primary_locality_slug) ?? null)
            : null;
          await client.query(
            `INSERT INTO landmarks
               (city_id, slug, name_en, name_hi, type, aka, lat, lng, primary_locality_id)
             VALUES ($1, $2, $3, $4, $5::landmark_type, $6, $7, $8, $9)
             ON CONFLICT (city_id, slug) DO UPDATE SET
               name_en = EXCLUDED.name_en,
               name_hi = EXCLUDED.name_hi,
               type = EXCLUDED.type,
               aka = EXCLUDED.aka,
               lat = EXCLUDED.lat,
               lng = EXCLUDED.lng,
               primary_locality_id = EXCLUDED.primary_locality_id,
               updated_at = now()`,
            [
              lucknowId,
              l.slug,
              l.name_en,
              l.name_hi,
              l.type,
              l.aka ?? [],
              l.lat,
              l.lng,
              primaryLocalityId
            ]
          );
        }
        console.log(`Seeded ${landmarks.length} Lucknow landmarks.`);

        try {
          await client.query(
            `UPDATE landmarks
             SET geo_point = ST_SetSRID(ST_MakePoint(lng::float8, lat::float8), 4326)::geography
             WHERE city_id = $1 AND geo_point IS NULL`,
            [lucknowId]
          );
        } catch {
          /* PostGIS not available, skip */
        }
      }
    }
  } catch (err) {
    console.warn("Lucknow landmarks seed skipped:", err instanceof Error ? err.message : err);
  }

  await client.end();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
