import { describe, it, expect, vi } from "vitest";
import { PgDraftService } from "../src/modules/pg-operator/services/pg-draft.service";

const PAYLOAD = {
  property: { display_name: "A", city_slug: "lucknow" },
  pg_details: { total_beds: 4 },
  room_types: []
} as any;

function db(rows: Record<string, any[]>) {
  return {
    isEnabled: () => true,
    query: vi.fn(async (sql: string) => {
      if (/INSERT INTO pg_listing_drafts/i.test(sql))
        return { rows: [{ id: "d1", updated_at: "2026-06-01T00:00:00Z" }] };
      if (/SELECT[\s\S]*FROM pg_listing_drafts[\s\S]*WHERE id/i.test(sql))
        return { rows: rows.get ?? [] };
      if (/SELECT[\s\S]*FROM pg_listing_drafts/i.test(sql)) return { rows: rows.list ?? [] };
      return { rows: [] };
    })
  } as any;
}

describe("PgDraftService", () => {
  it("upserts and returns draft_id + updated_at", async () => {
    const svc = new PgDraftService(db({}));
    const r = await svc.upsert("op-1", { payload: PAYLOAD, source: "manual" });
    expect(r.draft_id).toBe("d1");
    expect(r.updated_at).toBeTruthy();
  });
  it("get returns null for cross-operator draft", async () => {
    const svc = new PgDraftService(db({ get: [] }));
    const r = await svc.get("op-2", "d1");
    expect(r).toBeNull();
  });
  it("list returns operator drafts", async () => {
    const svc = new PgDraftService(
      db({
        list: [{ draft_id: "d1", display_name: "A", updated_at: "t", committed_listing_id: null }]
      })
    );
    const r = await svc.list("op-1");
    expect(r).toHaveLength(1);
  });
});
