import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import { AdminHomesService } from "../admin-homes.service";

const now = Date.now();

const expectedInMemoryOrderBySort = {
  leads: ["active-home", "paused-home", "archived-home"],
  views: ["active-home", "paused-home", "archived-home"],
  conversion: ["active-home", "paused-home", "archived-home"],
  updated: ["active-home", "paused-home", "archived-home"],
  rent_desc: ["archived-home", "active-home", "paused-home"],
  rent_asc: ["paused-home", "active-home", "archived-home"]
} as const;

function installFixtures(appState: AppStateService) {
  (appState as any).users = new Map([
    [
      "owner-1",
      {
        id: "owner-1",
        phone: "+919999999901",
        role: "owner",
        preferred_language: "en",
        full_name: "Ramesh Kumar"
      }
    ]
  ]);
  (appState as any).listings = new Map([
    [
      "active-home",
      {
        id: "active-home",
        ownerUserId: "owner-1",
        listingType: "flat_house",
        title: "Gomti View Residence",
        city: "lucknow",
        locality: "gomti-nagar",
        monthlyRent: 20000,
        verificationStatus: "verified",
        status: "active",
        createdAt: now - 1_000,
        updatedAt: now - 1_000
      }
    ],
    [
      "paused-home",
      {
        id: "paused-home",
        ownerUserId: "owner-1",
        listingType: "flat_house",
        title: "Hazratganj Heights",
        city: "lucknow",
        locality: "hazratganj",
        monthlyRent: 10000,
        verificationStatus: "verified",
        status: "paused",
        createdAt: now - 2_000,
        updatedAt: now - 2_000
      }
    ],
    [
      "archived-home",
      {
        id: "archived-home",
        ownerUserId: "owner-1",
        listingType: "flat_house",
        title: "Aliganj Villa",
        city: "lucknow",
        locality: "aliganj",
        monthlyRent: 30000,
        verificationStatus: "verified",
        status: "archived",
        createdAt: now - 3_000,
        updatedAt: now - 3_000
      }
    ],
    [
      "pg-home",
      {
        id: "pg-home",
        ownerUserId: "owner-1",
        listingType: "pg",
        title: "Verified PG",
        city: "lucknow",
        monthlyRent: 8000,
        verificationStatus: "verified",
        status: "active",
        createdAt: now
      }
    ],
    [
      "unverified-home",
      {
        id: "unverified-home",
        ownerUserId: "owner-1",
        listingType: "flat_house",
        title: "Unverified Home",
        city: "lucknow",
        monthlyRent: 9000,
        verificationStatus: "unverified",
        status: "active",
        createdAt: now
      }
    ],
    [
      "pending-home",
      {
        id: "pending-home",
        ownerUserId: "owner-1",
        listingType: "flat_house",
        title: "Pending Home",
        city: "lucknow",
        monthlyRent: 9000,
        verificationStatus: "verified",
        status: "pending_review",
        createdAt: now
      }
    ]
  ]);
  (appState as any).leads = new Map();
}

function installThirtyEligibleHomes(appState: AppStateService) {
  const homes = [
    ["home-01", 10001, 1],
    ["home-02", 10002, 2],
    ["home-03", 10003, 3],
    ["home-04", 10004, 4],
    ["home-05", 10005, 5],
    ["home-06", 10006, 6],
    ["home-07", 10007, 7],
    ["home-08", 10008, 8],
    ["home-09", 10009, 9],
    ["home-10", 10010, 10],
    ["home-11", 10011, 11],
    ["home-12", 10012, 12],
    ["home-13", 10013, 13],
    ["home-14", 10014, 14],
    ["home-15", 10015, 15],
    ["home-16", 10016, 16],
    ["home-17", 10017, 17],
    ["home-18", 10018, 18],
    ["home-19", 10019, 19],
    ["home-20", 10020, 20],
    ["home-21", 10021, 21],
    ["home-22", 10022, 22],
    ["home-23", 10023, 23],
    ["home-24", 10024, 24],
    ["home-25", 10025, 25],
    ["home-26", 10026, 26],
    ["home-27", 10027, 27],
    ["home-28", 10028, 28],
    ["home-29", 10029, 29],
    ["home-30", 10030, 30]
  ] as const;

  (appState as any).listings = new Map(
    homes.map(([id, monthlyRent, offset]) => [
      id,
      {
        id,
        ownerUserId: "owner-1",
        listingType: "flat_house",
        title: `Home ${id}`,
        city: "lucknow",
        locality: "gomti-nagar",
        monthlyRent,
        verificationStatus: "verified",
        status: "active",
        createdAt: now - offset * 1_000,
        updatedAt: now - offset * 1_000
      }
    ])
  );
  (appState as any).leads = new Map();
}

