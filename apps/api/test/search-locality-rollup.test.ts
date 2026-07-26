import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchService } from "../src/modules/search/search.service";
import {
  LOCALITY_SUBTREE_RECURSE_SQL,
  SeoAggregatesService
} from "../src/modules/seo/seo-aggregates.service";
import type { AppStateService } from "../src/common/app-state.service";
import type { DatabaseService } from "../src/common/database.service";

/**
 * The consistency invariant.
 *
 * PR 2 credits a parent locality with its descendants' listings, which is what
 * decides `indexable`. If the `locality=` search filter did NOT roll up
 * identically, a parent page would be indexable while rendering an empty grid —
 * precisely the metadata-contradicts-content bug this work exists to remove.
 *
 * These assertions are on the emitted SQL, so they hold without a database.
 */
function makeSearchService(query: ReturnType<typeof vi.fn>) {
  const app = {} as unknown as AppStateService;
  const db = { isEnabled: () => true, query } as unknown as DatabaseService;
  return new SearchService(app, db, {} as never, {} as never, {} as never, {} as never);
}

describe("locality rollup consistency between search and indexability", () => {
  let query: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    query = vi.fn(async () => ({ rows: [] }));
  });

  it("the locality= filter selects the whole subtree, not just an exact slug match", async () => {
    const svc = makeSearchService(query);

    await svc.searchListings({ city: "lucknow", locality: "gomti-nagar" } as never);

    const allSql = query.mock.calls.map(([sql]) => String(sql)).join("\n---\n");

    // Rolls up: matches listings tagged to the locality OR any descendant.
    expect(allSql).toContain("WITH RECURSIVE");
    expect(allSql).toContain("ll.locality_id IN");
    // The old exact-match predicate must be gone from the filter.
    expect(allSql).not.toMatch(/clauses[\s\S]*loc\.slug = \$/);
  });

  it("search and the indexability count share one depth expression", async () => {
    const svc = makeSearchService(query);
    await svc.searchListings({ city: "lucknow", locality: "gomti-nagar" } as never);
    const searchSql = query.mock.calls.map(([sql]) => String(sql)).join("\n");

    const aggQuery = vi.fn(async () => ({ rows: [] }));
    const aggregates = new SeoAggregatesService({
      isEnabled: () => true,
      query: aggQuery
    } as never);
    await aggregates.localitiesForCity("lucknow");
    const countSql = String(aggQuery.mock.calls[0][0]);

    // Both must recurse on the same hierarchy expression. If someone changes one
    // to parent-only, this fails rather than silently producing empty indexable
    // pages in production.
    expect(searchSql).toContain(LOCALITY_SUBTREE_RECURSE_SQL);
    expect(countSql).toContain(LOCALITY_SUBTREE_RECURSE_SQL);
  });

  it("does not add the recursive subtree when no locality filter is requested", async () => {
    const svc = makeSearchService(query);

    await svc.searchListings({ city: "lucknow" } as never);

    const allSql = query.mock.calls.map(([sql]) => String(sql)).join("\n");
    expect(allSql).not.toContain("ll.locality_id IN");
  });
});
