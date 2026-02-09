import "dotenv/config";
import fs from "fs";
import path from "path";
import { Client } from "pg";

interface City {
  slug: string;
  name_en: string;
  name_hi: string;
  state_en: string;
  state_hi: string;
}

interface Locality {
  city_slug: string;
  slug: string;
  name_en: string;
  name_hi: string;
  pincode?: string;
  lat?: number;
  lng?: number;
}

async function seed() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const cities = JSON.parse(fs.readFileSync(path.join(__dirname, "cities.json"), "utf8")) as City[];
  const localities = JSON.parse(
    fs.readFileSync(path.join(__dirname, "localities.json"), "utf8")
  ) as Locality[];

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

  const cityRows = await client.query<{ id: number; slug: string }>("SELECT id, slug FROM cities");
  const cityBySlug = new Map(cityRows.rows.map((row) => [row.slug, row.id]));

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
  await client.end();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
