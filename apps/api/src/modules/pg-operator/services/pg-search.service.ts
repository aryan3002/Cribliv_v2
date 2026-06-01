import { Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../../common/database.service";

export interface PgCard {
  id: string;
  title: string;
  city: string;
  city_name: string | null;
  locality: string | null;
  listing_type: "pg";
  starting_rent: number | null;
  sharing_options: string[];
  gender_policy: string | null;
  food_included: boolean;
  verified: boolean;
  cover_photo: string | null;
}

export interface PgSearchResult {
  items: PgCard[];
  total: number;
  page: number;
  page_size: number;
}

export interface PgSuggestRow {
  type: "city" | "locality" | "listing";
  label: string;
  value: string;
  listing_count?: number;
  rent_band?: { min: number; max: number };
  city_slug?: string;
  cover_url?: string | null;
  rent?: number;
  verified?: boolean;
  locality_label?: string;
  posted_at?: string;
}

export interface PgPreview {
  type: "city" | "locality";
  slug: string;
  name: string;
  city_slug?: string;
  listing_count: number;
  rent_band: { min: number; max: number } | null;
  verified_pct: number | null;
  /** Always null for PG — keeps the shape compatible with the property preview;
   *  the UI swaps this stat for `sharing` in PG mode. */
  avg_bhk: number | null;
  /** Distinct sharing kinds offered across the PGs in this place. */
  sharing: string[];
  sample_photos: string[];
}

interface PgSearchRow {
  id: string;
  title: string;
  city: string;
  city_name: string | null;
  locality: string | null;
  starting_rent: number | null;
  verification_status: string;
  gender_policy: string | null;
  food_included: boolean | null;
  sharing_options: string[] | null;
  cover_photo: string | null;
}

/**
 * Tenant-facing PG search. Reads the shared `listings` PROJECTION
 * (listing_type='pg' AND status='active') joined to the PG aggregate
 * (pg_details 1:1, pg_room_types 1:N) for PG-only card fields + filters.
 * Read-only; never mutates the projection.
 */
@Injectable()
export class PgSearchService {
  private readonly photoBase = (process.env.PHOTO_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async search(query: Record<string, string | undefined>): Promise<PgSearchResult> {
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(Math.max(Number(query.page_size) || 20, 1), 60);

    if (!this.db.isEnabled()) {
      return { items: [], total: 0, page, page_size: pageSize };
    }

    const clauses: string[] = ["l.listing_type = 'pg'", "l.status = 'active'"];
    const params: unknown[] = [];

    if (query.city) {
      params.push(query.city.toLowerCase());
      clauses.push(`c.slug = $${params.length}`);
    }
    if (query.locality) {
      params.push(query.locality.toLowerCase());
      clauses.push(`loc.slug = $${params.length}`);
    }
    if (query.q && query.q.trim()) {
      // Free-text matches the title AND the place (city/locality) — a bare PG
      // title match returns nothing for a city name like "Lucknow". The bar
      // routes by `city`; this keeps any stray `q` (locality, recent search)
      // from yielding a dead empty page.
      params.push(`%${query.q.trim()}%`);
      const i = params.length;
      clauses.push(
        `(l.title_en ILIKE $${i} OR l.title_hi ILIKE $${i} OR c.name_en ILIKE $${i} OR c.slug ILIKE $${i} OR loc.name_en ILIKE $${i} OR loc.slug ILIKE $${i})`
      );
    }
    if (query.min_rent) {
      params.push(Number(query.min_rent));
      clauses.push(`l.monthly_rent >= $${params.length}`);
    }
    if (query.max_rent) {
      params.push(Number(query.max_rent));
      clauses.push(`l.monthly_rent <= $${params.length}`);
    }
    if (query.gender_policy) {
      params.push(query.gender_policy);
      clauses.push(`pgd.gender_policy = $${params.length}::pg_gender_policy`);
    }
    if (query.tenant_type) {
      params.push(query.tenant_type);
      clauses.push(`pgd.tenant_type = $${params.length}::pg_tenant_type`);
    }
    if (query.food_included === "true") {
      clauses.push(`pgd.food_included = true`);
    }
    if (query.sharing) {
      params.push(query.sharing);
      clauses.push(
        `EXISTS (SELECT 1 FROM pg_room_types rt WHERE rt.listing_id = l.id AND rt.sharing = $${params.length}::pg_sharing_kind)`
      );
    }
    if (query.ac === "true") {
      clauses.push(
        `EXISTS (SELECT 1 FROM pg_room_types rt WHERE rt.listing_id = l.id AND rt.ac = true)`
      );
    }

    const where = clauses.join(" AND ");
    const orderBy =
      query.sort === "newest"
        ? "l.created_at DESC"
        : query.sort === "rent"
          ? "l.monthly_rent ASC NULLS LAST, l.created_at DESC"
          : "CASE WHEN l.verification_status = 'verified' THEN 0 ELSE 1 END ASC, l.created_at DESC";

    const countResult = await this.db.query<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       LEFT JOIN localities loc ON loc.id = ll.locality_id
       JOIN pg_details pgd ON pgd.listing_id = l.id
       WHERE ${where}`,
      params
    );

    const offset = (page - 1) * pageSize;
    const rowParams = [...params, pageSize, offset];
    const rows = await this.db.query<PgSearchRow>(
      `SELECT
         l.id::text AS id,
         COALESCE(NULLIF(l.title_en,''), NULLIF(l.title_hi,''), 'PG') AS title,
         c.slug AS city,
         c.name_en AS city_name,
         loc.name_en AS locality,
         l.monthly_rent AS starting_rent,
         l.verification_status::text AS verification_status,
         pgd.gender_policy::text AS gender_policy,
         pgd.food_included AS food_included,
         (SELECT array_agg(DISTINCT rt.sharing::text) FROM pg_room_types rt WHERE rt.listing_id = l.id) AS sharing_options,
         (SELECT lp.blob_path FROM listing_photos lp WHERE lp.listing_id = l.id AND lp.is_cover = true LIMIT 1) AS cover_photo
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       LEFT JOIN localities loc ON loc.id = ll.locality_id
       JOIN pg_details pgd ON pgd.listing_id = l.id
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams
    );

    return {
      items: rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        city: r.city,
        city_name: r.city_name,
        locality: r.locality,
        listing_type: "pg" as const,
        starting_rent: r.starting_rent == null ? null : Number(r.starting_rent),
        sharing_options: r.sharing_options ?? [],
        gender_policy: r.gender_policy,
        food_included: Boolean(r.food_included),
        verified: r.verification_status === "verified",
        cover_photo: this.toPhotoUrl(r.cover_photo)
      })),
      total: Number(countResult.rows[0]?.total ?? 0),
      page,
      page_size: pageSize
    };
  }

  /**
   * Tenant-facing PG autocomplete — mirrors the property `suggest`, scoped to
   * the PG segment. Returns: cities + localities that actually HAVE active PG
   * inventory, and PG listings (matched by title/city/locality) carrying
   * `city_slug` so the UI can route to /pg/[city]/[id]. Drafts never leak.
   */
  async suggest(q: string, limit = 8): Promise<PgSuggestRow[]> {
    const term = (q ?? "").trim().toLowerCase();
    if (term.length < 2 || !this.db.isEnabled()) return [];

    const out: PgSuggestRow[] = [];

    // Cities with active PG inventory.
    const cityRows = await this.db.query<{
      slug: string;
      name_en: string;
      listing_count: number;
      min_rent: number | null;
      max_rent: number | null;
    }>(
      `SELECT c.slug, c.name_en,
              stats.listing_count::int AS listing_count,
              stats.min_rent::int AS min_rent,
              stats.max_rent::int AS max_rent,
              similarity(c.name_en, $1) AS sim
       FROM cities c
       JOIN LATERAL (
         SELECT count(*)::int AS listing_count, min(l.monthly_rent) AS min_rent, max(l.monthly_rent) AS max_rent
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE ll.city_id = c.id AND l.status = 'active' AND l.listing_type = 'pg'
       ) stats ON true
       WHERE c.is_active = true AND stats.listing_count > 0
         AND (similarity(c.name_en, $1) > 0.15 OR c.name_en ILIKE '%' || $1 || '%' OR c.name_hi ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 3`,
      [term]
    );
    for (const r of cityRows.rows) {
      const row: PgSuggestRow = {
        type: "city",
        label: r.name_en,
        value: r.slug,
        listing_count: Number(r.listing_count)
      };
      if (r.min_rent != null && r.max_rent != null) {
        row.rent_band = { min: Number(r.min_rent), max: Number(r.max_rent) };
      }
      out.push(row);
    }

    // Localities with active PG inventory.
    const locRows = await this.db.query<{
      slug: string;
      name_en: string;
      city_slug: string;
      listing_count: number;
      min_rent: number | null;
      max_rent: number | null;
    }>(
      `SELECT loc.slug, loc.name_en, c.slug AS city_slug,
              stats.listing_count::int AS listing_count,
              stats.min_rent::int AS min_rent,
              stats.max_rent::int AS max_rent,
              similarity(loc.name_en, $1) AS sim
       FROM localities loc
       JOIN cities c ON c.id = loc.city_id
       JOIN LATERAL (
         SELECT count(DISTINCT l.id)::int AS listing_count, min(l.monthly_rent) AS min_rent, max(l.monthly_rent) AS max_rent
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         WHERE l.status = 'active' AND l.listing_type = 'pg' AND ll.locality_id = loc.id
       ) stats ON true
       WHERE c.is_active = true AND stats.listing_count > 0
         AND (similarity(loc.name_en, $1) > 0.15 OR loc.name_en ILIKE '%' || $1 || '%' OR loc.name_hi ILIKE '%' || $1 || '%')
       ORDER BY sim DESC
       LIMIT 3`,
      [term]
    );
    for (const r of locRows.rows) {
      const row: PgSuggestRow = {
        type: "locality",
        label: `${r.name_en}, ${r.city_slug}`,
        value: r.slug,
        city_slug: r.city_slug,
        listing_count: Number(r.listing_count)
      };
      if (r.min_rent != null && r.max_rent != null) {
        row.rent_band = { min: Number(r.min_rent), max: Number(r.max_rent) };
      }
      out.push(row);
    }

    // PG listings — matched by title OR city OR locality so typing a place
    // surfaces the actual PGs there. Carries city_slug for /pg/[city]/[id].
    const listingRows = await this.db.query<{
      id: string;
      title: string;
      city: string;
      locality: string | null;
      monthly_rent: number;
      verification_status: string;
      cover_path: string | null;
      created_at: string;
    }>(
      `SELECT l.id::text,
              COALESCE(NULLIF(l.title_en,''), 'PG') AS title,
              c.slug AS city,
              loc.name_en AS locality,
              l.monthly_rent,
              l.verification_status::text,
              (SELECT lp.blob_path FROM listing_photos lp WHERE lp.listing_id = l.id AND lp.is_cover = true LIMIT 1) AS cover_path,
              l.created_at,
              GREATEST(similarity(l.title_en, $1), similarity(c.name_en, $1), similarity(COALESCE(loc.name_en,''), $1)) AS sim
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       LEFT JOIN localities loc ON loc.id = ll.locality_id
       WHERE l.status = 'active' AND l.listing_type = 'pg'
         AND (
           l.title_en ILIKE '%' || $1 || '%'
           OR c.name_en ILIKE '%' || $1 || '%' OR c.slug ILIKE '%' || $1 || '%'
           OR loc.name_en ILIKE '%' || $1 || '%' OR loc.slug ILIKE '%' || $1 || '%'
         )
       ORDER BY sim DESC, l.created_at DESC
       LIMIT 5`,
      [term]
    );
    for (const r of listingRows.rows) {
      out.push({
        type: "listing",
        label: r.title,
        value: r.id,
        cover_url: this.toPhotoUrl(r.cover_path),
        rent: Number(r.monthly_rent),
        verified: r.verification_status === "verified",
        locality_label: r.locality ?? r.city,
        posted_at: r.created_at,
        city_slug: r.city
      });
    }

    return out.slice(0, limit);
  }

  /**
   * Tenant-facing PG preview — the right-side hover card, mirrored from the
   * property preview but scoped to `listing_type='pg'`. Returns PG inventory
   * stats (count, rent band, verified %, sharing kinds, sample covers) for a
   * city or locality so PG mode shows PG data instead of flat/house data.
   */
  async preview(type: string, value: string): Promise<PgPreview | null> {
    const slug = (value ?? "").trim().toLowerCase();
    if (!slug || !this.db.isEnabled()) return null;

    const buildBand = (min: number | null, max: number | null) =>
      min != null && max != null ? { min: Number(min), max: Number(max) } : null;

    if (type === "city") {
      const cityRows = await this.db.query<{ name_en: string }>(
        `SELECT name_en FROM cities WHERE slug = $1 AND is_active = true LIMIT 1`,
        [slug]
      );
      const city = cityRows.rows[0];
      if (!city) return null;

      const stats = await this.db.query<{
        listing_count: number;
        min_rent: number | null;
        max_rent: number | null;
        verified_count: number;
        sharing: string[] | null;
      }>(
        `SELECT
           count(*)::int AS listing_count,
           min(l.monthly_rent)::int AS min_rent,
           max(l.monthly_rent)::int AS max_rent,
           sum(CASE WHEN l.verification_status = 'verified' THEN 1 ELSE 0 END)::int AS verified_count,
           (SELECT array_agg(DISTINCT rt.sharing::text)
              FROM pg_room_types rt
              JOIN listings l2 ON l2.id = rt.listing_id
              JOIN listing_locations ll2 ON ll2.listing_id = l2.id
              JOIN cities c2 ON c2.id = ll2.city_id
              WHERE c2.slug = $1 AND l2.status = 'active' AND l2.listing_type = 'pg') AS sharing
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         WHERE c.slug = $1 AND l.status = 'active' AND l.listing_type = 'pg'`,
        [slug]
      );
      const row = stats.rows[0];

      const photos = await this.db.query<{ blob_path: string }>(
        `SELECT lp.blob_path
         FROM listing_photos lp
         JOIN listings l ON l.id = lp.listing_id
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         WHERE c.slug = $1 AND l.status = 'active' AND l.listing_type = 'pg' AND lp.is_cover = true
         ORDER BY l.created_at DESC
         LIMIT 4`,
        [slug]
      );

      const count = row?.listing_count ?? 0;
      return {
        type: "city",
        slug,
        name: city.name_en,
        listing_count: count,
        rent_band: buildBand(row?.min_rent ?? null, row?.max_rent ?? null),
        verified_pct: count > 0 ? Math.round(((row?.verified_count ?? 0) / count) * 100) : null,
        avg_bhk: null,
        sharing: row?.sharing ?? [],
        sample_photos: photos.rows
          .map((r) => this.toPhotoUrl(r.blob_path))
          .filter((u): u is string => Boolean(u))
      };
    }

    const locRows = await this.db.query<{ name_en: string; city_slug: string }>(
      `SELECT loc.name_en, c.slug AS city_slug
       FROM localities loc JOIN cities c ON c.id = loc.city_id
       WHERE loc.slug = $1 LIMIT 1`,
      [slug]
    );
    const loc = locRows.rows[0];
    if (!loc) return null;

    const stats = await this.db.query<{
      listing_count: number;
      min_rent: number | null;
      max_rent: number | null;
      verified_count: number;
      sharing: string[] | null;
    }>(
      `SELECT
         count(DISTINCT l.id)::int AS listing_count,
         min(l.monthly_rent)::int AS min_rent,
         max(l.monthly_rent)::int AS max_rent,
         sum(CASE WHEN l.verification_status = 'verified' THEN 1 ELSE 0 END)::int AS verified_count,
         (SELECT array_agg(DISTINCT rt.sharing::text)
            FROM pg_room_types rt
            JOIN listings l2 ON l2.id = rt.listing_id
            JOIN listing_locations ll2 ON ll2.listing_id = l2.id
            JOIN localities loc2 ON loc2.city_id = ll2.city_id
            WHERE loc2.slug = $1 AND l2.status = 'active' AND l2.listing_type = 'pg'
              AND ll2.locality_id = loc2.id) AS sharing
       FROM listings l
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN localities loc ON loc.city_id = ll.city_id
       WHERE loc.slug = $1 AND l.status = 'active' AND l.listing_type = 'pg'
         AND ll.locality_id = loc.id`,
      [slug]
    );
    const row = stats.rows[0];

    const photos = await this.db.query<{ blob_path: string }>(
      `SELECT lp.blob_path
       FROM listing_photos lp
       JOIN listings l ON l.id = lp.listing_id
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN localities loc ON loc.city_id = ll.city_id
       WHERE loc.slug = $1 AND l.status = 'active' AND l.listing_type = 'pg'
         AND ll.locality_id = loc.id AND lp.is_cover = true
       ORDER BY l.created_at DESC
       LIMIT 4`,
      [slug]
    );

    const count = row?.listing_count ?? 0;
    return {
      type: "locality",
      slug,
      name: loc.name_en,
      city_slug: loc.city_slug,
      listing_count: count,
      rent_band: buildBand(row?.min_rent ?? null, row?.max_rent ?? null),
      verified_pct: count > 0 ? Math.round(((row?.verified_count ?? 0) / count) * 100) : null,
      avg_bhk: null,
      sharing: row?.sharing ?? [],
      sample_photos: photos.rows
        .map((r) => this.toPhotoUrl(r.blob_path))
        .filter((u): u is string => Boolean(u))
    };
  }

  private toPhotoUrl(blobPath: string | null): string | null {
    if (!blobPath) return null;
    if (/^https?:\/\//i.test(blobPath)) return blobPath;
    if (!this.photoBase) return blobPath;
    return `${this.photoBase}/${blobPath.replace(/^\/+/, "")}`;
  }
}