describe("AdminHomesService", () => {
  let database: { isEnabled: () => boolean; query: ReturnType<typeof vi.fn> };
  let appState: AppStateService;
  let service: AdminHomesService;

  beforeEach(() => {
    database = { isEnabled: () => false, query: vi.fn() };
    appState = new AppStateService();
    installFixtures(appState);
    service = new AdminHomesService(database as any, appState);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists only verified flat_house homes in active/paused/archived states", async () => {
    const result = await service.listHomes({
      status: "all",
      sort: "leads",
      page: 1,
      page_size: 25
    });

    expect(result.items.map((row) => row.id)).toEqual([
      "active-home",
      "paused-home",
      "archived-home"
    ]);
    expect(result.items.every((row) => row.public_path === `/en/listing/${row.id}`)).toBe(true);
  });

  it("applies city, search, paging, and deterministic fallback metrics", async () => {
    const result = await service.listHomes({
      status: "active",
      city: "lucknow",
      q: "gomti",
      sort: "updated",
      page: 1,
      page_size: 25
    });

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      city_slug: "lucknow",
      views_30d: 0,
      leads_30d: 0,
      conversion_rate: 0
    });
  });

  it("searches in-memory title, id, owner name, owner phone, locality, and city", async () => {
    for (const q of ["gomti", "active-home", "ramesh", "9999901", "gomti-nagar", "lucknow"]) {
      const result = await service.listHomes({
        status: "all",
        q,
        sort: "updated",
        page: 1,
        page_size: 25
      });
      expect(result.items.map((row) => row.id)).toContain("active-home");
    }
  });

  it("masks inventory owner phones on the server", async () => {
    const result = await service.listHomes({
      status: "active",
      sort: "updated",
      page: 1,
      page_size: 25
    });

    expect(result.items[0].owner_phone_masked).toMatch(/X/);
    expect(result.items[0].owner_phone_masked).not.toContain("+919999999901");
  });

  it.each(["leads", "views", "conversion", "updated", "rent_desc", "rent_asc"] as const)(
    "applies deterministic in-memory %s sorting",
    async (sort) => {
      const result = await service.listHomes({
        status: "all",
        sort,
        page: 1,
        page_size: 25
      });

      expect(result.items).toHaveLength(3);
      expect(result.items.map((row) => row.id)).toEqual(expectedInMemoryOrderBySort[sort]);
    }
  );

  it("derives current and open lead metrics in memory without an event store", async () => {
    (appState as any).leads = new Map([
      [
        "active-new",
        {
          id: "active-new",
          listingId: "active-home",
          ownerUserId: "owner-1",
          tenantUserId: "tenant-1",
          status: "new",
          accessState: "locked",
          createdAt: now - 86_400_000,
          statusChangedAt: now,
          updatedAt: now
        }
      ],
      [
        "active-deal",
        {
          id: "active-deal",
          listingId: "active-home",
          ownerUserId: "owner-1",
          tenantUserId: "tenant-2",
          status: "deal_done",
          accessState: "unlocked",
          createdAt: now - 86_400_000,
          statusChangedAt: now,
          updatedAt: now
        }
      ],
      [
        "active-old",
        {
          id: "active-old",
          listingId: "active-home",
          ownerUserId: "owner-1",
          tenantUserId: "tenant-3",
          status: "contacted",
          accessState: "free",
          createdAt: now - 31 * 86_400_000,
          statusChangedAt: now,
          updatedAt: now
        }
      ],
      [
        "active-expired",
        {
          id: "active-expired",
          listingId: "active-home",
          ownerUserId: "owner-1",
          tenantUserId: "tenant-4",
          status: "visit_scheduled",
          accessState: "expired",
          createdAt: now - 86_400_000,
          statusChangedAt: now,
          updatedAt: now
        }
      ]
    ]);

    const result = await service.listHomes({
      status: "active",
      sort: "updated",
      page: 1,
      page_size: 25
    });

    expect(result.items[0]).toMatchObject({
      views_30d: 0,
      leads_30d: 3,
      open_leads: 2,
      conversion_rate: 0
    });
  });

  it("counts only uncalled open leads as needing attention in memory", async () => {
    (appState as any).leads = new Map([
      [
        "active-called",
        {
          id: "active-called",
          listingId: "active-home",
          ownerUserId: "owner-1",
          tenantUserId: "tenant-1",
          status: "contacted",
          accessState: "unlocked",
          calledAt: now,
          createdAt: now - 86_400_000,
          statusChangedAt: now,
          updatedAt: now
        }
      ]
    ]);

    const calledOnly = await service.listHomes({
      status: "active",
      sort: "updated",
      page: 1,
      page_size: 25
    });
    expect(calledOnly.items[0].open_leads).toBe(1);
    expect(calledOnly.summary.needs_attention).toBe(0);

    (appState as any).leads.set("active-uncalled", {
      id: "active-uncalled",
      listingId: "active-home",
      ownerUserId: "owner-1",
      tenantUserId: "tenant-2",
      status: "new",
      accessState: "locked",
      createdAt: now - 86_400_000,
      statusChangedAt: now,
      updatedAt: now
    });

    const withUncalled = await service.listHomes({
      status: "active",
      sort: "updated",
      page: 1,
      page_size: 25
    });
    expect(withUncalled.items[0].open_leads).toBe(2);
    expect(withUncalled.summary.needs_attention).toBe(1);
  });

  it("keeps city facets scoped by status/search but independent of current city", async () => {
    (appState as any).listings.set("delhi-active-home", {
      id: "delhi-active-home",
      ownerUserId: "owner-1",
      listingType: "flat_house",
      title: "Gomti Delhi Heights",
      city: "delhi",
      locality: "saket",
      monthlyRent: 18000,
      verificationStatus: "verified",
      status: "active",
      createdAt: now - 4_000,
      updatedAt: now - 4_000
    });
    (appState as any).listings.set("lucknow-paused-home", {
      id: "lucknow-paused-home",
      ownerUserId: "owner-1",
      listingType: "flat_house",
      title: "Gomti Paused Home",
      city: "lucknow",
      locality: "gomti-nagar",
      monthlyRent: 18000,
      verificationStatus: "verified",
      status: "paused",
      createdAt: now - 5_000,
      updatedAt: now - 5_000
    });

    const result = await service.listHomes({
      status: "active",
      city: "lucknow",
      q: "gomti",
      sort: "updated",
      page: 1,
      page_size: 25
    });

    expect(result.items.map((item) => item.id)).toEqual(["active-home"]);
    expect(result.available_cities).toEqual([
      { slug: "delhi", name: "delhi", count: 1 },
      { slug: "lucknow", name: "lucknow", count: 1 }
    ]);
  });

  it("paginates the in-memory inventory and reports the unpaged total", async () => {
    installThirtyEligibleHomes(appState);
    const result = await service.listHomes({
      status: "all",
      sort: "updated",
      page: 2,
      page_size: 25
    });

    expect(result.total).toBe(30);
    expect(result.items).toHaveLength(5);
    expect(result.page).toBe(2);
    expect(result.page_size).toBe(25);
  });

  it("uses the summary total when an out-of-range database page is empty", async () => {
    database.isEnabled = () => true;
    database.query.mockImplementation((sql: string) => {
      if (sql.includes("count(*) OVER ()")) return Promise.resolve({ rows: [] });
      if (sql.includes("active_homes")) {
        return Promise.resolve({
          rows: [
            {
              total: "31",
              active_homes: "31",
              views_30d: "0",
              leads_30d: "0",
              needs_attention: "0"
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await service.listHomes({
      status: "active",
      sort: "updated",
      page: 3,
      page_size: 25
    });

    expect(result.items).toEqual([]);
    expect(result.total).toBe(31);
    expect(database.query).toHaveBeenCalledTimes(3);
  });

  it("uses a separate uncalled-open aggregate for database attention summaries", async () => {
    database.isEnabled = () => true;
    database.query.mockImplementation((sql: string) => {
      if (sql.includes("count(*) OVER ()")) {
        return Promise.resolve({
          rows: [
            {
              id: "db-home",
              title: "Database Home",
              city_slug: "lucknow",
              city_name: "Lucknow",
              locality_name: "Gomti Nagar",
              monthly_rent: "22000",
              owner_id: "owner-1",
              owner_name: "Ramesh Kumar",
              owner_phone: "+919999999901",
              status: "active",
              cover_photo_path: null,
              views_30d: "1",
              leads_30d: "1",
              open_leads: "1",
              conversion_rate: "1",
              updated_at: "2026-07-15T00:00:00.000Z",
              total: "1"
            }
          ]
        });
      }
      if (sql.includes("active_homes")) {
        return Promise.resolve({
          rows: [
            {
              total: "1",
              active_homes: "1",
              views_30d: "1",
              leads_30d: "1",
              needs_attention: "0"
            }
          ]
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await service.listHomes({
      status: "active",
      sort: "updated",
      page: 1,
      page_size: 25
    });
    const summaryCall = database.query.mock.calls.find(([sql]) =>
      String(sql).includes("active_homes")
    );

    expect(result.items[0].open_leads).toBe(1);
    expect(result.summary.needs_attention).toBe(0);
    expect(summaryCall?.[0]).toContain("ld.called_at IS NULL");
  });

  it("builds database city facets with status/search but without current-city filter", async () => {
    database.isEnabled = () => true;
    database.query.mockImplementation((sql: string) => {
      if (sql.includes("count(*) OVER ()")) return Promise.resolve({ rows: [] });
      if (sql.includes("active_homes")) {
        return Promise.resolve({
          rows: [
            {
              total: "0",
              active_homes: "0",
              views_30d: "0",
              leads_30d: "0",
              needs_attention: "0"
            }
          ]
        });
      }
      return Promise.resolve({
        rows: [
          { slug: "delhi", name: "Delhi", count: "1" },
          { slug: "lucknow", name: "Lucknow", count: "3" }
        ]
      });
    });

    const result = await service.listHomes({
      status: "active",
      city: "lucknow",
      q: "gomti",
      sort: "updated",
      page: 3,
      page_size: 25
    });
    const cityCall = database.query.mock.calls.find(([sql]) =>
      String(sql).includes("SELECT city_slug AS slug")
    );

    expect(result.available_cities).toEqual([
      { slug: "delhi", name: "Delhi", count: 1 },
      { slug: "lucknow", name: "Lucknow", count: 3 }
    ]);
    expect(cityCall?.[0]).toContain("l.status = 'active'");
    expect(cityCall?.[0]).toContain("ILIKE $1");
    expect(cityCall?.[0]).not.toContain("c.slug =");
    expect(cityCall?.[1]).toEqual(["%gomti%"]);
  });

  it("uses set-based database rows, bound pagination, numeric coercion, and blob URLs", async () => {
    vi.stubEnv("PHOTO_PUBLIC_BASE_URL", "https://photos.example.test/listing-photos");
    database.isEnabled = () => true;
    database.query.mockImplementation((sql: string) => {
      if (sql.includes("count(*) OVER ()")) {
        return Promise.resolve({
          rows: [
            {
              id: "db-home",
              title: "Database Home",
              city_slug: "lucknow",
              city_name: "Lucknow",
              locality_name: "Gomti Nagar",
              monthly_rent: "22000",
              owner_id: "owner-1",
              owner_name: "Ramesh Kumar",
              owner_phone: "+919999999901",
              status: "active",
              cover_photo_path: "homes/db-home.jpg",
              views_30d: "12",
              leads_30d: "3",
              open_leads: "2",
              conversion_rate: "0.25",
              updated_at: "2026-07-15T00:00:00.000Z",
              total: "1"
            }
          ]
        });
      }
      if (sql.includes("active_homes")) {
        return Promise.resolve({
          rows: [
            {
              total: "1",
              active_homes: "1",
              views_30d: "12",
              leads_30d: "3",
              needs_attention: "1"
            }
          ]
        });
      }
      return Promise.resolve({ rows: [{ slug: "lucknow", name: "Lucknow", count: "1" }] });
    });

    const result = await service.listHomes({
      status: "active",
      sort: "leads",
      page: 1,
      page_size: 25
    });

    const mainCall = database.query.mock.calls.find(([sql]) =>
      String(sql).includes("count(*) OVER ()")
    );
    expect(mainCall).toBeDefined();
    expect(mainCall![0]).toContain("l.listing_type = 'flat_house'");
    expect(mainCall![0]).toContain("l.verification_status = 'verified'");
    expect(mainCall![0]).toMatch(/LIMIT \$\d+ OFFSET \$\d+/);
    expect(mainCall![1]).toEqual(expect.arrayContaining([25, 0]));
    expect(result.items[0]).toMatchObject({
      monthly_rent: 22000,
      views_30d: 12,
      leads_30d: 3,
      open_leads: 2,
      conversion_rate: 0.25,
      cover_photo_url: "https://photos.example.test/listing-photos/homes/db-home.jpg"
    });
    expect(result.total).toBe(1);
    expect(result.summary).toEqual({
      active_homes: 1,
      views_30d: 12,
      leads_30d: 3,
      needs_attention: 1
    });
  });
});
