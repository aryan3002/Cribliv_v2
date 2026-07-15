import { Inject, Injectable } from "@nestjs/common";
import type {
  AdminHomeListItem,
  AdminHomeSort,
  AdminHomesListParams,
  AdminHomesListResponse,
  AdminHomeStatusFilter
} from "@cribliv/shared-types";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { toBlobUrl } from "../../common/photo-url";

interface HomeSqlRow {
  id: string;
  title: string;
  city_slug: string | null;
  city_name: string | null;
  locality_name: string | null;
  monthly_rent: number | string;
  owner_id: string;
  owner_name: string | null;
  owner_phone: string | null;
  status: "active" | "paused" | "archived";
  cover_photo_path: string | null;
  views_30d: number | string;
  leads_30d: number | string;
  open_leads: number | string;
  conversion_rate: number | string;
  updated_at: string;
  total: number | string;
}

interface SummarySqlRow {
  total: number | string;
  active_homes: number | string;
  views_30d: number | string;
  leads_30d: number | string;
  needs_attention: number | string;
}

interface CitySqlRow {
  slug: string;
  name: string;
  count: number | string;
}

interface BaseCte {
  sql: string;
  values: unknown[];
}

const eligibleStatuses = new Set(["active", "paused", "archived"]);
const statusSql: Record<Exclude<AdminHomeStatusFilter, "all">, string> = {
  active: "active",
  paused: "paused",
  archived: "archived"
};

function numberValue(value: number | string | null | undefined): number {
  return Number(value ?? 0) || 0;
}

