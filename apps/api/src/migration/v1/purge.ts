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

  // 1. Clear blocking (NO ACTION) children of the fake listings.
  for (const t of ["contact_unlocks", "shortlists", "verification_attempts", "sales_leads"]) {
    const r = await client.query(`DELETE FROM ${t} WHERE listing_id IN (${fakeSel})`);
    console.log(`  cleared ${t}: ${r.rowCount ?? 0}`);
  }

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
    `DELETE FROM pg_properties WHERE id NOT IN (SELECT pg_property_id FROM listings WHERE pg_property_id IS NOT NULL)`
  );
  console.log(`  deleted orphaned pg_properties: ${delPgProps.rowCount ?? 0}`);

  console.log(`purge complete.`);
}
