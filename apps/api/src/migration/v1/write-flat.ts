import type { MigrationConfig } from "./config";
import type { FlatInput } from "./map-flat";
import type { Report } from "./report";
import { buildBlobName, uploadPhoto } from "./azure-photos";
import { cloudinaryUrl, extFromContentType } from "./v1-url";
import { downloadImage } from "./cloudinary";

type Q = { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> };

export async function writeFlat(
  client: Q,
  container: any,
  cfg: MigrationConfig,
  flat: FlatInput,
  cityId: number | null,
  ownerId: string,
  ownerSource: string,
  report: Report
): Promise<void> {
  if (!cityId) {
    report.skipped++;
    report.add("warn", `SKIP ${flat.v1Id} — ${flat.warnings.join("; ")}`);
    return;
  }
  if (flat.monthlyRent <= 0) {
    report.skipped++;
    report.add("warn", `SKIP ${flat.v1Id} — no rent`);
    return;
  }

  // Idempotency: has this v1_id already been migrated?
  const existing = await client.query(
    `SELECT v2_listing_id::text AS id FROM v1_migration_map WHERE v1_id=$1`,
    [flat.v1Id]
  );
  let listingId: string;
  if (existing.rows[0]) {
    listingId = existing.rows[0].id;
    await client.query(
      `UPDATE listings SET title_en=$2, description_en=$3, monthly_rent=$4, security_deposit=$5,
         bhk=$6, bathrooms=$7, area_sqft=$8, furnishing=$9::furnishing_type,
         preferred_tenant=$10::tenant_pref, available_from=$11, contact_phone_encrypted=$12,
         status='active', verification_status='verified', updated_at=now()
       WHERE id=$1::uuid`,
      [
        listingId,
        flat.titleEn,
        flat.descriptionEn,
        flat.monthlyRent,
        flat.securityDeposit,
        flat.bhk,
        flat.bathrooms,
        flat.areaSqft,
        flat.furnishing,
        flat.preferredTenant,
        flat.availableFrom,
        await ownerPhone(client, ownerId)
      ]
    );
  } else {
    const ins = await client.query(
      `INSERT INTO listings
         (owner_user_id, listing_type, title_en, description_en, status, verification_status,
          monthly_rent, security_deposit, bhk, bathrooms, area_sqft, furnishing, preferred_tenant,
          available_from, contact_phone_encrypted, whatsapp_available, amenities)
       VALUES ($1::uuid,'flat_house',$2,$3,'active','verified',$4,$5,$6,$7,$8,$9::furnishing_type,
          $10::tenant_pref,$11,$12,$13,$14::jsonb)
       RETURNING id::text`,
      [
        ownerId,
        flat.titleEn,
        flat.descriptionEn,
        flat.monthlyRent,
        flat.securityDeposit,
        flat.bhk,
        flat.bathrooms,
        flat.areaSqft,
        flat.furnishing,
        flat.preferredTenant,
        flat.availableFrom,
        await ownerPhone(client, ownerId),
        flat.whatsappAvailable,
        JSON.stringify(flat.amenities ?? [])
      ]
    );
    listingId = ins.rows[0].id;
  }

  // Location (upsert). Fires trigger → listings.city_slug.
  await client.query(
    `INSERT INTO listing_locations (listing_id, city_id, address_line1, landmark, pincode, lat, lng)
     VALUES ($1::uuid,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (listing_id) DO UPDATE SET city_id=EXCLUDED.city_id, address_line1=EXCLUDED.address_line1,
       landmark=EXCLUDED.landmark, pincode=EXCLUDED.pincode, lat=EXCLUDED.lat, lng=EXCLUDED.lng, updated_at=now()`,
    [listingId, cityId, flat.addressLine1, flat.landmark, flat.pincode, flat.lat, flat.lng]
  );

  // geo_point (best-effort; PostGIS may be absent locally).
  if (flat.lat != null && flat.lng != null) {
    await client.query("SAVEPOINT geo");
    try {
      await client.query(
        `UPDATE listing_locations
           SET geo_point = ST_SetSRID(ST_MakePoint($2::float8,$3::float8),4326)::geography
         WHERE listing_id=$1::uuid`,
        [listingId, flat.lng, flat.lat]
      );
      await client.query("RELEASE SAVEPOINT geo");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT geo");
    }
  }

  // Photos (download from Cloudinary → upload to Azure → record).
  // Skipped for local validation (--skip-photos): Azure Blob isn't transactional,
  // so we don't touch prod storage until the real prod apply.
  let cover = true;
  let idx = 0;
  for (const publicId of cfg.skipPhotos ? [] : flat.publicIds) {
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
         ON CONFLICT (listing_id, client_upload_id) DO UPDATE SET
           blob_path=EXCLUDED.blob_path, sort_order=EXCLUDED.sort_order, is_cover=EXCLUDED.is_cover, updated_at=now()`,
        [listingId, blobName, idx, cover, `v1:${publicId}`]
      );
      report.photosOk++;
      cover = false;
      idx++;
    } catch (e) {
      report.photosFail++;
      report.add(
        "warn",
        `photo fail ${flat.v1Id} ${publicId}: ${e instanceof Error ? e.message : e}`
      );
    }
  }
  if (report.photosOk === 0 && flat.publicIds.length > 0)
    report.add("warn", `${flat.v1Id} — all photos failed`);

  // Map row (idempotency key + 301 source).
  await client.query(
    `INSERT INTO v1_migration_map (v1_id, v1_collection, v1_name, v2_listing_id, owner_source)
     VALUES ($1,'properties',$2,$3::uuid,$4)
     ON CONFLICT (v1_id) DO UPDATE SET v2_listing_id=EXCLUDED.v2_listing_id, v1_name=EXCLUDED.v1_name, owner_source=EXCLUDED.owner_source`,
    [flat.v1Id, flat.titleEn, listingId, ownerSource]
  );
  report.migrated++;
  report.ownerSource[ownerSource] = (report.ownerSource[ownerSource] ?? 0) + 1;
}

async function ownerPhone(client: Q, ownerId: string): Promise<string | null> {
  const { rows } = await client.query(`SELECT phone_e164 FROM users WHERE id=$1::uuid`, [ownerId]);
  return rows[0]?.phone_e164 ?? null;
}