@Injectable()
export class AdminHomesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppStateService) private readonly appState: AppStateService
  ) {}

  async listHomes(params: AdminHomesListParams): Promise<AdminHomesListResponse> {
    if (!this.database.isEnabled()) {
      return this.listHomesInMemory(params);
    }

    const pageBase = this.baseCte(params, {
      includeStatus: true,
      includeCity: true,
      includeSearch: true
    });
    const limitIndex = pageBase.values.length + 1;
    const offsetIndex = limitIndex + 1;
    const pageResult = await this.database.query<HomeSqlRow>(
      `${pageBase.sql},
       event_agg AS (
         SELECT le.listing_id,
                count(*) FILTER (WHERE le.event_type = 'view')::int AS views_30d
         FROM listing_events le
         JOIN base b ON b.id = le.listing_id
         WHERE le.created_at >= now() - interval '30 days'
         GROUP BY le.listing_id
       ),
       lead_agg AS (
         SELECT ld.listing_id,
                count(*) FILTER (WHERE ld.created_at >= now() - interval '30 days')::int AS leads_30d,
                count(*) FILTER (
                  WHERE ld.status IN ('new', 'contacted', 'visit_scheduled')
                    AND ld.access_state <> 'expired'
                )::int AS open_leads,
                count(*) FILTER (
                  WHERE ld.status IN ('new', 'contacted', 'visit_scheduled')
                    AND ld.access_state <> 'expired'
                    AND ld.called_at IS NULL
                )::int AS uncalled_open_leads
         FROM leads ld
         JOIN base b ON b.id = ld.listing_id
         GROUP BY ld.listing_id
       )
       SELECT b.id::text AS id,
              COALESCE(NULLIF(b.title_en, ''), NULLIF(b.title_hi, ''), 'Listing') AS title,
              b.city_slug, b.city_name, b.locality_name,
              b.monthly_rent,
              b.owner_user_id::text AS owner_id,
              b.owner_name, b.owner_phone,
              b.status::text AS status,
              photo.blob_path AS cover_photo_path,
              COALESCE(event_agg.views_30d, 0)::int AS views_30d,
              COALESCE(lead_agg.leads_30d, 0)::int AS leads_30d,
              COALESCE(lead_agg.open_leads, 0)::int AS open_leads,
              CASE
                WHEN COALESCE(event_agg.views_30d, 0) = 0 THEN 0
                ELSE ROUND(
                  COALESCE(lead_agg.leads_30d, 0)::numeric / event_agg.views_30d::numeric,
                  4
                )
              END AS conversion_rate,
              b.updated_at::text AS updated_at,
              count(*) OVER ()::int AS total
       FROM base b
       LEFT JOIN event_agg ON event_agg.listing_id = b.id
       LEFT JOIN lead_agg ON lead_agg.listing_id = b.id
       LEFT JOIN LATERAL (
         SELECT p.blob_path
         FROM listing_photos p
         WHERE p.listing_id = b.id
         ORDER BY p.is_cover DESC, p.sort_order ASC, p.created_at ASC
         LIMIT 1
       ) photo ON true
       ORDER BY ${this.orderBy(params.sort)}
       LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
      [...pageBase.values, params.page_size, (params.page - 1) * params.page_size]
    );

    const summaryBase = this.baseCte(params, {
      includeStatus: false,
      includeCity: true,
      includeSearch: true
    });
    const selectedStatus = this.selectedStatusClause(params.status, "b.status");
    const summaryResult = await this.database.query<SummarySqlRow>(
      `${summaryBase.sql},
       filtered AS (
         SELECT * FROM base b
         ${selectedStatus}
       ),
       event_agg AS (
         SELECT le.listing_id,
                count(*) FILTER (WHERE le.event_type = 'view')::int AS views_30d
         FROM listing_events le
         JOIN filtered f ON f.id = le.listing_id
         WHERE le.created_at >= now() - interval '30 days'
         GROUP BY le.listing_id
       ),
       lead_agg AS (
         SELECT ld.listing_id,
                count(*) FILTER (WHERE ld.created_at >= now() - interval '30 days')::int AS leads_30d,
                count(*) FILTER (
                  WHERE ld.status IN ('new', 'contacted', 'visit_scheduled')
                    AND ld.access_state <> 'expired'
                )::int AS open_leads,
                count(*) FILTER (
                  WHERE ld.status IN ('new', 'contacted', 'visit_scheduled')
                    AND ld.access_state <> 'expired'
                    AND ld.called_at IS NULL
                )::int AS uncalled_open_leads
         FROM leads ld
         JOIN filtered f ON f.id = ld.listing_id
         GROUP BY ld.listing_id
       )
       SELECT
         count(*)::int AS total,
         (SELECT count(*)::int FROM base WHERE status = 'active') AS active_homes,
         COALESCE(sum(COALESCE(event_agg.views_30d, 0)), 0)::int AS views_30d,
         COALESCE(sum(COALESCE(lead_agg.leads_30d, 0)), 0)::int AS leads_30d,
         count(*) FILTER (WHERE COALESCE(lead_agg.uncalled_open_leads, 0) > 0)::int AS needs_attention
       FROM filtered f
       LEFT JOIN event_agg ON event_agg.listing_id = f.id
       LEFT JOIN lead_agg ON lead_agg.listing_id = f.id`,
      summaryBase.values
    );

    const cityBase = this.baseCte(params, {
      includeStatus: true,
      includeCity: false,
      includeSearch: true
    });
    const citiesResult = await this.database.query<CitySqlRow>(
      `${cityBase.sql}
       SELECT city_slug AS slug, city_name AS name, count(*)::int AS count
       FROM base
       WHERE city_slug IS NOT NULL
       GROUP BY city_slug, city_name
       ORDER BY city_name ASC, city_slug ASC`,
      cityBase.values
    );

    const summary = summaryResult.rows[0];
    return {
      items: pageResult.rows.map((row) => this.mapSqlRow(row)),
      total: numberValue(summary?.total),
      page: params.page,
      page_size: params.page_size,
      filters: {
        status: params.status,
        city: params.city ?? null,
        q: params.q ?? null,
        sort: params.sort
      },
      available_cities: citiesResult.rows.map((city) => ({
        slug: city.slug,
        name: city.name,
        count: numberValue(city.count)
      })),
      summary: {
        active_homes: numberValue(summary?.active_homes),
        views_30d: numberValue(summary?.views_30d),
        leads_30d: numberValue(summary?.leads_30d),
        needs_attention: numberValue(summary?.needs_attention)
      }
    };
  }

  private baseCte(
    params: AdminHomesListParams,
    options: { includeStatus: boolean; includeCity: boolean; includeSearch: boolean }
  ): BaseCte {
    const values: unknown[] = [];
    const where = [
      "l.listing_type = 'flat_house'",
      "l.verification_status = 'verified'",
      "l.status IN ('active', 'paused', 'archived')"
    ];

    if (options.includeStatus && params.status !== "all") {
      where.push(`l.status = '${statusSql[params.status]}'`);
    }
    if (options.includeCity && params.city) {
      values.push(params.city);
      where.push(`c.slug = $${values.length}`);
    }
    if (options.includeSearch && params.q) {
      values.push(`%${params.q}%`);
      const index = values.length;
      where.push(`(
        l.title_en ILIKE $${index}
        OR l.title_hi ILIKE $${index}
        OR l.id::text ILIKE $${index}
        OR u.full_name ILIKE $${index}
        OR u.phone_e164 ILIKE $${index}
        OR ll.address_line1 ILIKE $${index}
        OR c.slug ILIKE $${index}
        OR c.name_en ILIKE $${index}
        OR loc.name_en ILIKE $${index}
      )`);
    }

    return {
      sql: `WITH base AS (
        SELECT l.id, l.title_en, l.title_hi, l.monthly_rent, l.status, l.updated_at,
               l.owner_user_id, ll.address_line1, c.slug AS city_slug, c.name_en AS city_name,
               loc.name_en AS locality_name, u.full_name AS owner_name, u.phone_e164 AS owner_phone
        FROM listings l
        JOIN users u ON u.id = l.owner_user_id
        LEFT JOIN listing_locations ll ON ll.listing_id = l.id
        LEFT JOIN cities c ON c.id = ll.city_id
        LEFT JOIN localities loc ON loc.id = ll.locality_id
        WHERE ${where.join("\n          AND ")}
      )`,
      values
    };
  }

  private selectedStatusClause(status: AdminHomeStatusFilter, column: string): string {
    if (status === "all") return "";
    return `WHERE ${column} = '${statusSql[status]}'`;
  }

  private orderBy(sort: AdminHomeSort): string {
    const fallback = "b.updated_at DESC, b.id DESC";
    switch (sort) {
      case "views":
        return `COALESCE(event_agg.views_30d, 0) DESC, ${fallback}`;
      case "conversion":
        return `CASE
                  WHEN COALESCE(event_agg.views_30d, 0) = 0 THEN 0
                  ELSE COALESCE(lead_agg.leads_30d, 0)::numeric / event_agg.views_30d::numeric
                END DESC, ${fallback}`;
      case "updated":
        return fallback;
      case "rent_desc":
        return `b.monthly_rent DESC, ${fallback}`;
      case "rent_asc":
        return `b.monthly_rent ASC, ${fallback}`;
      case "leads":
      default:
        return `COALESCE(lead_agg.leads_30d, 0) DESC, ${fallback}`;
    }
  }

  private mapSqlRow(row: HomeSqlRow): AdminHomeListItem {
    return {
      id: row.id,
      title: row.title,
      city_slug: row.city_slug,
      city_name: row.city_name,
      locality_name: row.locality_name,
      monthly_rent: numberValue(row.monthly_rent),
      owner_id: row.owner_id,
      owner_name: row.owner_name,
      owner_phone_masked: this.maskPhone(row.owner_phone),
      status: row.status,
      cover_photo_url: toBlobUrl(row.cover_photo_path),
      views_30d: numberValue(row.views_30d),
      leads_30d: numberValue(row.leads_30d),
      open_leads: numberValue(row.open_leads),
      conversion_rate: numberValue(row.conversion_rate),
      updated_at: row.updated_at,
      public_path: `/en/listing/${row.id}`
    };
  }

  private listHomesInMemory(params: AdminHomesListParams): AdminHomesListResponse {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1_000;
    const rows = [...this.appState.listings.values()]
      .filter(
        (listing) =>
          listing.listingType === "flat_house" &&
          listing.verificationStatus === "verified" &&
          eligibleStatuses.has(listing.status)
      )
      .map((listing) => {
        const owner = this.appState.users.get(listing.ownerUserId);
        const listingLeads = [...this.appState.leads.values()].filter(
          (lead) => lead.listingId === listing.id
        );
        const views_30d = 0;
        const leads_30d = listingLeads.filter((lead) => lead.createdAt >= cutoff).length;
        const openLeads = listingLeads.filter(
          (lead) =>
            ["new", "contacted", "visit_scheduled"].includes(lead.status) &&
            lead.accessState !== "expired"
        );
        const open_leads = openLeads.length;
        const uncalled_open_leads = openLeads.filter((lead) => lead.calledAt == null).length;
        const updatedAt = this.inMemoryUpdatedAt(listing);

        return {
          id: listing.id,
          title: listing.title,
          city_slug: listing.city || null,
          city_name: listing.city || null,
          locality_name: listing.locality ?? null,
          monthly_rent: listing.monthlyRent,
          owner_id: listing.ownerUserId,
          owner_name: owner?.full_name ?? null,
          owner_phone_masked: this.maskPhone(owner?.phone),
          status: listing.status as AdminHomeListItem["status"],
          cover_photo_url: null,
          views_30d,
          leads_30d,
          open_leads,
          uncalled_open_leads,
          conversion_rate: this.ratio(leads_30d, views_30d),
          updated_at: new Date(updatedAt).toISOString(),
          public_path: `/en/listing/${listing.id}`,
          search: [
            listing.title,
            listing.id,
            owner?.full_name,
            owner?.phone,
            listing.locality,
            listing.city
          ]
            .filter((value): value is string => Boolean(value))
            .join(" ")
            .toLowerCase()
        };
      });

    const matchesSearch = (row: (typeof rows)[number]) =>
      !params.q || row.search.includes(params.q.toLowerCase());
    const matchesCity = (row: (typeof rows)[number]) =>
      !params.city || row.city_slug === params.city;
    const matchesStatus = (row: (typeof rows)[number]) =>
      params.status === "all" || row.status === params.status;

    const summaryRows = rows.filter((row) => matchesCity(row) && matchesSearch(row));
    const filteredRows = summaryRows.filter(matchesStatus);
    const availableCityRows = rows.filter((row) => matchesStatus(row) && matchesSearch(row));
    const sortedRows = [...filteredRows].sort((left, right) =>
      this.compareRows(left, right, params.sort)
    );
    const offset = (params.page - 1) * params.page_size;

    const availableCities = new Map<string, { slug: string; name: string; count: number }>();
    for (const row of availableCityRows) {
      if (!row.city_slug) continue;
      const existing = availableCities.get(row.city_slug);
      if (existing) existing.count += 1;
      else {
        availableCities.set(row.city_slug, {
          slug: row.city_slug,
          name: row.city_name ?? row.city_slug,
          count: 1
        });
      }
    }

    return {
      items: sortedRows
        .slice(offset, offset + params.page_size)
        .map(({ search: _search, uncalled_open_leads: _uncalledOpenLeads, ...row }) => row),
      total: filteredRows.length,
      page: params.page,
      page_size: params.page_size,
      filters: {
        status: params.status,
        city: params.city ?? null,
        q: params.q ?? null,
        sort: params.sort
      },
      available_cities: [...availableCities.values()].sort(
        (left, right) => left.name.localeCompare(right.name) || left.slug.localeCompare(right.slug)
      ),
      summary: {
        active_homes: summaryRows.filter((row) => row.status === "active").length,
        views_30d: filteredRows.reduce((total, row) => total + row.views_30d, 0),
        leads_30d: filteredRows.reduce((total, row) => total + row.leads_30d, 0),
        needs_attention: filteredRows.filter((row) => row.uncalled_open_leads > 0).length
      }
    };
  }

  private compareRows(
    left: AdminHomeListItem & { search: string },
    right: AdminHomeListItem & { search: string },
    sort: AdminHomeSort
  ): number {
    const fallback =
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime() ||
      right.id.localeCompare(left.id);
    switch (sort) {
      case "views":
        return right.views_30d - left.views_30d || fallback;
      case "conversion":
        return right.conversion_rate - left.conversion_rate || fallback;
      case "updated":
        return fallback;
      case "rent_desc":
        return right.monthly_rent - left.monthly_rent || fallback;
      case "rent_asc":
        return left.monthly_rent - right.monthly_rent || fallback;
      case "leads":
      default:
        return right.leads_30d - left.leads_30d || fallback;
    }
  }

  private inMemoryUpdatedAt(listing: { createdAt: number }): number {
    const updatedAt = (listing as { updatedAt?: number }).updatedAt;
    return typeof updatedAt === "number" ? updatedAt : listing.createdAt;
  }

  private maskPhone(phone?: string | null): string | null {
    if (!phone) return null;
    if (phone.length <= 4) return "X".repeat(phone.length);
    return `${"X".repeat(phone.length - 4)}${phone.slice(-4)}`;
  }

  private ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10_000) / 10_000;
  }
}
