import { describe, it, expect, vi } from "vitest";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { PgScoreService } from "../src/modules/pg-operator/services/pg-score.service";
import { computePgListingScore } from "../../packages/shared-types/src/pg-listing-score";
import type { PgListingPayload } from "../../packages/shared-types/src/pg-operator";

const payload: PgListingPayload = {
  property: {
    display_name: "Test PG",
    city_slug: "bangalore",
    lat: 12.97,
    lng: 77.59
  },
  pg_details: { total_beds: 5 },
  room_types: [{ sharing: "single", ac: false, monthly_rent_paise: 800000, vacancy_count: 1 }]
} as any;

function makeServices() {
  const rescoreCalls: string[] = [];
  const db = {
    isEnabled: () => false,
    query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
  };
  const state = {
    listings: new Map(),
    setPgListingRoomTypes: vi.fn(),
    getPgListingDraft: vi.fn(),
    getPgVoiceIdempotent: vi.fn(),
    setPgVoiceIdempotent: vi.fn(),
    updatePgListingDraftCommitted: vi.fn(),
    pgDetails: new Map(),
    pgRoomTypes: new Map()
  };
  const properties = {
    // 1:1 model: createDraft resolves the specific owned property id.
    getOwnedProperty: vi.fn(async (_op: string, id: string) =>
      id === "prop-1" ? { id: "prop-1", lat: 12.97, lng: 77.59, status: "active" } : null
    )
  };
  // New contract: createDraft triggers rescoreListing(id), which rebuilds
  // signals (photos/verification/geo) from DB truth — no signals are passed in.
  const scoreService = {
    rescoreListing: vi.fn(async (id: string) => {
      rescoreCalls.push(id);
      return { composite: 45, factors: [], recommendations: [] };
    })
  } as unknown as PgScoreService;

  const svc = new PgListingService(db as never, state as never, properties as never, scoreService);
  return { svc, rescoreCalls };
}

// Phase-1b regression guard: the detail page previously hardcoded
// verification_status:"unverified" + has_exact_geo:false, which caused false
// "Verify your PG" and "Pin your exact location" recommendations on already-
// verified, geo-pinned listings.  The page now passes real signals from the
// API response; these tests document that contract.
describe("computePgListingScore — detail page signal passthrough", () => {
  const FULL_PAYLOAD: PgListingPayload = {
    property: { display_name: "Green PG", city_slug: "pune" },
    pg_details: {
      total_beds: 8,
      gender_policy: "coed",
      tenant_type: "any",
      security_deposit_paise: 1000000,
      meals: { provided: true, veg_only: false } as any,
      amenities: { basic: ["wifi", "ac"], services: ["laundry"], extras: [] } as any,
      house_rules: {} as any
    },
    room_types: [
      { sharing: "single", ac: false, monthly_rent_paise: 900000, vacancy_count: 2 },
      { sharing: "double", ac: true, monthly_rent_paise: 1200000, vacancy_count: 4 }
    ]
  } as any;

  it("verified + geo-pinned listing has no get_verified or pin_location recommendation", () => {
    const { recommendations } = computePgListingScore(FULL_PAYLOAD, {
      verification_status: "verified",
      has_exact_geo: true,
      photo_count: 6
    });
    const ids = recommendations.map((r) => r.id);
    expect(ids).not.toContain("get_verified");
    expect(ids).not.toContain("pin_location");
  });

  it("unverified + no geo (old hardcoded values) does produce those false recommendations", () => {
    const { recommendations } = computePgListingScore(FULL_PAYLOAD, {
      verification_status: "unverified",
      has_exact_geo: false,
      photo_count: 6
    });
    const ids = recommendations.map((r) => r.id);
    expect(ids).toContain("get_verified");
    expect(ids).toContain("pin_location");
  });
});

describe("PgListingService scoring on createDraft", () => {
  it("triggers a DB-truth rescore for the created listing", async () => {
    const { svc, rescoreCalls } = makeServices();
    const res = await svc.createDraft("op-1", "prop-1", payload);
    expect(rescoreCalls).toHaveLength(1);
    expect(rescoreCalls[0]).toBe(res.id);
  });

  it("rescores regardless of geo (signals come from the DB, not the payload)", async () => {
    const { svc, rescoreCalls } = makeServices();
    const noGeoPayload = {
      ...payload,
      property: { ...payload.property, lat: null, lng: null }
    } as any;
    const res = await svc.createDraft("op-1", "prop-1", noGeoPayload);
    expect(rescoreCalls).toHaveLength(1);
    expect(rescoreCalls[0]).toBe(res.id);
  });
});
