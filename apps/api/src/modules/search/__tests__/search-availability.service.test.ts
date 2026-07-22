import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { SearchService } from "../search.service";
import { AppStateService, type ListingRecord } from "../../../common/app-state.service";
import { DatabaseService } from "../../../common/database.service";
import { IntentClassifierService } from "../../ai/intent-classifier.service";
import { RankingService } from "../../ai/ranking.service";
import { EmbeddingService } from "../../ai/embedding.service";
import { QueryParserService } from "../../ai/query-parser.service";

// `SearchService.searchListings` only touches AppStateService + DatabaseService
// on the in-memory fallback path (DatabaseService.isEnabled() === false). The AI
// services (intent classifier / ranking / embedding / query parser) are only used
// by routeQuery(), never by searchListings(), so empty mocks are safe here — same
// pattern as apps/api/src/modules/owner/__tests__/owner-availability.service.test.ts.
function makeService() {
  const app = new AppStateService();
  const db = { isEnabled: () => false } as unknown as DatabaseService;
  const intentClassifier = {} as unknown as IntentClassifierService;
  const rankingService = {} as unknown as RankingService;
  const embeddingService = {} as unknown as EmbeddingService;
  const queryParser = {} as unknown as QueryParserService;
  const svc = new SearchService(
    app,
    db,
    intentClassifier,
    rankingService,
    embeddingService,
    queryParser
  );
  return { app, svc };
}

const SEED_CITY = "availtestcity";

/**
 * Seeds 3 active flat_house listings in SEED_CITY: two available, one not.
 * The unavailable listing is given the NEWEST `createdAt` on purpose — a naive
 * "sort by createdAt only" (today's in-memory behavior) would rank it FIRST,
 * which is exactly the bug Task 9 fixes. That makes the ordering assertions
 * below meaningful: they fail before the fix and pass after it.
 */
function seedAvailabilityFixture(app: AppStateService) {
  const now = Date.now();
  const ownerId = randomUUID();

  const available1: ListingRecord = {
    id: randomUUID(),
    ownerUserId: ownerId,
    listingType: "flat_house",
    title: "Available Flat A",
    city: SEED_CITY,
    monthlyRent: 20000,
    verificationStatus: "verified",
    status: "active",
    createdAt: now,
    is_available: true
  };

  const available2: ListingRecord = {
    id: randomUUID(),
    ownerUserId: ownerId,
    listingType: "flat_house",
    title: "Available Flat C (oldest)",
    city: SEED_CITY,
    monthlyRent: 22000,
    verificationStatus: "verified",
    status: "active",
    createdAt: now - 100_000,
    is_available: true
  };

  const unavailable: ListingRecord = {
    id: randomUUID(),
    ownerUserId: ownerId,
    listingType: "flat_house",
    title: "Unavailable Flat B (newest)",
    city: SEED_CITY,
    monthlyRent: 21000,
    verificationStatus: "verified",
    status: "active",
    createdAt: now + 100_000,
    is_available: false
  };

  [available1, available2, unavailable].forEach((l) => app.listings.set(l.id, l));
  return { available1, available2, unavailable };
}

