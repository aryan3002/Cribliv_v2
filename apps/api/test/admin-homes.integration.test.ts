import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { AppStateService } from "../src/common/app-state.service";
import { DatabaseService } from "../src/common/database.service";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("AdminHomesService (DB)", () => {
  let pool: Pool;
  let database: DatabaseService;
  let service: { listHomes: (params: any) => Promise<any> };
  let ownerId: string;
  let cityAId: number;
  let cityBId: number;
  let cityPageId: number;
  let cityASlug: string;
  let cityBSlug: string;
  let cityPageSlug: string;
  let activeHomeId: string;
  let pausedHomeId: string;
  let archivedHomeId: string;
  let cityBHomeId: string;
  let cityBCalledOnlyHomeId: string;
  let originalDatabaseUrl: string | undefined;
  const listingIds: string[] = [];
  const userIds: string[] = [];

  const suffix = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

  async function createUser(role: "owner" | "tenant", label: string) {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name)
       VALUES ($1, $2, $3)
       RETURNING id::text`,
      [`+919${String(userIds.length + 10).padStart(9, "0")}`, role, `${label} ${suffix}`]
    );
    userIds.push(result.rows[0].id);
    return result.rows[0].id;
  }

  async function createCity(slug: string, name: string) {
    const city = await pool.query<{ id: number }>(
      `INSERT INTO cities (slug, name_en, name_hi, state_en, state_hi)
       VALUES ($1, $2, $3, 'Uttar Pradesh', 'Uttar Pradesh')
       RETURNING id`,
      [slug, name, name]
    );
    await pool.query(
      `INSERT INTO localities (city_id, slug, name_en, name_hi)
       VALUES ($1, $2, $3, $3)`,
      [city.rows[0].id, `locality-${slug}`, `Locality ${name}`]
    );
    return city.rows[0].id;
  }

  async function createHome(input: {
    title: string;
    cityId: number;
    citySlug: string;
    listingType?: "flat_house" | "pg";
    verification?: "unverified" | "pending" | "verified" | "failed";
    status?: "draft" | "pending_review" | "active" | "rejected" | "paused" | "archived";
    monthlyRent: number;
    updatedOffsetMinutes?: number;
  }) {
    const listing = await pool.query<{ id: string }>(
      `INSERT INTO listings (
         owner_user_id, listing_type, title_en, monthly_rent, status, verification_status, updated_at
       )
       VALUES (
         $1::uuid, $2::listing_type, $3, $4, $5::listing_status, $6::verification_status,
         now() - ($7::int * interval '1 minute')
       )
       RETURNING id::text`,
      [
        ownerId,
        input.listingType ?? "flat_house",
        input.title,
        input.monthlyRent,
        input.status ?? "active",
        input.verification ?? "verified",
        input.updatedOffsetMinutes ?? 0
      ]
    );
    const id = listing.rows[0].id;
    listingIds.push(id);
    await pool.query(
      `INSERT INTO listing_locations (listing_id, city_id, locality_id, address_line1)
       SELECT $1::uuid, c.id, l.id, $2
       FROM cities c
       JOIN localities l ON l.city_id = c.id
       WHERE c.id = $3
       LIMIT 1`,
      [id, `${input.title} Address`, input.cityId]
    );
    await pool.query(`UPDATE listings SET city_slug = $2 WHERE id = $1::uuid`, [
      id,
      input.citySlug
    ]);
    return id;
  }

  async function addViews(listingId: string, count: number, ageDays: number) {
    for (let index = 0; index < count; index += 1) {
      await pool.query(
        `INSERT INTO listing_events (listing_id, event_type, created_at)
         VALUES ($1::uuid, 'view', now() - ($2::int * interval '1 day'))`,
        [listingId, ageDays]
      );
    }
  }

  async function addLead(input: {
    listingId: string;
    status: "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";
    accessState: "free" | "locked" | "unlocked" | "expired";
    ageDays: number;
    called?: boolean;
  }) {
    const tenantId = await createUser("tenant", "Homes Tenant");
    await pool.query(
      `INSERT INTO leads (
         listing_id, owner_user_id, tenant_user_id, status, access_state, called_at, created_at
       )
       VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::lead_status, $5,
         CASE WHEN $6::boolean THEN now() ELSE NULL END,
         now() - ($7::int * interval '1 day')
       )`,
      [
        input.listingId,
        ownerId,
        tenantId,
        input.status,
        input.accessState,
        input.called ?? false,
        input.ageDays
      ]
    );
  }

  beforeAll(async () => {
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = TEST_DB;
    pool = new Pool({ connectionString: TEST_DB! });
    database = new DatabaseService();
    const { AdminHomesService } = await import("../src/modules/admin/admin-homes.service");
    service = new AdminHomesService(database, new AppStateService());
    await pool.query("SELECT 1");

    ownerId = await createUser("owner", "Homes Owner");
    cityASlug = `homes-a-${suffix}`;
    cityBSlug = `homes-b-${suffix}`;
    cityPageSlug = `homes-page-${suffix}`;
    cityAId = await createCity(cityASlug, `Homes A ${suffix}`);
    cityBId = await createCity(cityBSlug, `Homes B ${suffix}`);
    cityPageId = await createCity(cityPageSlug, `Homes Page ${suffix}`);

    activeHomeId = await createHome({
      title: "Gomti Active Home",
      cityId: cityAId,
      citySlug: cityASlug,
      monthlyRent: 20000,
      updatedOffsetMinutes: 1
    });
    pausedHomeId = await createHome({
      title: "Gomti Paused Home",
      cityId: cityAId,
      citySlug: cityASlug,
      status: "paused",
      monthlyRent: 10000,
      updatedOffsetMinutes: 2
    });
    archivedHomeId = await createHome({
      title: "Gomti Archived Home",
      cityId: cityAId,
      citySlug: cityASlug,
      status: "archived",
      monthlyRent: 30000,
      updatedOffsetMinutes: 3
    });
    cityBHomeId = await createHome({
      title: "Other City Home",
      cityId: cityBId,
      citySlug: cityBSlug,
      monthlyRent: 18000,
      updatedOffsetMinutes: 1
    });
    cityBCalledOnlyHomeId = await createHome({
      title: "Called Only City Home",
      cityId: cityBId,
      citySlug: cityBSlug,
      status: "paused",
      monthlyRent: 17000,
      updatedOffsetMinutes: 2
    });

    await createHome({
      title: "Verified PG",
      cityId: cityAId,
      citySlug: cityASlug,
      listingType: "pg",
      monthlyRent: 8000
    });
    await createHome({
      title: "Unverified Flat",
      cityId: cityAId,
      citySlug: cityASlug,
      verification: "unverified",
      monthlyRent: 9000
    });
    await createHome({
      title: "Pending Review Flat",
      cityId: cityAId,
      citySlug: cityASlug,
      status: "pending_review",
      monthlyRent: 9000
    });
    await createHome({
      title: "Rejected Flat",
      cityId: cityAId,
      citySlug: cityASlug,
      status: "rejected",
      monthlyRent: 9000
    });

    await pool.query(
      `INSERT INTO listing_photos (listing_id, blob_path, is_cover, sort_order)
       VALUES ($1::uuid, 'homes/active-cover.jpg', true, 0)`,
      [activeHomeId]
    );
    await addViews(activeHomeId, 4, 1);
    await addViews(activeHomeId, 1, 31);
    await addViews(pausedHomeId, 2, 1);
    await addViews(archivedHomeId, 1, 1);
    await addLead({ listingId: activeHomeId, status: "new", accessState: "locked", ageDays: 1 });
    await addLead({
      listingId: activeHomeId,
      status: "contacted",
      accessState: "unlocked",
      ageDays: 2,
      called: true
    });
    await addLead({
      listingId: activeHomeId,
      status: "deal_done",
      accessState: "unlocked",
      ageDays: 3
    });
    await addLead({
      listingId: activeHomeId,
      status: "new",
      accessState: "free",
      ageDays: 31
    });
    await addLead({
      listingId: pausedHomeId,
      status: "visit_scheduled",
      accessState: "free",
      ageDays: 1
    });
    await addLead({
      listingId: archivedHomeId,
      status: "lost",
      accessState: "expired",
      ageDays: 1
    });
    await addLead({
      listingId: cityBHomeId,
      status: "new",
      accessState: "locked",
      ageDays: 1
    });
    await addLead({
      listingId: cityBCalledOnlyHomeId,
      status: "contacted",
      accessState: "unlocked",
      ageDays: 1,
      called: true
    });

    for (let index = 0; index < 26; index += 1) {
      await createHome({
        title: `Page Home ${String(index + 1).padStart(2, "0")}`,
        cityId: cityPageId,
        citySlug: cityPageSlug,
        monthlyRent: 10_000 + index,
        updatedOffsetMinutes: index
      });
    }
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM listing_events WHERE listing_id = ANY($1::uuid[])`, [listingIds]);
    await pool.query(`DELETE FROM leads WHERE listing_id = ANY($1::uuid[])`, [listingIds]);
    await pool.query(`DELETE FROM listings WHERE id = ANY($1::uuid[])`, [listingIds]);
    await pool.query(`DELETE FROM localities WHERE city_id = ANY($1::int[])`, [
      [cityAId, cityBId, cityPageId]
    ]);
    await pool.query(`DELETE FROM cities WHERE id = ANY($1::int[])`, [
      [cityAId, cityBId, cityPageId]
    ]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]);
    await database.onModuleDestroy();
    await pool.end();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }, 60_000);

  it("returns only eligible verified flat_house rows and applies every sort", async () => {
    const expected = {
      leads: [activeHomeId, pausedHomeId, archivedHomeId],
      views: [activeHomeId, pausedHomeId, archivedHomeId],
      conversion: [archivedHomeId, activeHomeId, pausedHomeId],
      updated: [activeHomeId, pausedHomeId, archivedHomeId],
      rent_desc: [archivedHomeId, activeHomeId, pausedHomeId],
      rent_asc: [pausedHomeId, activeHomeId, archivedHomeId]
    } as const;

    for (const [sort, ids] of Object.entries(expected)) {
      const result = await service.listHomes({
        status: "all",
        city: cityASlug,
        sort: sort as keyof typeof expected,
        page: 1,
        page_size: 25
      });
      expect(result.items.map((item) => item.id)).toEqual(ids);
    }
  });

  it("applies status, city, and search filters", async () => {
    const paused = await service.listHomes({
      status: "paused",
      city: cityASlug,
      sort: "updated",
      page: 1,
      page_size: 25
    });
    const city = await service.listHomes({
      status: "active",
      city: cityBSlug,
      sort: "updated",
      page: 1,
      page_size: 25
    });
    const searched = await service.listHomes({
      status: "all",
      city: cityASlug,
      q: "archived",
      sort: "updated",
      page: 1,
      page_size: 25
    });

    expect(paused.items.map((item) => item.id)).toEqual([pausedHomeId]);
    expect(city.items.map((item) => item.id)).toEqual([cityBHomeId]);
    expect(searched.items.map((item) => item.id)).toEqual([archivedHomeId]);
    expect(city.available_cities.map((item) => item.slug)).toEqual(
      expect.arrayContaining([cityASlug, cityBSlug])
    );
    expect(searched.available_cities.map((item) => item.slug)).toEqual([cityASlug]);
  });

  it("paginates at every supported page size and keeps the unpaged total", async () => {
    const firstPage = await service.listHomes({
      status: "active",
      city: cityPageSlug,
      sort: "updated",
      page: 1,
      page_size: 25
    });
    const secondPage = await service.listHomes({
      status: "active",
      city: cityPageSlug,
      sort: "updated",
      page: 2,
      page_size: 25
    });
    const largerPage = await service.listHomes({
      status: "active",
      city: cityPageSlug,
      sort: "updated",
      page: 1,
      page_size: 50
    });
    const largestPage = await service.listHomes({
      status: "active",
      city: cityPageSlug,
      sort: "updated",
      page: 1,
      page_size: 100
    });

    expect(firstPage).toMatchObject({ total: 26, page: 1, page_size: 25 });
    expect(firstPage.items).toHaveLength(25);
    expect(secondPage).toMatchObject({ total: 26, page: 2, page_size: 25 });
    expect(secondPage.items).toHaveLength(1);
    expect(largerPage.items).toHaveLength(26);
    expect(largestPage.items).toHaveLength(26);
  });

  it("returns full-filtered summary values while active_homes ignores only status", async () => {
    const active = await service.listHomes({
      status: "active",
      city: cityASlug,
      sort: "updated",
      page: 1,
      page_size: 25
    });
    const archived = await service.listHomes({
      status: "archived",
      city: cityASlug,
      sort: "updated",
      page: 1,
      page_size: 25
    });

    expect(active.summary).toEqual({
      active_homes: 1,
      views_30d: 4,
      leads_30d: 3,
      needs_attention: 1
    });
    expect(archived.summary).toEqual({
      active_homes: 1,
      views_30d: 1,
      leads_30d: 1,
      needs_attention: 0
    });
  });

  it("keeps called open leads out of needs_attention while uncalled open leads require attention", async () => {
    const calledOnly = await service.listHomes({
      status: "paused",
      city: cityBSlug,
      sort: "updated",
      page: 1,
      page_size: 25
    });
    const uncalled = await service.listHomes({
      status: "active",
      city: cityBSlug,
      sort: "updated",
      page: 1,
      page_size: 25
    });

    expect(calledOnly.items.map((item) => item.id)).toEqual([cityBCalledOnlyHomeId]);
    expect(calledOnly.items[0].open_leads).toBe(1);
    expect(calledOnly.summary.needs_attention).toBe(0);
    expect(uncalled.items.map((item) => item.id)).toEqual([cityBHomeId]);
    expect(uncalled.items[0].open_leads).toBe(1);
    expect(uncalled.summary.needs_attention).toBe(1);
  });

  it("masks owner phones and coerces aggregate values to numbers", async () => {
    const result = await service.listHomes({
      status: "active",
      city: cityASlug,
      sort: "updated",
      page: 1,
      page_size: 25
    });
    const active = result.items.find((item) => item.id === activeHomeId);

    expect(active).toMatchObject({
      views_30d: 4,
      leads_30d: 3,
      open_leads: 3,
      conversion_rate: 0.75
    });
    expect(active!.owner_phone_masked).toMatch(/X/);
    expect(active!.owner_phone_masked).not.toContain("+919");
    expect(typeof active!.views_30d).toBe("number");
    expect(typeof active!.conversion_rate).toBe("number");
    expect(typeof result.summary.views_30d).toBe("number");
  });

  it("returns an EXPLAIN plan for the aggregate and lateral inventory page query", async () => {
    const explain = await pool.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
       WITH base AS (
         SELECT l.id, l.title_en, l.title_hi, l.monthly_rent, l.status, l.updated_at,
                l.owner_user_id, ll.address_line1, c.slug AS city_slug, c.name_en AS city_name,
                loc.name_en AS locality_name, u.full_name AS owner_name, u.phone_e164 AS owner_phone
         FROM listings l
         JOIN users u ON u.id = l.owner_user_id
         LEFT JOIN listing_locations ll ON ll.listing_id = l.id
         LEFT JOIN cities c ON c.id = ll.city_id
         LEFT JOIN localities loc ON loc.id = ll.locality_id
         WHERE l.listing_type = 'flat_house'
           AND l.verification_status = 'verified'
           AND l.status IN ('active', 'paused', 'archived')
           AND c.slug = $1
       ),
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
                )::int AS open_leads
         FROM leads ld
         JOIN base b ON b.id = ld.listing_id
         GROUP BY ld.listing_id
       )
       SELECT b.id::text,
              COALESCE(event_agg.views_30d, 0)::int AS views_30d,
              COALESCE(lead_agg.leads_30d, 0)::int AS leads_30d,
              photo.blob_path,
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
       ORDER BY b.updated_at DESC, b.id DESC
       LIMIT $2 OFFSET $3`,
      [cityASlug, 25, 0]
    );

    expect(explain.rows[0]?.["QUERY PLAN"]).toBeDefined();
    expect(Array.isArray(explain.rows[0]?.["QUERY PLAN"])).toBe(true);
  });
});
