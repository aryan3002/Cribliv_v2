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
    expect(cityCall?.[0]).toContain("loc.slug ILIKE $1");
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

  it.each([
    ["pg", "verified", "active"],
    ["flat_house", "pending", "active"],
    ["flat_house", "verified", "draft"],
    ["flat_house", "verified", "pending_review"],
    ["flat_house", "verified", "rejected"]
  ] as const)(
    "rejects out-of-scope detail %s/%s/%s",
    async (listingType, verificationStatus, status) => {
      (appState as any).listings = new Map([
        [
          "target",
          {
            id: "target",
            ownerUserId: "owner-1",
            listingType,
            title: "Target home",
            city: "lucknow",
            monthlyRent: 15000,
            verificationStatus,
            status,
            createdAt: now
          }
        ]
      ]);

      await expect((service as any).getHome("target")).rejects.toMatchObject({
        response: expect.objectContaining({ code: "home_not_found" })
      });
    }
  );

  it("rejects missing and malformed database listing ids without querying Postgres", async () => {
    const query = vi.fn();
    const dbBacked = new AdminHomesService({ isEnabled: () => true, query } as any, appState);

    await expect((dbBacked as any).getHome("malformed")).rejects.toMatchObject({
      response: expect.objectContaining({ code: "home_not_found" })
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns a complete in-memory detail with scoped data, newest leads, and no seeker phones", async () => {
    const createdAt = now - 5 * 60_000;
    const targetLeads: Array<[string, any]> = Array.from({ length: 11 }, (_, index) => {
      const tenantId = `tenant-${index + 1}`;
      (appState as any).users.set(tenantId, {
        id: tenantId,
        phone: `+919999999${String(index).padStart(3, "0")}`,
        role: "tenant",
        preferred_language: "en",
        full_name: `Seeker ${index + 1}`
      });
      return [
        `lead-${index + 1}`,
        {
          id: `lead-${index + 1}`,
          listingId: "active-home",
          ownerUserId: "owner-1",
          tenantUserId: tenantId,
          contactUnlockId: index === 2 ? "unlock-refunded" : undefined,
          status: ["new", "contacted", "visit_scheduled", "deal_done", "lost"][index % 5],
          accessState: ["free", "locked", "unlocked", "expired"][index % 4],
          calledAt: index % 3 === 0 ? createdAt + index * 1_000 + 300 : null,
          calledBy: index % 3 === 0 ? "team" : null,
          callDeadlineAt: createdAt + index * 1_000 + 3_600_000,
          createdAt: createdAt + index * 1_000,
          statusChangedAt: createdAt + index * 1_000,
          updatedAt: createdAt + index * 1_000
        }
      ];
    });
    targetLeads.push([
      "lead-old-open",
      {
        id: "lead-old-open",
        listingId: "active-home",
        ownerUserId: "owner-1",
        tenantUserId: "tenant-1",
        status: "new",
        accessState: "free",
        calledAt: null,
        calledBy: null,
        callDeadlineAt: null,
        createdAt: now - 31 * 86_400_000,
        statusChangedAt: now - 31 * 86_400_000,
        updatedAt: now - 31 * 86_400_000
      }
    ]);
    (appState as any).leads = new Map(targetLeads);
    (appState as any).unlocks = new Map([
      [
        "unlock-refunded",
        {
          id: "unlock-refunded",
          tenantUserId: "tenant-3",
          listingId: "active-home",
          idempotencyKey: "unlock-refunded",
          ownerResponseStatus: "timeout_refunded",
          unlockStatus: "refunded",
          responseDeadlineAt: now - 1_000
        }
      ]
    ]);
    (appState as any).listings.set("owner-paused", {
      id: "owner-paused",
      ownerUserId: "owner-1",
      listingType: "flat_house",
      title: "Owner Paused",
      city: "lucknow",
      monthlyRent: 18000,
      verificationStatus: "unverified",
      status: "paused",
      createdAt
    });
    (appState as any).listings.set("owner-archived", {
      id: "owner-archived",
      ownerUserId: "owner-1",
      listingType: "flat_house",
      title: "Owner Archived",
      city: "lucknow",
      monthlyRent: 17000,
      verificationStatus: "failed",
      status: "archived",
      createdAt
    });
    (appState as any).verificationAttempts = [
      {
        id: "attempt-old",
        listing_id: "active-home",
        verification_type: "video_liveness",
        result: "pass",
        liveness_score: 91,
        threshold: 85,
        artifact_paths: ["private/old.mp4"],
        submitted_payload: { secret: "omit" },
        provider: "mock",
        user_id: "owner-1",
        created_at: new Date(createdAt).toISOString()
      },
      {
        id: "attempt-new",
        listing_id: "active-home",
        verification_type: "electricity_bill_match",
        result: "pass",
        address_match_score: 96,
        threshold: 85,
        artifact_paths: ["private/new.jpg"],
        submitted_payload: { secret: "omit" },
        provider_payload: { secret: "omit" },
        user_id: "owner-1",
        created_at: new Date(createdAt + 10_000).toISOString()
      },
      {
        id: "attempt-other",
        listing_id: "paused-home",
        verification_type: "video_liveness",
        result: "pass",
        threshold: 85,
        created_at: new Date(createdAt + 20_000).toISOString()
      }
    ];
    (appState as any).adminActions = [
      {
        target_type: "listing",
        target_id: "active-home",
        action: "pause",
        admin_id: "admin-1",
        created_at: new Date(createdAt + 11_000).toISOString()
      },
      {
        target_type: "verification_attempt",
        target_id: "attempt-new",
        action: "approve",
        admin_id: "admin-1",
        created_at: new Date(createdAt + 12_000).toISOString()
      },
      {
        target_type: "lead",
        target_id: "lead-1",
        action: "mark_team_called",
        admin_id: "admin-1",
        created_at: new Date(createdAt + 12_500).toISOString()
      },
      {
        target_type: "verification_attempt",
        target_id: "attempt-other",
        action: "approve",
        admin_id: "admin-1",
        created_at: new Date(createdAt + 13_000).toISOString()
      }
    ];

    const detail = await (service as any).getHome("active-home");

    expect(detail).toMatchObject({
      listing: { id: "active-home", verification_status: "verified" },
      metrics_30d: { views: 0, leads: 11 },
      owner: {
        active_homes: 2,
        paused_homes: 2,
        archived_homes: 2,
        lead_health: expect.objectContaining({
          leads_30d: 11,
          refund_rate_30d: 1
        })
      },
      public_path: "/en/listing/active-home"
    });
    expect(detail.lead_summary.open).toBeGreaterThan(0);
    expect(detail.lead_summary.uncalled).toBeGreaterThan(0);
    expect(detail.lead_summary.refunded).toBe(1);
    expect(detail.recent_leads).toHaveLength(10);
    expect(detail.recent_leads.map((lead: { created_at: string }) => lead.created_at)).toEqual(
      [...detail.recent_leads.map((lead: { created_at: string }) => lead.created_at)]
        .sort()
        .reverse()
    );
    expect(detail.recent_leads.every((lead: object) => !("seeker_phone" in lead))).toBe(true);
    expect(
      detail.verification_attempts.map((attempt: { attempt_id: string }) => attempt.attempt_id)
    ).toEqual(["attempt-new", "attempt-old"]);
    expect(JSON.stringify(detail)).not.toMatch(
      /artifact_paths|submitted_payload|provider_payload|secret/
    );
    expect(detail.activity.map((item: { id: string }) => item.id)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^admin:listing:active-home:/),
        expect.stringMatching(/^admin:verification_attempt:attempt-new:/),
        expect.stringMatching(/^admin:lead:lead-1:/)
      ])
    );
    expect(detail.activity.map((item: { id: string }) => item.id)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^admin:verification_attempt:attempt-other:/)])
    );
    expect(new Set(detail.activity.map((item: { id: string }) => item.id)).size).toBe(
      detail.activity.length
    );
    expect(
      detail.activity.find((item: { id: string }) => item.id === "verification:attempt-new")
        ?.actor_id
    ).toBe("owner-1");
    expect(
      detail.recent_leads.find((lead: { lead_id: string }) => lead.lead_id === "lead-3")
        ?.response_deadline_at
    ).toBe(new Date(createdAt + 2_000 + 3_600_000).toISOString());
  });

  it("maps a complete database detail without sensitive verification payloads", async () => {
    const listingId = "11111111-1111-4111-8111-111111111111";
    database.isEnabled = () => true;
    database.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: listingId,
            title_en: "Database Home",
            title_hi: null,
            description_en: "Verified home",
            description_hi: null,
            status: "active",
            verification_status: "verified",
            monthly_rent: "22000",
            security_deposit: "44000",
            available_from: "2026-08-01",
            furnishing: "fully_furnished",
            bhk: "2",
            bathrooms: "2",
            area_sqft: "1050",
            preferred_tenant: "family",
            whatsapp_available: true,
            amenities: ["parking"],
            rules: { pets: false },
            created_at: "2026-07-01T00:00:00.000Z",
            updated_at: "2026-07-15T00:00:00.000Z",
            last_owner_activity_at: "2026-07-15T01:00:00.000Z",
            address_line1: "Vibhuti Khand",
            landmark: "Near metro",
            pincode: "226010",
            lat: "26.8467",
            lng: "80.9462",
            masked_address: "Gomti Nagar, Lucknow",
            locality_name: "Gomti Nagar",
            city_slug: "lucknow",
            city_name: "Lucknow",
            owner_id: "22222222-2222-4222-8222-222222222222",
            owner_name: "Ramesh Kumar",
            owner_phone: "+919999999901",
            owner_whatsapp_opt_in: true,
            owner_preferred_language: "en",
            owner_role: "owner",
            owner_is_blocked: false,
            owner_member_since: "2026-01-01T00:00:00.000Z",
            owner_last_login_at: new Date(now - 2 * 86_400_000).toISOString(),
            report_count: "2"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            active_homes: "2",
            paused_homes: "1",
            archived_homes: "3",
            leads_30d: "12",
            called_rate_30d: "0.5",
            refund_rate_30d: "0.25",
            median_response_minutes_30d: "42",
            report_count: "0",
            health_avg_response_minutes: "20",
            health_unlocks_60d: "10",
            health_deals_60d: "9",
            health_listings_active: "2",
            health_listings_paused: "1"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "photo-cover",
            blob_path: "homes/cover.jpg",
            is_cover: true,
            sort_order: "0",
            moderation_status: "approved"
          },
          {
            id: "photo-second",
            blob_path: "homes/second.jpg",
            is_cover: false,
            sort_order: "1",
            moderation_status: "pending"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [{ views: "20", leads: "10", open_leads: "4", conversion_rate: "0.5" }]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            new_count: "2",
            contacted_count: "2",
            visit_scheduled_count: "1",
            deal_done_count: "3",
            lost_count: "2",
            free_count: "2",
            locked_count: "3",
            unlocked_count: "4",
            expired_count: "1",
            called: "5",
            uncalled: "4",
            refunded: "2",
            open: "4",
            median_response_minutes: "35"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: Array.from({ length: 10 }, (_, index) => ({
          lead_id: `lead-${index + 1}`,
          seeker_name: `Seeker ${index + 1}`,
          access_state: "locked",
          status: "new",
          called_at: null,
          called_by: null,
          response_deadline_at: null,
          refund_state: "pending",
          created_at: `2026-07-${String(20 - index).padStart(2, "0")}T00:00:00.000Z`
        }))
      })
      .mockResolvedValueOnce({
        rows: [
          {
            attempt_id: "attempt-new",
            kind: "video_liveness",
            result: "pass",
            liveness_score: "96",
            address_match_score: null,
            threshold: "85",
            provider: "mock",
            provider_result_code: "PASS",
            review_reason: null,
            artifact_available: true,
            reviewed_by: "admin-1",
            reviewed_at: "2026-07-20T00:00:00.000Z",
            created_at: "2026-07-20T00:00:00.000Z"
          },
          {
            attempt_id: "attempt-old",
            kind: "electricity_bill_match",
            result: "pass",
            liveness_score: null,
            address_match_score: "90",
            threshold: "85",
            provider: "mock",
            provider_result_code: "PASS",
            review_reason: null,
            artifact_available: false,
            reviewed_by: null,
            reviewed_at: null,
            created_at: "2026-07-19T00:00:00.000Z"
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "admin:decision",
            at: "2026-07-20T01:00:00.000Z",
            kind: "admin",
            label: "approve",
            detail: null,
            actor_id: "admin-1"
          }
        ]
      });

    const detail = await (service as any).getHome(listingId);
    const calls = database.query.mock.calls.map(([sql]) => String(sql));

    expect(detail).toMatchObject({
      listing: {
        monthly_rent: 22000,
        security_deposit: 44000,
        bhk: 2,
        bathrooms: 2,
        area_sqft: 1050
      },
      location: { lat: 26.8467, lng: 80.9462 },
      owner: {
        active_homes: 2,
        paused_homes: 1,
        archived_homes: 3,
        lead_health: {
          health_score: 86,
          health_grade: "B",
          called_rate_30d: 0.5,
          refund_rate_30d: 0.25,
          median_response_minutes_30d: 42
        }
      },
      metrics_30d: { views: 20, leads: 10, open_leads: 4, conversion_rate: 0.5 }
    });
    expect(detail.recent_leads).toHaveLength(10);
    expect(detail.recent_leads.map((lead: { created_at: string }) => lead.created_at)).toEqual(
      [...detail.recent_leads.map((lead: { created_at: string }) => lead.created_at)]
        .sort()
        .reverse()
    );
    expect(
      detail.photos.every(
        (photo: { moderation_status: string }) => photo.moderation_status !== "rejected"
      )
    ).toBe(true);
    expect(detail.photos[0].is_cover).toBe(true);
    expect(
      detail.verification_attempts.map((attempt: { created_at: string }) => attempt.created_at)
    ).toEqual(
      [...detail.verification_attempts.map((attempt: { created_at: string }) => attempt.created_at)]
        .sort()
        .reverse()
    );
    expect(JSON.stringify(detail)).not.toMatch(
      /artifact_paths|submitted_payload|request_payload|response_payload/
    );
    expect(calls[0]).toContain("l.listing_type = 'flat_house'");
    expect(calls[0]).toContain("l.verification_status = 'verified'");
    expect(
      calls.some((sql) => sql.includes("ORDER BY ld.created_at DESC") && sql.includes("LIMIT 10"))
    ).toBe(true);
    expect(
      calls.some((sql) =>
        sql.includes("COALESCE(ld.call_deadline_at, cu.response_deadline_at)::text")
      )
    ).toBe(true);
    expect(calls[1]).toContain("count(cu.id)");
    expect(calls[1]).toContain("cu.created_at >= now() - interval '60 days'");
    expect(calls[1]).toContain("health_listings_active");
    expect(calls[1]).toContain("health_listing_agg AS");
    expect(calls.some((sql) => sql.includes("p.moderation_status <> 'rejected'"))).toBe(true);
    expect(calls.some((sql) => sql.includes("ORDER BY va.created_at DESC"))).toBe(true);
    expect(calls.some((sql) => sql.includes("jsonb_typeof(va.artifact_paths) = 'array'"))).toBe(
      true
    );
    expect(calls.some((sql) => sql.includes("aa.target_type = 'lead'"))).toBe(true);
    expect(calls.some((sql) => sql.includes("LIMIT 100"))).toBe(true);
  });

  it("caps in-memory activity at 100 items using producer-shaped admin actions", async () => {
    (appState as any).adminActions = Array.from({ length: 120 }, (_, index) => ({
      admin_id: "admin-1",
      target_type: "listing",
      target_id: "active-home",
      action: "pause",
      reason: `reason-${index}`,
      created_at: new Date(now + index).toISOString()
    }));

    const detail = await (service as any).getHome("active-home");

    expect(detail.activity).toHaveLength(100);
    expect(new Set(detail.activity.map((item: { id: string }) => item.id)).size).toBe(100);
    expect(detail.activity[0].detail).toBe("reason-119");
  });
});
