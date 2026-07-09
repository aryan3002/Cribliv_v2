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
        const operatorName =
          source === "import_fallback" ? IMPORT_FALLBACK_NAME : (doc.owner ?? null);
        // PG operators get role pg_operator (not owner) — matches v2 PG model.
        const opId = (
          await client.query(
            `INSERT INTO users (phone_e164, role, full_name, preferred_language)
               VALUES ($1,'pg_operator'::user_role,$2,'en')
               ON CONFLICT (phone_e164) DO UPDATE SET role = CASE WHEN users.role = 'admin' THEN users.role ELSE 'pg_operator'::user_role END, is_blocked=false,
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
