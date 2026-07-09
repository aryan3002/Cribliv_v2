import type { Report } from "./report";

type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount?: number }> };

/**
 * Delete every listing NOT in v1_migration_map (the pre-migration fakes), their
 * blocking child rows, and orphaned PG head tables. KEEPS all users. Idempotent.
 * GUARDED: aborts if the migration map looks empty, so it can never purge
 * everything when run before the migration.
 */
export async function purgeNonMigrated(client: Q, _report: Report): Promise<void> {
  const n = async (sql: string) => Number((await client.query(sql)).rows[0].n);
  const mapCount = await n(`SELECT count(*)::int n FROM v1_migration_map`);
  const totalListings = await n(`SELECT count(*)::int n FROM listings`);
  const fakeSel = `SELECT id FROM listings WHERE id NOT IN (SELECT v2_listing_id FROM v1_migration_map)`;
  const fake = await n(`SELECT count(*)::int n FROM (${fakeSel}) x`);

  console.log(`\n──── PURGE non-migrated listings ────`);
  console.log(`migration map rows: ${mapCount}`);
  console.log(`listings total:     ${totalListings}`);
  console.log(`to delete (fake):   ${fake}`);

  // Safety: never purge everything. A tiny map means the migration hasn't run.
  // Expected migrated count is 86 (67 flats + 19 PGs), so 50 is a deliberate "clearly-migrated" threshold.
  if (mapCount < 50) {
    throw new Error(
      `SAFETY ABORT: v1_migration_map has only ${mapCount} rows (<50). Run the migration before purging.`
    );
  }
  if (fake === 0) {
    console.log("nothing to purge.");
    return;
  }

  const bd = (
    await client.query(
      `SELECT listing_type, status, count(*)::int n FROM listings
       WHERE id NOT IN (SELECT v2_listing_id FROM v1_migration_map)
       GROUP BY 1,2 ORDER BY 3 DESC`
    )
  ).rows;
  bd.forEach((r: any) => console.log(`  ${r.listing_type}/${r.status}: ${r.n}`));

  // 1. Clear blocking (NO ACTION) descendants in child→parent order.
  //    Verified full FK tree: contact_unlocks is itself blocked by contact_events + leads.
  const unlocksOfFakes = `SELECT id FROM contact_unlocks WHERE listing_id IN (${fakeSel})`;
  const clear = async (label: string, sql: string) => {
    const r = await client.query(sql);
    console.log(`  cleared ${label}: ${r.rowCount ?? 0}`);
  };
  await clear(
    "contact_events",
    `DELETE FROM contact_events WHERE contact_unlock_id IN (${unlocksOfFakes})`
  );
  await clear(
    "leads",
    `DELETE FROM leads WHERE listing_id IN (${fakeSel}) OR contact_unlock_id IN (${unlocksOfFakes})`
  );
  await clear("contact_unlocks", `DELETE FROM contact_unlocks WHERE listing_id IN (${fakeSel})`);
  await clear("shortlists", `DELETE FROM shortlists WHERE listing_id IN (${fakeSel})`);
  await clear(
    "verification_attempts",
    `DELETE FROM verification_attempts WHERE listing_id IN (${fakeSel})`
  );
  await clear("sales_leads", `DELETE FROM sales_leads WHERE listing_id IN (${fakeSel})`);

  // 2. Delete the fake listings (cascades locations/photos/events/scores/leads/boosts/metro_walks/fraud_flags).
  const delListings = await client.query(`DELETE FROM listings WHERE id IN (${fakeSel})`);
  console.log(`  deleted listings: ${delListings.rowCount ?? 0}`);

  // 3. Delete orphaned PG heads (projection gone). Cascades pg_details/pg_room_types/pg_analytics_overrides.
  const delPgListings = await client.query(
    `DELETE FROM pg_listings WHERE id NOT IN (SELECT id FROM listings)`
  );
  console.log(`  deleted orphaned pg_listings: ${delPgListings.rowCount ?? 0}`);

  // 4. Delete orphaned pg_properties (not referenced by any surviving listing).
  const delPgProps = await client.query(
    `DELETE FROM pg_properties WHERE id NOT IN (
       SELECT pg_property_id FROM listings WHERE pg_property_id IS NOT NULL
       UNION
       SELECT pg_property_id FROM pg_listings WHERE pg_property_id IS NOT NULL
     )`
  );
  console.log(`  deleted orphaned pg_properties: ${delPgProps.rowCount ?? 0}`);

  console.log(`purge complete.`);
}
