import { describe, it, expect, vi } from "vitest";
import { PgListingService } from "../services/pg-listing.service";
import { AppStateService } from "../../../common/app-state.service";

/**
 * DB-path deps: a fake transaction client (captures the SQL PgListingService
 * runs) + a pool whose reads (users) are stubbed. Post-split PgListingService
 * owns its write end-to-end: it writes the PG-owned head (pg_listings) and
 * projects a 1:1 row into the shared listings read-model — no OwnerService.
 */
function makeDbDeps() {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (/INSERT INTO listings/i.test(sql)) {
        return { rows: [{ id: "listing-1", status: "draft" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn()
  };
  const db = {
    isEnabled: () => true,
    getClient: vi.fn(async () => client),
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (/phone_e164/i.test(sql)) {
        return { rows: [{ phone_e164: "+919999999999", whatsapp_opt_in: true }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    })
  } as any;
  const properties = {
    getActiveProperty: vi.fn(async () => ({
      id: "prop-1",
      operator_id: "op-1",
      city_id: 1,
      locality_id: null,
      lat: null,
      lng: null,
      is_primary: true
    }))
  };
  const appState = new AppStateService();
  return { db, client, properties, appState };
}

function makeMemDeps() {
  const db = { isEnabled: () => false, query: vi.fn() } as any;
  const properties = {
    getActiveProperty: vi.fn(async () => ({
      id: "prop-1",
      operator_id: "op-1",
      city_id: 1,
      locality_id: null,
      lat: null,
      lng: null,
      is_primary: true
    }))
  };
  const appState = new AppStateService();
  return { db, properties, appState };
}

const ONE_ROOM = [
  {
    sharing: "double",
    ac: true,
    bathroom_kind: "attached_western",
    furnishing: "semi_furnished",
    monthly_rent_paise: 1200000,
    vacancy_count: 4
  }
];

describe("PgListingService", () => {
  describe("createDraft() — PG-owned head + projection", () => {
    it("writes pg_listings head + projects into listings with the SAME id, in ONE tx", async () => {
      const { db, client, properties, appState } = makeDbDeps();
      const svc = new PgListingService(db, appState, properties as any);

      const result = await svc.createDraft("op-1", "prop-1", {
        property: { display_name: "Sunrise PG", city_slug: "delhi" },
        pg_details: { total_beds: 10 } as any,
        room_types: ONE_ROOM as any
      });

      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);

      const calls = client.query.mock.calls.map(
        (c: unknown[]) => [String(c[0]), c[1] as unknown[]] as [string, unknown[]]
      );
      const sqls = calls.map((c) => c[0]);
      expect(sqls.some((s) => /BEGIN/.test(s))).toBe(true);
      expect(sqls.some((s) => /COMMIT/.test(s))).toBe(true);
      expect(db.getClient).toHaveBeenCalledOnce();

      const headInsert = calls.find((c) => /INSERT INTO pg_listings/i.test(c[0]));
      const projInsert = calls.find((c) => /INSERT INTO listings/i.test(c[0]));
      expect(headInsert).toBeTruthy();
      expect(projInsert).toBeTruthy();

      // 1:1 — the PG head id and the projected listings id are identical.
      expect(headInsert![1][0]).toBe(result.id);
      expect(projInsert![1][0]).toBe(result.id);
      // both stamp the pg_property_id FK
      expect(headInsert![1]).toContain("prop-1");
      expect(projInsert![1]).toContain("prop-1");

      // detail tables + projected location all on the same client
      expect(sqls.some((s) => /INSERT INTO pg_details/i.test(s))).toBe(true);
      expect(sqls.some((s) => /INSERT INTO pg_room_types/i.test(s))).toBe(true);
      expect(sqls.some((s) => /INSERT INTO listing_locations/i.test(s))).toBe(true);

      // Dependency order (FK pg_details/pg_room_types -> pg_listings, migration
      // 0033): the aggregate ROOT must be written before its children, else the
      // detail inserts FK-violate. Guards against reintroducing the publish bug.
      const idxHead = sqls.findIndex((s) => /INSERT INTO pg_listings/i.test(s));
      const idxDetails = sqls.findIndex((s) => /INSERT INTO pg_details/i.test(s));
      const idxRooms = sqls.findIndex((s) => /INSERT INTO pg_room_types/i.test(s));
      expect(idxHead).toBeGreaterThanOrEqual(0);
      expect(idxHead).toBeLessThan(idxDetails);
      expect(idxHead).toBeLessThan(idxRooms);
    });

    it("submits for review: initialStatus flows into both head and projection", async () => {
      const { db, client, properties, appState } = makeDbDeps();
      const svc = new PgListingService(db, appState, properties as any);

      const result = await svc.createDraft(
        "op-1",
        "prop-1",
        {
          property: { display_name: "Sunrise PG", city_slug: "delhi" },
          pg_details: { total_beds: 10 } as any,
          room_types: ONE_ROOM as any
        },
        "pending_review"
      );

      expect(result.status).toBe("pending_review");
      const calls = client.query.mock.calls.map(
        (c: unknown[]) => [String(c[0]), c[1] as unknown[]] as [string, unknown[]]
      );
      const head = calls.find((c) => /INSERT INTO pg_listings/i.test(c[0]));
      const proj = calls.find((c) => /INSERT INTO listings/i.test(c[0]));
      expect(head![1]).toContain("pending_review");
      expect(proj![1]).toContain("pending_review");
    });

    it("rolls back the transaction when a write fails", async () => {
      const { db, client, properties, appState } = makeDbDeps();
      client.query.mockImplementation(async (sql: string) => {
        if (/INSERT INTO pg_room_types/i.test(sql)) throw new Error("boom");
        if (/INSERT INTO listings/i.test(sql)) {
          return { rows: [{ id: "listing-1", status: "draft" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });
      const svc = new PgListingService(db, appState, properties as any);

      await expect(
        svc.createDraft("op-1", "prop-1", {
          property: { display_name: "Sunrise PG", city_slug: "delhi" },
          pg_details: { total_beds: 10 } as any,
          room_types: ONE_ROOM as any
        })
      ).rejects.toThrow(/boom/);

      const sqls = client.query.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    });

    it("throws no_room_types when room_types empty", async () => {
      const { db, properties, appState } = makeMemDeps();
      const svc = new PgListingService(db, appState, properties as any);
      await expect(
        svc.createDraft("op-1", "prop-1", {
          property: { display_name: "A", city_slug: "delhi" },
          pg_details: { total_beds: 10 } as any,
          room_types: []
        })
      ).rejects.toThrow(/no_room_types/i);
    });

    it("throws property_not_found when active property id mismatches", async () => {
      const { db, properties, appState } = makeMemDeps();
      const svc = new PgListingService(db, appState, properties as any);
      await expect(
        svc.createDraft("op-1", "wrong-prop", {
          property: { display_name: "A", city_slug: "delhi" },
          pg_details: { total_beds: 10 } as any,
          room_types: ONE_ROOM as any
        })
      ).rejects.toThrow(/property_not_found/i);
    });
  });

  describe("getOperatorListingDetail() — reads the pg_listings head", () => {
    it("returns head + details with rent derived from starting_rent_paise", async () => {
      const head = {
        id: "L1",
        status: "active",
        title: "Sunrise PG",
        starting_rent_paise: 1200000,
        created_at: "2026-01-01T00:00:00Z",
        city_slug: "delhi",
        locality_slug: null,
        total_beds: 10,
        gender_policy: "coed",
        tenant_type: "any",
        security_deposit_paise: null,
        notice_period_days: null,
        lock_in_months: null,
        electricity_mode: null,
        rent_due_day: null,
        price_negotiable: false,
        payment_modes: [],
        meals: null,
        amenities: {},
        house_rules: {}
      };
      const db = {
        isEnabled: () => true,
        query: vi.fn(async (sql: string) => {
          if (/FROM pg_listings/i.test(sql)) return { rows: [head], rowCount: 1 };
          return { rows: [], rowCount: 0 };
        })
      } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);

      const detail = await svc.getOperatorListingDetail(
        "op-1",
        "11111111-1111-4111-8111-111111111111"
      );
      expect(detail?.id).toBe("L1");
      expect(detail?.monthly_rent).toBe(12000); // 1_200_000 paise / 100
      expect(detail?.pg_details.total_beds).toBe(10);
    });

    it("returns null for a non-uuid id (never lets 'undefined' reach SQL)", async () => {
      const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
      const db = { isEnabled: () => true, query } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);

      const detail = await svc.getOperatorListingDetail("op-1", "undefined");
      expect(detail).toBeNull();
      // Guard short-circuits before any DB round-trip.
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("getPublicListingDetail() — tenant-facing, ACTIVE only", () => {
    const VALID_ID = "11111111-1111-4111-8111-111111111111";

    it("filters the head query to status='active' and returns the listing", async () => {
      const head = {
        id: "L1",
        status: "active",
        title: "Sunrise PG",
        starting_rent_paise: 800000,
        created_at: "2026-01-01T00:00:00Z",
        city_slug: "delhi",
        locality_slug: null,
        total_beds: 8,
        gender_policy: "girls",
        tenant_type: "students",
        security_deposit_paise: null,
        notice_period_days: null,
        lock_in_months: null,
        electricity_mode: null,
        rent_due_day: null,
        price_negotiable: false,
        payment_modes: [],
        meals: null,
        amenities: {},
        house_rules: {}
      };
      const query = vi.fn(async (sql: string) =>
        /FROM pg_listings/i.test(sql) ? { rows: [head], rowCount: 1 } : { rows: [], rowCount: 0 }
      );
      const db = { isEnabled: () => true, query } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);

      const detail = await svc.getPublicListingDetail(VALID_ID);
      expect(detail?.id).toBe("L1");
      expect(detail?.monthly_rent).toBe(8000);

      const headSql = query.mock.calls
        .map((c) => String(c[0]))
        .find((s) => /FROM pg_listings/i.test(s));
      expect(headSql).toMatch(/status = 'active'/);
      // public read must NOT scope by operator
      expect(headSql).not.toMatch(/operator_user_id/);
    });

    it("returns null for a non-uuid id without touching the DB", async () => {
      const query = vi.fn();
      const db = { isEnabled: () => true, query } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);
      expect(await svc.getPublicListingDetail("undefined")).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });
  });

  describe("listOperatorListings() — dashboard read off pg_listings", () => {
    it("reads heads for the operator", async () => {
      const db = {
        isEnabled: () => true,
        query: vi.fn(async (sql: string) =>
          /FROM pg_listings/i.test(sql)
            ? {
                rows: [{ id: "L1", status: "active", updated_at: "2026-01-01T00:00:00Z" }],
                rowCount: 1
              }
            : { rows: [], rowCount: 0 }
        )
      } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);
      const rows = await svc.listOperatorListings("op-1");
      expect(rows[0].id).toBe("L1");
      expect(rows[0].status).toBe("active");
    });
  });

  describe("submitForReview() — draft → pending_review (operator → admin queue)", () => {
    const VALID_ID = "22222222-2222-4222-8222-222222222222";

    it("flips the head AND the projection to pending_review in one transaction", async () => {
      const client = {
        query: vi.fn(async (sql: string) => {
          if (/UPDATE pg_listings/i.test(sql)) {
            return { rows: [{ id: VALID_ID, status: "pending_review" }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
        release: vi.fn()
      };
      const db = { isEnabled: () => true, getClient: vi.fn(async () => client) } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);

      const r = await svc.submitForReview("op-1", VALID_ID);
      expect(r.status).toBe("pending_review");

      const sqls = client.query.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(sqls.some((s) => /UPDATE pg_listings/i.test(s) && /pending_review/.test(s))).toBe(
        true
      );
      expect(sqls.some((s) => /UPDATE listings/i.test(s) && /pending_review/.test(s))).toBe(true);
      expect(sqls.some((s) => /COMMIT/.test(s))).toBe(true);
    });

    it("404s (rolls back) when the operator doesn't own a submittable listing", async () => {
      const client = {
        query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
        release: vi.fn()
      };
      const db = { isEnabled: () => true, getClient: vi.fn(async () => client) } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);

      await expect(svc.submitForReview("op-1", VALID_ID)).rejects.toThrow(/listing_not_found/i);
      const sqls = client.query.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(sqls.some((s) => /ROLLBACK/.test(s))).toBe(true);
    });

    it("rejects a non-uuid id without a DB round-trip", async () => {
      const getClient = vi.fn();
      const db = { isEnabled: () => true, getClient } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);
      await expect(svc.submitForReview("op-1", "undefined")).rejects.toThrow(/listing_not_found/i);
      expect(getClient).not.toHaveBeenCalled();
    });
  });

  describe("hydrateFromVoiceDraft()", () => {
    it("is idempotent on the same idempotency key", async () => {
      const { db, properties, appState } = makeMemDeps();
      const svc = new PgListingService(db, appState, properties as any);
      appState.insertPgListingDraft({
        id: "draft-1",
        operator_user_id: "op-1",
        pg_property_id: "prop-1",
        payload: {
          property: { display_name: "A", city_slug: "delhi" },
          pg_details: { total_beds: 10 },
          room_types: [
            { sharing: "single", ac: false, monthly_rent_paise: 500000, vacancy_count: 1 }
          ]
        }
      });
      const a = await svc.hydrateFromVoiceDraft("draft-1", { idempotencyKey: "pg_voice:s1" });
      const b = await svc.hydrateFromVoiceDraft("draft-1", { idempotencyKey: "pg_voice:s1" });
      expect(a.id).toBe(b.id);
    });

    it("throws draft_not_found for unknown draft id", async () => {
      const { db, properties, appState } = makeMemDeps();
      const svc = new PgListingService(db, appState, properties as any);
      await expect(
        svc.hydrateFromVoiceDraft("nope", { idempotencyKey: "pg_voice:x" })
      ).rejects.toThrow(/draft_not_found/i);
    });
  });
});

describe("PgListingService.listOperatorListingCities", () => {
  it("returns distinct city slugs for the operator", async () => {
    const { appState, properties } = makeDbDeps();
    const db = {
      isEnabled: () => true,
      query: vi.fn(async () => ({ rows: [{ slug: "pune" }, { slug: "mumbai" }], rowCount: 2 }))
    } as any;
    const svc = new PgListingService(db, appState, properties as any);
    const r = await svc.listOperatorListingCities("op-1");
    expect(r).toEqual(["pune", "mumbai"]);
    expect(db.query.mock.calls[0][1]).toEqual(["op-1"]);
  });

  it("returns [] when the DB is disabled", async () => {
    const { appState, properties } = makeDbDeps();
    const db = { isEnabled: () => false, query: vi.fn() } as any;
    const svc = new PgListingService(db, appState, properties as any);
    expect(await svc.listOperatorListingCities("op-1")).toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});
