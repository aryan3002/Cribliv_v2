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
    // 1:1 model: createDraft resolves the specific owned property id, not "the"
    // active one. Mirror that — return the row only for the matching id.
    getOwnedProperty: vi.fn(async (_op: string, id: string) =>
      id === "prop-1"
        ? {
            id: "prop-1",
            operator_id: "op-1",
            city_id: 1,
            locality_id: null,
            lat: null,
            lng: null,
            is_primary: true
          }
        : null
    )
  };
  const appState = new AppStateService();
  return { db, client, properties, appState };
}

function makeMemDeps() {
  const db = { isEnabled: () => false, query: vi.fn() } as any;
  const properties = {
    getOwnedProperty: vi.fn(async (_op: string, id: string) =>
      id === "prop-1"
        ? {
            id: "prop-1",
            operator_id: "op-1",
            city_id: 1,
            locality_id: null,
            lat: null,
            lng: null,
            is_primary: true
          }
        : null
    )
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

    it("returns photoItems (id + sort_order + absolute url) for owner-style edit hydration", async () => {
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
          if (/FROM listing_photos/i.test(sql)) {
            return {
              rows: [
                { id: "ph-1", blob_path: "pg/L1/cover.jpg", is_cover: true, sort_order: 0 },
                { id: "ph-2", blob_path: "pg/L1/room.jpg", is_cover: false, sort_order: 1 }
              ],
              rowCount: 2
            };
          }
          return { rows: [], rowCount: 0 };
        })
      } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);

      const detail = await svc.getOperatorListingDetail(
        "op-1",
        "11111111-1111-4111-8111-111111111111"
      );
      expect(detail?.photoItems).toHaveLength(2);
      expect(detail!.photoItems[0]).toMatchObject({
        id: "ph-1",
        blob_path: "pg/L1/cover.jpg",
        is_cover: true,
        sort_order: 0
      });
      expect(typeof detail!.photoItems[0].url).toBe("string");
      expect(detail!.photoItems[1].id).toBe("ph-2");
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

    it("returns composite_score as 0-100 integer from listing_scores (persisted score, matches dashboard)", async () => {
      // listing_scores.composite_score is stored as a 0–1 float; the API must
      // multiply × 100 so the detail page shows the same integer as the dashboard.
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
        house_rules: {},
        verification_status: "verified",
        has_exact_geo: true,
        composite_score: 0.72 // ← from listing_scores JOIN
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
      expect(detail?.composite_score).toBe(72);
    });

    it("returns composite_score 0 when listing_scores row not yet written (async rescore not fired)", async () => {
      const head = {
        id: "L1",
        status: "draft",
        title: "New PG",
        starting_rent_paise: 800000,
        created_at: "2026-01-01T00:00:00Z",
        city_slug: "pune",
        locality_slug: null,
        total_beds: 5,
        gender_policy: null,
        tenant_type: null,
        security_deposit_paise: null,
        notice_period_days: null,
        lock_in_months: null,
        electricity_mode: null,
        rent_due_day: null,
        price_negotiable: false,
        payment_modes: [],
        meals: null,
        amenities: {},
        house_rules: {},
        verification_status: null,
        has_exact_geo: false,
        composite_score: null // ← COALESCE → 0
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
      expect(detail?.composite_score).toBe(0);
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

  describe("getEditPayload() — reconstructs the wizard payload (write-path inverse)", () => {
    const VALID = "11111111-1111-4111-8111-111111111111";

    function makeReadDb(
      head: Record<string, unknown> | null,
      details: Record<string, unknown> | null,
      rooms: Array<Record<string, unknown>>
    ) {
      return {
        isEnabled: () => true,
        query: vi.fn(async (sql: string) => {
          if (/FROM pg_listings/i.test(sql)) {
            return { rows: head ? [head] : [], rowCount: head ? 1 : 0 };
          }
          if (/FROM pg_details/i.test(sql)) {
            return { rows: details ? [details] : [], rowCount: details ? 1 : 0 };
          }
          if (/FROM pg_room_types/i.test(sql)) {
            return { rows: rooms, rowCount: rooms.length };
          }
          return { rows: [], rowCount: 0 };
        })
      } as any;
    }

    it("round-trips a committed listing losslessly (slugs resolved, *_paise cast string→number)", async () => {
      const head = {
        title: "Sunrise PG — Boys",
        display_name: "Sunrise PG",
        internal_code: "SUN-01",
        city_slug: "pune",
        locality_slug: "kothrud",
        total_floors: 3,
        lat: 18.51,
        lng: 73.81
      };
      const details = {
        total_beds: 12,
        gender_policy: "boys",
        tenant_type: "students",
        notice_period_days: 30,
        lock_in_months: 2,
        // node-pg returns bigint columns as STRINGS — getEditPayload must Number() them.
        security_deposit_paise: "5000000",
        deposit_refundable_pct: 80,
        electricity_mode: "submetered",
        maintenance_paise: "150000",
        rent_due_day: 5,
        payment_modes: ["upi", "bank_transfer"],
        late_fee_policy: { per_day_paise: 5000 },
        price_negotiable: true,
        meals: { provided: true, veg_only: true },
        meal_charges_paise: "300000",
        amenities: { core: ["wifi", "cctv"] },
        house_rules: {
          smoking: false,
          alcohol: false,
          non_veg: true,
          pets: false,
          cooking_in_room: false
        },
        nearby: { metro: ["Vanaz"] }
      };
      const rooms = [
        {
          sharing: "double",
          ac: true,
          bathroom_kind: "attached_western",
          furnishing: "semi_furnished",
          monthly_rent_paise: "900000",
          vacancy_count: 4,
          available_from: "2026-07-01"
        },
        {
          sharing: "triple",
          ac: false,
          bathroom_kind: "shared_indian",
          furnishing: "unfurnished",
          monthly_rent_paise: "700000",
          vacancy_count: 6,
          available_from: null
        }
      ];
      const svc = new PgListingService(
        makeReadDb(head, details, rooms),
        new AppStateService(),
        {} as any
      );

      const payload = await svc.getEditPayload("op-1", VALID);
      expect(payload).not.toBeNull();
      // property block + slug resolution
      expect(payload!.title).toBe("Sunrise PG — Boys");
      expect(payload!.property.display_name).toBe("Sunrise PG");
      expect(payload!.property.internal_code).toBe("SUN-01");
      expect(payload!.property.city_slug).toBe("pune");
      expect(payload!.property.locality_slug).toBe("kothrud");
      expect(payload!.property.total_floors).toBe(3);
      expect(payload!.property.lat).toBeCloseTo(18.51);
      expect(payload!.property.lng).toBeCloseTo(73.81);
      // pg_details — *_paise cast from string → number (money rule)
      expect(payload!.pg_details.total_beds).toBe(12);
      expect(payload!.pg_details.gender_policy).toBe("boys");
      expect(payload!.pg_details.tenant_type).toBe("students");
      expect(payload!.pg_details.security_deposit_paise).toBe(5000000);
      expect(typeof payload!.pg_details.security_deposit_paise).toBe("number");
      expect(payload!.pg_details.maintenance_paise).toBe(150000);
      expect(payload!.pg_details.meal_charges_paise).toBe(300000);
      expect(payload!.pg_details.deposit_refundable_pct).toBe(80);
      expect(payload!.pg_details.notice_period_days).toBe(30);
      expect(payload!.pg_details.lock_in_months).toBe(2);
      expect(payload!.pg_details.rent_due_day).toBe(5);
      expect(payload!.pg_details.electricity_mode).toBe("submetered");
      expect(payload!.pg_details.price_negotiable).toBe(true);
      expect(payload!.pg_details.payment_modes).toEqual(["upi", "bank_transfer"]);
      expect(payload!.pg_details.meals).toEqual({ provided: true, veg_only: true });
      expect(payload!.pg_details.amenities).toEqual({ core: ["wifi", "cctv"] });
      expect(payload!.pg_details.late_fee_policy).toEqual({ per_day_paise: 5000 });
      expect(payload!.pg_details.nearby).toEqual({ metro: ["Vanaz"] });
      // room types — ordered by rent, *_paise numeric, nullable available_from
      expect(payload!.room_types).toHaveLength(2);
      expect(payload!.room_types[0].sharing).toBe("double");
      expect(payload!.room_types[0].ac).toBe(true);
      expect(payload!.room_types[0].monthly_rent_paise).toBe(900000);
      expect(typeof payload!.room_types[0].monthly_rent_paise).toBe("number");
      expect(payload!.room_types[0].available_from).toBe("2026-07-01");
      expect(payload!.room_types[1].ac).toBe(false);
      expect(payload!.room_types[1].available_from).toBeNull();
    });

    it("scopes the head read by operator (ownership) and resolves slugs via JOIN cities", async () => {
      const db = makeReadDb(
        {
          title: null,
          display_name: "X",
          internal_code: null,
          city_slug: "pune",
          locality_slug: null,
          total_floors: null,
          lat: null,
          lng: null
        },
        {},
        []
      );
      const svc = new PgListingService(db, new AppStateService(), {} as any);
      await svc.getEditPayload("op-9", VALID);
      const headSql = (db.query.mock.calls as unknown[][])
        .map((c) => String(c[0]))
        .find((s) => /FROM pg_listings/i.test(s));
      expect(headSql).toMatch(/operator_user_id/);
      expect(headSql).toMatch(/JOIN cities/i);
    });

    it("returns null for a non-uuid id without touching the DB", async () => {
      const query = vi.fn();
      const db = { isEnabled: () => true, query } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);
      expect(await svc.getEditPayload("op-1", "undefined")).toBeNull();
      expect(query).not.toHaveBeenCalled();
    });

    it("returns null when the operator doesn't own the listing (no head row)", async () => {
      const svc = new PgListingService(
        makeReadDb(null, null, []),
        new AppStateService(),
        {} as any
      );
      expect(await svc.getEditPayload("op-1", VALID)).toBeNull();
    });

    it("returns null (no DB round-trip) when the DB is disabled", async () => {
      const db = { isEnabled: () => false, query: vi.fn() } as any;
      const svc = new PgListingService(db, new AppStateService(), {} as any);
      expect(await svc.getEditPayload("op-1", VALID)).toBeNull();
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  describe("updateListing() — edit in place, MATERIAL-EDIT status rule", () => {
    const VALID = "33333333-3333-4333-8333-333333333333";

    const samplePayload = {
      title: "Sunrise PG — Boys",
      property: {
        display_name: "Sunrise PG",
        city_slug: "pune",
        locality_slug: "kothrud",
        lat: 18.5,
        lng: 73.8
      },
      pg_details: { total_beds: 12, gender_policy: "boys" },
      room_types: [
        {
          sharing: "double",
          ac: true,
          bathroom_kind: "attached_western",
          furnishing: "semi_furnished",
          monthly_rent_paise: 900000,
          vacancy_count: 4
        }
      ]
    } as any;

    function makeUpdateDeps(opts: { pgPropertyId?: string | null; status?: string } = {}) {
      const client = {
        query: vi.fn(async (sql: string) => {
          // orphan-scan: existing rooms include a tuple NOT in samplePayload
          if (/SELECT[\s\S]*FROM pg_room_types/i.test(sql)) {
            return {
              rows: [
                {
                  id: "r-old",
                  sharing: "single",
                  ac: false,
                  bathroom_kind: "attached_western",
                  furnishing: "semi_furnished"
                }
              ],
              rowCount: 1
            };
          }
          if (/INSERT INTO listings/i.test(sql)) {
            return { rows: [{ id: VALID, status: "x" }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }),
        release: vi.fn()
      };
      const db = {
        isEnabled: () => true,
        getClient: vi.fn(async () => client),
        query: vi.fn(async (sql: string) => {
          // ownership + current status + own property
          if (/FROM pg_listings/i.test(sql) && /pg_property_id/i.test(sql)) {
            return opts.pgPropertyId === null
              ? { rows: [], rowCount: 0 }
              : {
                  rows: [
                    {
                      pg_property_id: opts.pgPropertyId ?? "prop-L1",
                      status: opts.status ?? "active"
                    }
                  ],
                  rowCount: 1
                };
          }
          if (/phone_e164/i.test(sql)) {
            return { rows: [{ phone_e164: null, whatsapp_opt_in: false }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        })
      } as any;
      const properties = {
        resolveLocation: vi.fn(async () => ({ cityId: 1, localityId: 2 }))
      };
      return { db, client, properties };
    }

    it("material edit on an active listing → pending_review; updates own property in place; deletes orphan rooms; never inserts a property", async () => {
      const { db, client, properties } = makeUpdateDeps({ status: "active" });
      const svc = new PgListingService(db, new AppStateService(), properties as any);
      // "before" differs materially (title) from samplePayload
      vi.spyOn(svc, "getEditPayload").mockResolvedValue({ ...samplePayload, title: "OLD TITLE" });

      const res = await svc.updateListing("op-1", VALID, samplePayload);
      expect(res).toEqual({ id: VALID, status: "pending_review" });

      const sql = client.query.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      expect(sql).toMatch(/UPDATE pg_properties[\s\S]*SET/i);
      expect(sql).toMatch(/UPDATE pg_listings[\s\S]*SET/i); // head updated in place (INSERT-only writer can't)
      expect(sql).toMatch(/DELETE FROM pg_room_types/i); // orphan removed
      expect(sql).not.toMatch(/INSERT INTO pg_properties/i); // NO new property
      expect(sql).toMatch(/COMMIT/);
    });

    it("non-material edit on an active listing → stays active (no re-review)", async () => {
      const { db, properties } = makeUpdateDeps({ status: "active" });
      const svc = new PgListingService(db, new AppStateService(), properties as any);
      // "before" equals the incoming payload on all material fields
      vi.spyOn(svc, "getEditPayload").mockResolvedValue({ ...samplePayload });

      const res = await svc.updateListing("op-1", VALID, samplePayload);
      expect(res.status).toBe("active");
    });

    it("never resets verification_status (verification is admin-only — an edit must not un-verify)", async () => {
      const { db, client, properties } = makeUpdateDeps({ status: "active" });
      const svc = new PgListingService(db, new AppStateService(), properties as any);
      vi.spyOn(svc, "getEditPayload").mockResolvedValue({ ...samplePayload });

      await svc.updateListing("op-1", VALID, samplePayload);
      const sql = client.query.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
      // the projection upsert must NOT clobber verification on conflict (edit path)
      expect(sql).not.toMatch(/verification_status\s*=\s*EXCLUDED\.verification_status/i);
      // and the head update must not touch verification_status either
      const headUpdate = client.query.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((s) => /UPDATE pg_listings/i.test(s));
      expect(headUpdate).not.toMatch(/verification_status/i);
    });

    it("rejected listing → pending_review even on a non-material edit (revival re-reviews)", async () => {
      const { db, properties } = makeUpdateDeps({ status: "rejected" });
      const svc = new PgListingService(db, new AppStateService(), properties as any);
      vi.spyOn(svc, "getEditPayload").mockResolvedValue({ ...samplePayload });

      const res = await svc.updateListing("op-1", VALID, samplePayload);
      expect(res.status).toBe("pending_review");
    });

    it("archived listing → pending_review", async () => {
      const { db, properties } = makeUpdateDeps({ status: "archived" });
      const svc = new PgListingService(db, new AppStateService(), properties as any);
      vi.spyOn(svc, "getEditPayload").mockResolvedValue({ ...samplePayload });
      const res = await svc.updateListing("op-1", VALID, samplePayload);
      expect(res.status).toBe("pending_review");
    });

    it("rejects a non-owner / missing listing (no row) → NotFound", async () => {
      const { db, properties } = makeUpdateDeps({ pgPropertyId: null });
      const svc = new PgListingService(db, new AppStateService(), properties as any);
      await expect(svc.updateListing("op-2", VALID, samplePayload)).rejects.toThrow(
        /listing_not_found/i
      );
    });

    it("rejects a non-uuid id without any DB round-trip", async () => {
      const { db, properties } = makeUpdateDeps();
      const svc = new PgListingService(db, new AppStateService(), properties as any);
      await expect(svc.updateListing("op-1", "undefined", samplePayload)).rejects.toThrow(
        /listing_not_found/i
      );
      expect(db.getClient).not.toHaveBeenCalled();
      expect(db.query).not.toHaveBeenCalled();
    });

    it("throws when DB is disabled (consistent with siblings)", async () => {
      const db = { isEnabled: () => false, getClient: vi.fn(), query: vi.fn() } as any;
      const svc = new PgListingService(db, new AppStateService(), {
        resolveLocation: vi.fn()
      } as any);
      await expect(svc.updateListing("op-1", VALID, samplePayload)).rejects.toThrow(
        /listing_not_found/i
      );
      expect(db.getClient).not.toHaveBeenCalled();
    });

    it("throws no_room_types when room_types is empty", async () => {
      const { db, properties } = makeUpdateDeps();
      const svc = new PgListingService(db, new AppStateService(), properties as any);
      await expect(
        svc.updateListing("op-1", VALID, { ...samplePayload, room_types: [] })
      ).rejects.toThrow(/no_room_types/i);
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
