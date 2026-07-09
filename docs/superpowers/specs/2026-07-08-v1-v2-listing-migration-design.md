# v1 → v2 Listing Migration — Design (2026-07-08)

Migrate **verified** listings from the live v1 business (MongoDB Atlas) into v2
(Postgres + PostGIS), copy their photos into v2's Azure blob storage, and record
a `v1_id → v2_id` map that becomes the SEO cutover's 301 redirect source.

**Status:** design for review. Nothing runs until this spec is approved and the
user runs it themselves (all writes stay in the user's hands).

---

## 1. Scope

- **In:** `verified: true` listings only — **67 `properties`** (→ `flat_house`) +
  **19 `pgs`** (→ `pg`) = **86 listings**; their **owners**; their **photos**
  (Cloudinary → Azure); and a **migration map** (301 source).
- **Out:** unverified listings, v1 tenants, tours, inquiries, saved/sale
  properties, past transactions. (v2's monetization is contact-unlock; old
  payment data does not carry over.)
- **Success:** 86 verified listings live in v2 with photos + geo + owner, each
  reachable at its v2 canonical URL; a complete `v1_id → v2_id` map exists; the
  run is **idempotent** (re-runnable without duplicates) and emits a
  reconciliation report of anything skipped for manual review.

## 2. Source (v1 — MongoDB `test` DB, read-only)

- **`properties`** — flats/houses. Owner denormalized: `ownerPhone` (10-digit,
  67/67), `owner`, `ownerEmail`, plus `userId`. `type` ∈ {Apartment, House/Villa,
  Independent House, Single Rooms, Villa}.
- **`pgs`** — PGs. `ownerPhone` **now 19/19** (verified 2026-07-09; was 0/19
  earlier — owner numbers were added). Rich
  `rooms[]` (beds/bathrooms/kitchens + per-room rent/deposit), `amenities[]`,
  `services[]`.
- Both: `nameListing` (title), `description`, `expected_rent`, `expected_deposit`,
  `location` = GeoJSON `{type:Point, coordinates:[lng,lat]}`, `city`/`state`/
  `pincode`/`houseNum`/`society`/`landmark`, `furnishing`, `pref_tenant`,
  `avail_from`, `verified`, **`cloudinary_public_ids[]`** (photos), timestamps.
- **`users`** — `name`, `email`, `userType` (no phone).
- **Excel `Cribliv_Property_Location.xlsx` (sheet "Property Master")** — supplementary
  owner contacts keyed by **Property Name** (≈ `nameListing`): `Owner Name`,
  `Owner Mobile` (10-digit), Google Maps link, address, rent/deposit, etc.

## 3. Target (v2 — Postgres/PostGIS)

Per listing: `listings` + `listing_locations` (geo) + `listing_photos`; PGs also
`pg_details` (+ room types). Owners → `users` (owner role, phone-based). Plus one
**new table** (migration 0051):

```sql
-- migration_map: source of truth for idempotency AND the 301 redirect map
CREATE TABLE v1_migration_map (
  v1_id           text PRIMARY KEY,            -- Mongo _id (hex string)
  v1_collection   text NOT NULL,               -- 'properties' | 'pgs'
  v1_name         text,                         -- nameListing (for 301 old-URL build)
  v2_listing_id   uuid NOT NULL REFERENCES listings(id),
  owner_source    text NOT NULL,                -- 'mongo' | 'excel' | 'import_fallback'
  migrated_at     timestamptz NOT NULL DEFAULT now()
);
```

(We keep the map in its own table rather than a column on `listings` so it's a
clean, queryable artifact for the redirect generator and re-runs.)

## 4. Field mapping

| v1                                                                           | → v2                                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `properties`                                                                 | `listings.listing_type = 'flat_house'`                            |
| `pgs`                                                                        | `listings.listing_type = 'pg'` + `pg_details`                     |
| `nameListing`                                                                | `listings.title_en`                                               |
| `description`                                                                | `listings.description_en`                                         |
| `expected_rent` / `expected_deposit`                                         | `monthly_rent` / `security_deposit`                               |
| `bedrooms`/`bathrooms`/`balconies`/`area`/`floor`/`furnishing`/`pref_tenant` | listing fields                                                    |
| `properties.type`                                                            | stored as subtype (Apartment/Villa/…); listing stays `flat_house` |
| `location.coordinates [lng,lat]`                                             | `listing_locations.geo_point` (PostGIS)                           |
| `city` (trimmed)                                                             | v2 city slug via a normalization map                              |
| `pgs.rooms[]`                                                                | `pg_details` + room types (per-room rent/sharing)                 |
| `pgs.amenities[]` / `services[]`                                             | v2 amenity set (by `amenityName`)                                 |
| `verified: true`                                                             | `verification_status = 'verified'`                                |
| `cloudinary_public_ids[]`                                                    | `listing_photos` (after Azure copy — §6)                          |

**City normalization:** trim whitespace (`"Lucknow "`→`lucknow`); map
`Gurugram→gurugram`, `Lucknow→lucknow`, `Varanasi→varanasi`. **Varanasi is not in
v2's `cities`** — add it (seed row + optional `seo_city_config`).

## 5. Owner resolution (three-tier)

For each listing, resolve an owner phone → normalize to E.164 (`+91` + 10 digits):

1. **Mongo `ownerPhone`** if present. **Verified 2026-07-09: covers all 86 —
   properties 67/67 AND pgs 19/19.** This is now the sole tier that fires in
   practice; tiers 2–3 are safety nets that should never be reached for the
   current verified set.
2. else **Excel** row where `Property Name` matches `nameListing` (normalized,
   fuzzy-tolerant) → `Owner Mobile`.
3. else **`import_fallback`**: attach to a single dedicated **"Cribliv Import"
   owner account** (created once); store original `owner`/`ownerEmail` on the
   listing as metadata; **log for manual review**.

The script still implements all three tiers (defensive — new/re-added listings
or a re-run after data changes could reintroduce a gap), but the dry-run report
is expected to show `owner_source = mongo` for 86/86.

**Phone format verified 2026-07-09:** all 86 `ownerPhone` values are clean
10-digit strings (one 9-digit PG value was found and fixed at source, re-checked
→ 0 bad). The E.164 normalizer only needs to prepend `+91`; still guard against
malformed input defensively.

Owner accounts are **upserted by phone** (`users` unique on phone) with role
`owner` — so contact-unlock reveals the real owner where we have a number.
`owner_source` is recorded in the map for auditability.

## 6. Photos — Cloudinary → Azure (decided: copy)

Cloud name **`dia01qg8p`**. For each `public_id` (e.g.
`cribliv/properties/<v1id>/<file>.png`):
`https://res.cloudinary.com/dia01qg8p/image/upload/<public_id>` → **download** →
**upload** to the v2 listing-photos Azure blob container (same path convention as
the operator upload flow) → insert `listing_photos` (first = cover). Copying
(not referencing) so images survive v1/Cloudinary decommission at cutover.
Failed photo copies are logged and retried; a listing with 0 successful photos is
flagged (not silently published imageless).

## 7. 301 redirect map (cutover artifact)

**v1 URL format (RESOLVED 2026-07-09):** flats are served at
`https://cribliv.com/properties/<slug>-<v1_id>` where `<v1_id>` is the 24-hex
Mongo ObjectId as the **final `-`-delimited token** of the path, e.g.
`…/properties/3-bhk-for-rent-near-krishna-nagar-alambagh-69940773dd3811521305c48c`.
The `<slug>` prefix is SEO text and its format **drifts** (`3-bhk` vs `3bhk` seen
in the wild) — so we do **not** regenerate slugs. The trailing ObjectId is the
stable join key.

The migration records `v1_id`, `v1_name`, `v2_listing_id`. A separate generator
emits `old_url → new_url`:

- **new_url** = v2 canonical: `/{locale}/pg/{city}/{id}` (PG) or
  `/{locale}/listing/{id}` — built from the v2 listing UUID (v2 has **no listing
  slug**; confirmed in schema).
- **old_url** = the **exact** indexed v1 URL, sourced from **Google Search
  Console** (Performance → Pages export). For each `/properties/…-<id>` URL we
  extract the trailing 24-hex `<id>`, join to `v1_migration_map.v1_id`, and pair
  it to the new_url. Using GSC (not regenerated slugs) means we redirect the
  URLs that actually hold SEO equity, exact-matched, ranked by impressions.
- **PG URL path:** the three sampled URLs are all flats under `/properties/`.
  The PG path (possibly `/pg/…`) will be confirmed from the same GSC export
  before generating the map.

The migration itself does **not** block on the 301 map — the map is a separate
downstream generator that reads `v1_migration_map` + the GSC export at cutover.

## 8. Execution model

A standalone, idempotent Node/TS script (new `scripts/migrate-v1-listings/`), run
**by the user** with env: `MONGO_URL` (read-only user), `DATABASE_URL` (v2 target),
Azure blob creds, `CLOUDINARY_CLOUD_NAME=dia01qg8p`, path to the Excel.

- **`--dry-run` (default):** reads Mongo + Excel, resolves everything, validates,
  and writes a **report** (counts, owner-source breakdown, unmatched names,
  missing geo, photo failures) — **no writes**.
- **`--apply`:** performs the upserts (listings/owners/photos/map) inside
  per-listing transactions; re-running upserts by `v1_id`.
- **Order of runs:** local/staging v2 first (full dry-run + apply, eyeball the
  results), then prod v2 (user runs; prod writes are the user's, per project rule).

## 9. Safety & idempotency

- Mongo access **read-only**; v2 writes **idempotent** (keyed on `v1_id` in the
  map, owners on phone, photos on a deterministic blob path).
- No PII leaves the user's machine — the script runs locally against their creds.
- Migration **0051** adds `v1_migration_map` (additive; paired rollback).
- Dry-run report is the go/no-go gate before `--apply` on prod.

## 10. Open inputs / decisions still needed

1. **v1 listing URL format** — for the 301 generator (deferrable; migration runs without it).
2. **Excel name-match reconciliation** — the script reports unmatched/ambiguous
   names; user resolves those before the final owner pass.
3. **PG owner accounts** — RESOLVED (2026-07-09): Mongo `pgs.ownerPhone` is now
   19/19, so PGs resolve via Tier 1 like properties. Excel/import fallback no
   longer expected to fire.

## 11. Testing

- Unit: mappers (property→listing, pg→pg_details+rooms, city normalize, phone
  E.164, cloudinary URL build) on fixtures.
- Integration: dry-run against a throwaway Mongo fixture + local v2; assert
  counts, geo, owner-source split, map completeness, idempotency (run twice → same
  row counts).
- Manual: spot-check 3–5 migrated listings render on local v2 with photos + geo +
  owner + correct city page.
