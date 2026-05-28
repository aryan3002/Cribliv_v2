#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const requireFromApi = createRequire(path.resolve(__dirname, "../../apps/api/package.json"));
const dotenv = requireFromApi("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
const { Client } = requireFromApi("pg");

function normalizeLocalhostConnectionString(connectionString) {
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

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const resolvedDatabaseUrl = normalizeLocalhostConnectionString(databaseUrl);

  const migrationsDir = __dirname;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();

  const client = new Client({ connectionString: resolvedDatabaseUrl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id serial PRIMARY KEY,
      filename text UNIQUE NOT NULL,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const applied = await client.query("SELECT 1 FROM schema_migrations WHERE filename = $1", [
      file
    ]);
    if (applied.rowCount > 0) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`Applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  await client.end();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