describe("SearchService.searchListings — availability sink (in-memory fallback)", () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  it.each(["newest", "relevance"] as const)(
    "sorts unavailable listings after all available ones (sort=%s)",
    async (sort) => {
      seedAvailabilityFixture(ctx.app);

      const items = (
        await ctx.svc.searchListings({
          city: SEED_CITY,
          listing_type: "flat_house",
          sort
        })
      ).items as Array<{ id: string; is_available?: boolean }>;

      expect(items.length).toBe(3);

      // Every item must carry an explicit boolean is_available.
      items.forEach((item) => {
        expect(item).toHaveProperty("is_available");
        expect(typeof item.is_available).toBe("boolean");
      });

      const avail = items.map((i) => i.is_available);
      const firstFalse = avail.indexOf(false);
      // Sanity: the fixture actually contains an unavailable listing — otherwise
      // the "every available precedes every unavailable" check below would be
      // vacuously true and prove nothing.
      expect(firstFalse).not.toBe(-1);
      // Every `true` precedes every `false`: once we hit the first `false`,
      // nothing after it may be `true`.
      expect(avail.slice(firstFalse).every((v) => v === false)).toBe(true);
    }
  );

  it("never drops the unavailable listing — it still appears in results", async () => {
    const { unavailable } = seedAvailabilityFixture(ctx.app);

    const items = (
      await ctx.svc.searchListings({
        city: SEED_CITY,
        listing_type: "flat_house",
        sort: "newest"
      })
    ).items as Array<{ id: string }>;

    expect(items.some((i) => i.id === unavailable.id)).toBe(true);
  });

  /**
   * Task 17 consolidating assertion (flag-off / default-state safety net).
   *
   * `ff_unavailable_listings` does not gate the `availabilityOrder` CASE WHEN
   * key in `search.service.ts` directly (confirmed by reading the file —
   * it's unconditional on every sort branch, in both the SQL orderBy and the
   * in-memory comparator). The real flag-off guarantee instead comes from
   * the key being structurally a no-op whenever every row's `is_available`
   * is `true` — which is the DB column's `NOT NULL DEFAULT true` (migration
   * 0067) and therefore the only state reachable when the flag is off (the
   * owner/admin toggles that could ever set `is_available: false` are
   * themselves flag-gated in the UI — see
   * apps/web/components/owner/listing-availability-toggle.tsx and
   * apps/web/components/admin/homes/AdminHomeWorkspace.tsx). This test
   * proves that no-op claim directly: with every listing available, the
   * leading availability key evaluates to the same value (0) for every row,
   * so it cannot perturb the secondary sort key — the result must be
   * byte-for-byte the same order a pre-Task-9 sort (createdAt DESC only,
   * with no availability key at all) would have produced.
   */
  it("preserves the pre-feature order when every listing is available (flag-off safety net)", async () => {
    const now = Date.now();
    const ownerId = randomUUID();
    // Three distinct createdAt values, all available, seeded in a
    // deliberately shuffled insertion order so a passing assertion can't be
    // a coincidence of Map iteration order matching createdAt order.
    const middle: ListingRecord = {
      id: randomUUID(),
      ownerUserId: ownerId,
      listingType: "flat_house",
      title: "All-available Flat (middle)",
      city: SEED_CITY,
      monthlyRent: 18000,
      verificationStatus: "verified",
      status: "active",
      createdAt: now - 50_000,
      is_available: true
    };
    const newest: ListingRecord = {
      id: randomUUID(),
      ownerUserId: ownerId,
      listingType: "flat_house",
      title: "All-available Flat (newest)",
      city: SEED_CITY,
      monthlyRent: 19000,
      verificationStatus: "verified",
      status: "active",
      createdAt: now,
      is_available: true
    };
    const oldest: ListingRecord = {
      id: randomUUID(),
      ownerUserId: ownerId,
      listingType: "flat_house",
      title: "All-available Flat (oldest)",
      city: SEED_CITY,
      monthlyRent: 17000,
      verificationStatus: "verified",
      status: "active",
      createdAt: now - 100_000,
      is_available: true
    };
    [middle, newest, oldest].forEach((l) => ctx.app.listings.set(l.id, l));

    const items = (
      await ctx.svc.searchListings({
        city: SEED_CITY,
        listing_type: "flat_house",
        sort: "newest"
      })
    ).items as Array<{ id: string; is_available?: boolean }>;

    expect(items.map((i) => i.id)).toEqual([newest.id, middle.id, oldest.id]);
    // Every item is explicitly available — confirms the leading key really
    // was constant (0) across the whole result set, not coincidentally
    // absent from the comparison.
    items.forEach((item) => expect(item.is_available).toBe(true));
  });
});
