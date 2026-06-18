import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { PgAdminListingEditService } from "../src/modules/admin/pg-admin-listing-edit.service";

const LISTING_ID = "9ab0bc8c-ac9f-41e8-b302-8fd740a4bca2";

// Azure SAS provider stub — photo tests assert it's exercised; the read/edit
// tests never call it.
const photoStub = {
  validatePresignRequest: () => {},
  createUploadTarget: ({ clientUploadId }: { clientUploadId: string }) => ({
    uploadUrl: `https://blob.example/${clientUploadId}?sas`,
    blobPath: `pg/${LISTING_ID}/${clientUploadId}.jpg`,
    expiresAt: new Date().toISOString()
  }),
  validateUploadedBlob: async () => {}
} as any;

const makeSvc = (db: any) => new PgAdminListingEditService(db, photoStub);

// Postgres enums on admin_actions (verified against the live DB 2026-06-13).
// The mock DB does NOT enforce enums, so these guards catch the class of bug
// where the service writes an enum value the column doesn't allow (which 500s
// in prod and rolls back the whole edit).
const VALID_ADMIN_TARGETS = [
  "listing",
  "verification_attempt",
  "wallet",
  "user",
  "sales_lead",
  "pg_property"
];
const VALID_ADMIN_ACTIONS = [
  "approve",
  "reject",
  "pause",
  "adjust_wallet",
  "manual_review",
  "block_user",
  "update_lead",
  "edit_pg_property",
  "set_analytics_override",
  "clear_analytics_override"
];
function expectValidAudit(calls: Array<{ text: string; params?: unknown[] }>) {
  const audit = calls.find((c) => c.text.includes("INSERT INTO admin_actions"));
  expect(audit, "an admin_actions row must be written").toBeTruthy();
  // params: [adminId, target_type, target_id, action, before, after]
  expect(VALID_ADMIN_TARGETS).toContain(audit!.params![1]);
  expect(VALID_ADMIN_ACTIONS).toContain(audit!.params![3]);
}

// Mock DatabaseService: routes each SQL by a marker substring to a canned result.
function makeDb(opts: {
  enabled?: boolean;
  head?: Record<string, unknown> | null;
  rooms?: Record<string, unknown>[];
  photos?: Record<string, unknown>[];
}) {
  const head = opts.head === undefined ? defaultHead() : opts.head;
  return {
    isEnabled: () => opts.enabled ?? true,
    query: async (text: string) => {
      if (text.includes("FROM pg_listings pl")) {
        return { rowCount: head ? 1 : 0, rows: head ? [head] : [] };
      }
      if (text.includes("FROM pg_room_types")) {
        return { rowCount: (opts.rooms ?? []).length, rows: opts.rooms ?? [] };
      }
      if (text.includes("FROM listing_photos")) {
        return { rowCount: (opts.photos ?? []).length, rows: opts.photos ?? [] };
      }
      return { rowCount: 0, rows: [] };
    }
  } as any;
}

function defaultHead(): Record<string, unknown> {
  return {
    id: LISTING_ID,
    status: "active",
    title: "Omega PG",
    created_at: "2026-06-07T00:00:00.000Z",
    property_id: "11111111-1111-1111-1111-111111111111",
    property_display_name: "Omega PG",
    property_status: "active",
    property_lat: 26.8467,
    property_lng: 80.9462,
    property_total_floors: 5,
    property_internal_code: null,
    city_slug: "lucknow",
    locality_slug: "mahanagar",
    total_beds: 12,
    gender_policy: "boys",
    tenant_type: "students",
    security_deposit_paise: 1000000,
    deposit_refundable_pct: 100,
    notice_period_days: 30,
    lock_in_months: 3,
    electricity_mode: "submetered",
    maintenance_paise: null,
    rent_due_day: 5,
    price_negotiable: true,
    payment_modes: ["upi", "cash"],
    meals: { provided: true, veg_only: true },
    meal_charges_paise: null,
    amenities: { common: ["wifi"] },
    house_rules: { smoking: false },
    nearby: null
  };
}

