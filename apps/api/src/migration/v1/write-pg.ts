import type { MigrationConfig } from "./config";
import type { PgInput } from "./map-pg";
import type { Report } from "./report";
import { buildBlobName, uploadPhoto } from "./azure-photos";
import { cloudinaryUrl, extFromContentType } from "./v1-url";
import { downloadImage } from "./cloudinary";

const { createRequire } = require("module") as typeof import("module");
const path = require("path") as typeof import("path");
const requireFromApi = createRequire(path.resolve(__dirname, "../../../package.json"));
const { randomUUID } = requireFromApi("crypto");

type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> };

export async function writePg(
  client: Q,
  container: any,
  cfg: MigrationConfig,
  pg: PgInput,
  cityId: number | null,
  operatorId: string,
  ownerSource: string,
  report: Report
): Promise<void> {
  if (!cityId) {
    report.skipped++;
    report.add("warn", `SKIP PG ${pg.v1Id} — ${pg.warnings.join("; ")}`);
    return;
  }
  if (pg.rooms.length === 0 || pg.startingRentPaise <= 0) {
    report.skipped++;
    report.add("warn", `SKIP PG ${pg.v1Id} — no priced rooms`);
    return;
  }

  // Reuse the same id across pg_listings + listings projection. Idempotent via map.
  const existing = await client.query(
    `SELECT v2_listing_id::text AS id FROM v1_migration_map WHERE v1_id=$1`,
    [pg.v1Id]
  );
  const listingId: string = existing.rows[0]?.id ?? randomUUID();
  const ownerPhone =
    (await client.query(`SELECT phone_e164 FROM users WHERE id=$1::uuid`, [operatorId])).rows[0]
      ?.phone_e164 ?? null;

  // 1. pg_properties (operator-owned building). Upsert by a deterministic id derived from listingId.
  const propId: string = existing.rows[0]
    ? ((
        await client.query(`SELECT pg_property_id::text AS id FROM listings WHERE id=$1::uuid`, [
          listingId
        ])
      ).rows[0]?.id ?? randomUUID())
    : randomUUID();
  await client.query(
    `INSERT INTO pg_properties (id, operator_id, display_name, city_id, status, is_primary)
     VALUES ($1::uuid,$2::uuid,$3,$4,'active',true)
     ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, city_id=EXCLUDED.city_id`,
    [propId, operatorId, pg.displayName, cityId]
  );

  // 2. pg_listings (head).
  await client.query(
    `INSERT INTO pg_listings (id, operator_user_id, pg_property_id, title, starting_rent_paise, status, verification_status)
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,'active'::listing_status,'verified')
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, starting_rent_paise=EXCLUDED.starting_rent_paise, status='active'`,
    [listingId, operatorId, propId, pg.titleEn, pg.startingRentPaise]
  );

  // 3. pg_details (FK → pg_listings.id).
  await client.query(
    `INSERT INTO pg_details (listing_id, total_beds, amenities, house_rules, payment_modes, onboarding_path)
     VALUES ($1::uuid,$2,$3::jsonb,'{}'::jsonb,'[]'::jsonb,'self_serve')
     ON CONFLICT (listing_id) DO UPDATE SET total_beds=EXCLUDED.total_beds, amenities=EXCLUDED.amenities`,
    [listingId, pg.totalBeds, JSON.stringify(pg.amenities)]
  );

  // 4. pg_room_types (per room). Upsert key (listing_id, sharing, ac, bathroom_kind, furnishing).
  for (const rt of pg.rooms) {
    await client.query(
      `INSERT INTO pg_room_types (listing_id, sharing, ac, bathroom_kind, furnishing, room_size_sqft, monthly_rent_paise, vacancy_count, available_from)
       VALUES ($1::uuid,$2::pg_sharing_kind,$3,$4::pg_bathroom_kind,$5::furnishing_type,$6,$7,$8,$9)
       ON CONFLICT (listing_id, sharing, ac, bathroom_kind, furnishing) DO UPDATE SET
         monthly_rent_paise=EXCLUDED.monthly_rent_paise, vacancy_count=EXCLUDED.vacancy_count`,
      [
        listingId,
        rt.sharing,
        rt.ac,
        rt.bathroomKind,
        rt.furnishing,
        rt.roomSizeSqft,
        rt.monthlyRentPaise,
        rt.vacancyCount,
        rt.availableFrom
      ]
    );
  }

  // 5. listings projection (SAME id, listing_type='pg', amenities '[]').
  await client.query(
    `INSERT INTO listings (id, owner_user_id, listing_type, title_en, description_en, status, verification_status,
        monthly_rent, amenities, pg_property_id, contact_phone_encrypted, whatsapp_available)
     VALUES ($1::uuid,$2::uuid,'pg',$3,$4,'active','verified',$5,'[]'::jsonb,$6::uuid,$7,false)
     ON CONFLICT (id) DO UPDATE SET title_en=EXCLUDED.title_en, description_en=EXCLUDED.description_en,
       monthly_rent=EXCLUDED.monthly_rent, status='active', verification_status='verified', updated_at=now()`,
    [listingId, operatorId, pg.titleEn, pg.descriptionEn, pg.monthlyRentRupees, propId, ownerPhone]
  );

  // 6. listing_locations + 7. geo (same as flats).
  await client.query(
    `INSERT INTO listing_locations (listing_id, city_id, address_line1, landmark, pincode, lat, lng)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (listing_id) DO UPDATE SET city_id=EXCLUDED.city_id, address_line1=EXCLUDED.address_line1,
       landmark=EXCLUDED.landmark, pincode=EXCLUDED.pincode, lat=EXCLUDED.lat, lng=EXCLUDED.lng, updated_at=now()`,
    [listingId, cityId, pg.addressLine1, pg.landmark, pg.pincode, pg.lat, pg.lng]
  );
  if (pg.lat != null && pg.lng != null) {
    await client.query("SAVEPOINT geo");
    try {
      await client.query(
        `UPDATE listing_locations SET geo_point = ST_SetSRID(ST_MakePoint($2::float8,$3::float8),4326)::geography WHERE listing_id=$1::uuid`,
        [listingId, pg.lng, pg.lat]
      );
      await client.query("RELEASE SAVEPOINT geo");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT geo");
    }
  }

  // 8. photos (skipped for local via --skip-photos; Azure Blob isn't transactional).
  let cover = true,
    idx = 0;
  for (const publicId of cfg.skipPhotos ? [] : pg.publicIds) {
    // Per-photo SAVEPOINT — a bad photo is logged, never aborts the outer txn.
    await client.query("SAVEPOINT photo");
    try {
      const { buffer, contentType } = await downloadImage(
        cloudinaryUrl(cfg.cloudinaryCloud, publicId)
      );
      const ext =
        extFromContentType(contentType) === "bin" ? "jpg" : extFromContentType(contentType);
      const blobName = buildBlobName(listingId, publicId, ext);
      await uploadPhoto(container, blobName, buffer, contentType);
      await client.query(
        `INSERT INTO listing_photos (listing_id, blob_path, sort_order, is_cover, moderation_status, client_upload_id)
         VALUES ($1::uuid,$2,$3,$4,'approved',$5)
         ON CONFLICT (listing_id, client_upload_id) DO UPDATE SET blob_path=EXCLUDED.blob_path, updated_at=now()`,
        [listingId, blobName, idx, cover, `v1:${publicId}`]
      );
      await client.query("RELEASE SAVEPOINT photo");
      report.photosOk++;
      cover = false;
      idx++;
    } catch (e) {
      await client.query("ROLLBACK TO SAVEPOINT photo");
      report.photosFail++;
      report.add(
        "warn",
        `photo fail PG ${pg.v1Id} ${publicId}: ${e instanceof Error ? e.message : e}`
      );
    }
  }

  // 9. map row.
  await client.query(
    `INSERT INTO v1_migration_map (v1_id, v1_collection, v1_name, v2_listing_id, owner_source)
     VALUES ($1,'pgs',$2,$3::uuid,$4)
     ON CONFLICT (v1_id) DO UPDATE SET v2_listing_id=EXCLUDED.v2_listing_id, v1_name=EXCLUDED.v1_name, owner_source=EXCLUDED.owner_source`,
    [pg.v1Id, pg.titleEn, listingId, ownerSource]
  );
  report.migrated++;
  report.ownerSource[ownerSource] = (report.ownerSource[ownerSource] ?? 0) + 1;
}
