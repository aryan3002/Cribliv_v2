#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function run() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }

  const migrationsDir = __dirname;
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();

  const client = new Client({ connectionString: databaseUrl });
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