// Transaction-capturing client: records every SQL, answers the reads the
// mutation paths depend on, and lets tests assert what was written.
function makeTxClient(
  opts: { headExists?: boolean; pgDetailsBefore?: Record<string, unknown> | null } = {}
) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const client = {
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      if (text.includes("FROM pg_listings WHERE id")) {
        return { rowCount: opts.headExists === false ? 0 : 1, rows: [] };
      }
      if (text.includes("FROM pg_details WHERE listing_id")) {
        const b =
          opts.pgDetailsBefore === undefined
            ? { total_beds: 10, onboarding_path: "self_serve" }
            : opts.pgDetailsBefore;
        return { rowCount: b ? 1 : 0, rows: b ? [b] : [] };
      }
      if (text.includes("FROM pg_room_types WHERE listing_id")) {
        return { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
    release: () => {}
  };
  const db = { isEnabled: () => true, getClient: async () => client } as any;
  return { db, calls, has: (frag: string) => calls.some((c) => c.text.includes(frag)) };
}

describe("PgAdminListingEditService.updateDetails", () => {
  it("upserts pg_details and writes a VALID admin_actions audit row, then commits", async () => {
    const { db, has, calls } = makeTxClient({
      pgDetailsBefore: { total_beds: 12, onboarding_path: "self_serve" }
    });
    const svc = makeSvc(db);
    await svc.updateDetails("00000000-0000-0000-0000-0000000000aa", LISTING_ID, {
      gender_policy: "girls",
      security_deposit_paise: 1500000
    });
    expect(has("INSERT INTO pg_details")).toBe(true);
    expect(has("INSERT INTO admin_actions")).toBe(true);
    expect(has("COMMIT")).toBe(true);
    expectValidAudit(calls); // audit must use enum values the DB allows
  });

  it("404s when the listing head is missing", async () => {
    const { db } = makeTxClient({ headExists: false });
    const svc = makeSvc(db);
    await expect(
      svc.updateDetails("00000000-0000-0000-0000-0000000000aa", LISTING_ID, {
        gender_policy: "boys"
      })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("writes the listing title to the head AND the public projection", async () => {
    const { db, has } = makeTxClient({
      pgDetailsBefore: { total_beds: 12, onboarding_path: "self_serve" }
    });
    const svc = makeSvc(db);
    await svc.updateDetails("00000000-0000-0000-0000-0000000000aa", LISTING_ID, {
      title: "Omega PG — Girls Block B"
    });
    expect(has("UPDATE pg_listings SET title")).toBe(true);
    expect(has("UPDATE listings SET title_en")).toBe(true);
    expect(has("COMMIT")).toBe(true);
  });
});

describe("PgAdminListingEditService.updateRooms", () => {
  const room = {
    sharing: "double",
    ac: true,
    bathroom_kind: "attached_western",
    furnishing: "semi_furnished",
    monthly_rent_paise: 1000000,
    vacancy_count: 3
  } as any;

  it("replaces rooms, reprojects starting rent to listings, audits, commits", async () => {
    const { db, has, calls } = makeTxClient();
    const svc = makeSvc(db);
    const res = await svc.updateRooms("00000000-0000-0000-0000-0000000000aa", LISTING_ID, [
      room,
      { ...room, sharing: "triple", monthly_rent_paise: 800000 }
    ]);
    expect(res.starting_rent_paise).toBe(800000); // min of the set
    expect(has("DELETE FROM pg_room_types")).toBe(true);
    expect(has("INSERT INTO pg_room_types")).toBe(true);
    expect(has("UPDATE pg_listings SET starting_rent_paise")).toBe(true);
    expect(has("UPDATE listings SET monthly_rent")).toBe(true);
    expect(has("INSERT INTO admin_actions")).toBe(true);
    expect(has("COMMIT")).toBe(true);
    expectValidAudit(calls);
  });

  it("rejects an empty room set", async () => {
    const svc = makeSvc(makeTxClient().db);
    await expect(
      svc.updateRooms("00000000-0000-0000-0000-0000000000aa", LISTING_ID, [])
    ).rejects.toMatchObject({ response: { code: "no_room_types" } });
  });
});

// Photo-path client: head check + normalizeCover SELECT return canned rows.
function makePhotoClient(
  opts: {
    headExists?: boolean;
    coverRows?: Array<{ id: string; is_cover: boolean }>;
    deleted?: boolean;
  } = {}
) {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const client = {
    query: async (text: string, params?: unknown[]) => {
      calls.push({ text, params });
      if (text.includes("FROM pg_listings WHERE id")) {
        return { rowCount: opts.headExists === false ? 0 : 1, rows: [] };
      }
      if (
        text.startsWith("\n      SELECT id::text AS id, is_cover") ||
        text.includes("ORDER BY is_cover DESC, sort_order ASC, created_at ASC")
      ) {
        return { rows: opts.coverRows ?? [{ id: "p-1", is_cover: true }] };
      }
      if (text.includes("DELETE FROM listing_photos")) {
        return { rowCount: opts.deleted === false ? 0 : 1, rows: [{ is_cover: true }] };
      }
      return { rowCount: 1, rows: [] };
    },
    release: () => {}
  };
  const db = {
    isEnabled: () => true,
    getClient: async () => client,
    // assertListingExists uses the top-level db.query for the head check.
    query: async (text: string) => {
      if (text.includes("FROM pg_listings WHERE id")) {
        return { rowCount: opts.headExists === false ? 0 : 1, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    }
  } as any;
  return { db, calls, has: (frag: string) => calls.some((c) => c.text.includes(frag)) };
}

const ADMIN = "00000000-0000-0000-0000-0000000000aa";

describe("PgAdminListingEditService photos", () => {
  it("presign returns a SAS target per file", async () => {
    const svc = makeSvc(makePhotoClient().db);
    const res = await svc.presignPhotos(LISTING_ID, [
      { clientUploadId: "u1", contentType: "image/jpeg", sizeBytes: 1000 }
    ]);
    expect(res.uploads).toHaveLength(1);
    expect(res.uploads[0].blobPath).toContain("u1");
    expect(res.uploads[0].uploadUrl).toContain("sas");
  });

  it("commit inserts photos as approved, normalizes cover, audits, commits", async () => {
    const { db, has, calls } = makePhotoClient();
    const svc = makeSvc(db);
    const res = await svc.commitPhotos(ADMIN, LISTING_ID, [
      { clientUploadId: "u1", blobPath: "pg/x/u1.jpg", isCover: true, sortOrder: 0 }
    ]);
    expect(res.committed).toBe(1);
    expect(has("INSERT INTO listing_photos")).toBe(true);
    expect(has("INSERT INTO admin_actions")).toBe(true);
    expect(has("COMMIT")).toBe(true);
    expectValidAudit(calls);
  });

  it("reorder updates rows and audits", async () => {
    const { db, has } = makePhotoClient();
    const svc = makeSvc(db);
    await svc.reorderPhotos(ADMIN, LISTING_ID, [
      { id: "11111111-1111-1111-1111-111111111111", sort_order: 1, is_cover: false }
    ]);
    expect(has("UPDATE listing_photos SET sort_order")).toBe(true);
    expect(has("INSERT INTO admin_actions")).toBe(true);
  });

  it("delete removes the row and promotes a new cover", async () => {
    const { db, has } = makePhotoClient();
    const svc = makeSvc(db);
    const res = await svc.deletePhoto(ADMIN, LISTING_ID, "22222222-2222-2222-2222-222222222222");
    expect(res.deleted).toBe(true);
    expect(has("DELETE FROM listing_photos")).toBe(true);
    expect(has("COMMIT")).toBe(true);
  });

  it("delete 404s when the photo id is missing", async () => {
    const svc = makeSvc(makePhotoClient({ deleted: false }).db);
    await expect(
      svc.deletePhoto(ADMIN, LISTING_ID, "22222222-2222-2222-2222-222222222222")
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("PgAdminListingEditService.getFullListing", () => {
  it("maps head + rooms + photos into the full admin DTO", async () => {
    const db = makeDb({
      rooms: [
        {
          sharing: "double",
          ac: true,
          bathroom_kind: "attached_western",
          furnishing: "semi_furnished",
          monthly_rent_paise: 1000000,
          vacancy_count: 3,
          available_from: null
        }
      ],
      photos: [
        {
          id: "p-1",
          blob_path: "pg/cover.jpg",
          is_cover: true,
          sort_order: 0,
          moderation_status: "approved"
        }
      ]
    });
    const svc = makeSvc(db);
    const full = await svc.getFullListing(LISTING_ID);

    expect(full.listing.id).toBe(LISTING_ID);
    expect(full.listing.title).toBe("Omega PG");
    expect(full.property?.city_slug).toBe("lucknow");
    expect(full.property?.lat).toBe(26.8467);
    expect(full.pg_details.gender_policy).toBe("boys");
    expect(full.pg_details.payment_modes).toEqual(["upi", "cash"]);
    expect(full.pg_details.price_negotiable).toBe(true);
    expect(full.room_types).toHaveLength(1);
    expect(full.room_types[0].monthly_rent_paise).toBe(1000000);
    expect(full.photos).toHaveLength(1);
    expect(full.photos[0].id).toBe("p-1");
    expect(full.photos[0].is_cover).toBe(true);
    // sort_order/id must be present (reorder/delete depend on them)
    expect(full.photos[0].sort_order).toBe(0);
  });

  it("returns property: null when the listing has no linked pg_property", async () => {
    const head = { ...defaultHead(), property_id: null };
    const svc = makeSvc(makeDb({ head }));
    const full = await svc.getFullListing(LISTING_ID);
    expect(full.property).toBeNull();
  });

  it("404s on a malformed (non-uuid) id", async () => {
    const svc = makeSvc(makeDb({}));
    await expect(svc.getFullListing("not-a-uuid")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("404s when the listing is not found", async () => {
    const svc = makeSvc(makeDb({ head: null }));
    await expect(svc.getFullListing(LISTING_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
