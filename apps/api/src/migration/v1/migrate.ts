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
