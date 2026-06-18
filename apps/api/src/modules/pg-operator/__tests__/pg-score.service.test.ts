import { describe, it, expect, vi } from "vitest";
import { PgScoreService } from "../services/pg-score.service";

const isInsert = (sql: string) => /INSERT INTO listing_scores/.test(sql);
const isRead = (sql: string) => /FROM listings l/.test(sql);

function row(id: string) {
  return {
    listing_id: id,
    display_name: `PG ${id}`,
    verification_status: "verified",
    created_at: new Date().toISOString(),
    city_slug: "pune",
    lat: 18.5,
    gender_policy: "girls",
    tenant_type: "students",
    security_deposit_paise: 1_000_000,
    meals: null,
    amenities: null,
    house_rules: null,
    total_beds: 10,
    photo_count: 6,
    room_types: []
  };
}

/** Mock db that returns successive read pages; INSERTs resolve empty. */
function makeDb(readPages: any[][]) {
  const pages = [...readPages];
  const query = vi.fn(async (sql: string) => {
    if (isInsert(sql)) return { rows: [] } as any;
    return { rows: pages.shift() ?? [] } as any;
  });
  return { isEnabled: () => true, query } as any;
}

describe("PgScoreService SCORING_SELECT query", () => {
  it("excludes rejected photos from photo_count (ranking integrity: 6 rejected photos must not score as 6 approved)", async () => {
    // S3 fix: previously counted ALL photos including rejected ones, so a listing
    // with 6 rejected + 0 approved photos scored full photo points and ranked high.
    const db = makeDb([[]]); // empty page — we only care about the SQL shape
    const svc = new PgScoreService(db);
    await svc.recomputeActiveScores(500);

    const readSql = db.query.mock.calls.find((c: any[]) => isRead(c[0]))?.[0] as string;
    expect(readSql).toBeTruthy();
    // The photo_count subquery must filter out rejected photos.
    expect(readSql).toContain("moderation_status");
  });
});

describe("PgScoreService.recomputeActiveScores", () => {
  it("returns 0 without querying when the DB is disabled", async () => {
    const db = { isEnabled: () => false, query: vi.fn() } as any;
    const svc = new PgScoreService(db);
    expect(await svc.recomputeActiveScores()).toBe(0);
    expect(db.query).not.toHaveBeenCalled();
  });

  it("scores a page with ONE set-based UPSERT (no per-row writes)", async () => {
    const db = makeDb([[row("L1"), row("L2")]]); // one short page → stop
    const svc = new PgScoreService(db);
    const n = await svc.recomputeActiveScores(500);

    expect(n).toBe(2);
    const calls = db.query.mock.calls.map((c: any[]) => c[0] as string);
    const reads = calls.filter(isRead);
    const inserts = calls.filter(isInsert);

    // The whole point of PERF-H5: writes are set-based, not 1-per-listing.
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toContain("unnest(");
    expect(inserts[0]).toContain("ON CONFLICT (listing_id)");

    // Read is keyset + active-only + bounded.
    expect(reads[0]).toContain("status = 'active'");
    expect(reads[0]).toContain("l.id > $1::uuid");
    expect(reads[0]).toContain("LIMIT $2");

    // The UPSERT carries all ids of the page in the first (uuid[]) param.
    const insertParams = db.query.mock.calls.find((c: any[]) => isInsert(c[0]))![1];
    expect(insertParams[0]).toEqual(["L1", "L2"]);
  });

  it("keyset-pages until a short page, advancing the cursor by last id", async () => {
    const db = makeDb([[row("a"), row("b")], [row("c")]]); // full page, then short
    const svc = new PgScoreService(db);
    const n = await svc.recomputeActiveScores(2);

    expect(n).toBe(3);
    const reads = db.query.mock.calls.filter((c: any[]) => isRead(c[0]));
    const inserts = db.query.mock.calls.filter((c: any[]) => isInsert(c[0]));
    expect(reads).toHaveLength(2);
    expect(inserts).toHaveLength(2); // one set UPSERT per page
    // page 2 read starts after the last id of page 1 ("b").
    expect(reads[1][1][0]).toBe("b");
  });
});
