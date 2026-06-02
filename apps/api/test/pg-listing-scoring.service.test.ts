import { describe, it, expect, vi } from "vitest";
import { PgListingService } from "../src/modules/pg-operator/services/pg-listing.service";
import { PgScoreService } from "../src/modules/pg-operator/services/pg-score.service";
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
    getActiveProperty: vi.fn(async () => ({
      id: "prop-1",
      lat: 12.97,
      lng: 77.59,
      status: "active"
    }))
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
