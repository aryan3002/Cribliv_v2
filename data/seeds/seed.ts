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

  await client.end();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
