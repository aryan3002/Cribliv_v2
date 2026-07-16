import { describe, expect, it, vi } from "vitest";

import { SeoCopyService } from "../seo-copy.service";
import type { DatabaseService } from "../../../common/database.service";

const CACHE_ROW = {
  h1: "H1",
  meta_title: "MT",
  meta_description: "MD",
  intro_paragraph: "cached intro",
  nearby_blurb: null,
  faq_items: [],
  aggregates_hash: "abc123",
  expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
};

/** Minimal DatabaseService double that routes by which table the SQL hits. */
function makeDb(rowsByTable: { overrides?: unknown[]; copy?: unknown[] }): DatabaseService {
  return {
    isEnabled: () => true,
    query: vi.fn(async (sql: string) => {
      if (/seo_page_overrides/.test(sql)) return { rows: rowsByTable.overrides ?? [] };
      if (/seo_page_copy/.test(sql)) return { rows: rowsByTable.copy ?? [] };
      return { rows: [] };
    })
  } as unknown as DatabaseService;
}

describe("SeoCopyService.getStored", () => {
  it("returns null when neither override nor cache exists", async () => {
    const svc = new SeoCopyService(makeDb({}));
    expect(await svc.getStored("/city/lucknow/gomti-nagar", "en")).toBeNull();
  });

  it("returns cached copy when present and no override", async () => {
    const svc = new SeoCopyService(makeDb({ copy: [CACHE_ROW] }));
    const copy = await svc.getStored("/city/lucknow/gomti-nagar", "en");
    expect(copy?.intro_paragraph).toBe("cached intro");
  });

  it("prefers a manual override over the cache", async () => {
    const svc = new SeoCopyService(
      makeDb({
        overrides: [
          {
            h1: "Override H1",
            meta_title: null,
            meta_description: null,
            intro_paragraph: "override intro",
            nearby_blurb: null,
            faq_items: null
          }
        ],
        copy: [CACHE_ROW]
      })
    );
    const copy = await svc.getStored("/city/lucknow/gomti-nagar", "en");
    expect(copy?.intro_paragraph).toBe("override intro");
  });

  it("never triggers generation (no LLM) — only reads", async () => {
    const db = makeDb({});
    const svc = new SeoCopyService(db);
    await svc.getStored("/city/lucknow/x", "en");
    // exactly the two read queries (overrides + copy), no writes
    expect(
      (db.query as ReturnType<typeof vi.fn>).mock.calls.every(([sql]) => /SELECT/i.test(sql))
    ).toBe(true);
  });
});

describe("SeoCopyService.hasFreshCopy", () => {
  it("is false when no cache exists", async () => {
    const svc = new SeoCopyService(makeDb({}));
    expect(await svc.hasFreshCopy("/p", "en")).toBe(false);
  });

  it("is true when cached copy has not expired", async () => {
    const svc = new SeoCopyService(makeDb({ copy: [CACHE_ROW] }));
    expect(await svc.hasFreshCopy("/p", "en")).toBe(true);
  });

  it("is false when cached copy has expired", async () => {
    const expired = { ...CACHE_ROW, expires_at: new Date(Date.now() - 1000).toISOString() };
    const svc = new SeoCopyService(makeDb({ copy: [expired] }));
    expect(await svc.hasFreshCopy("/p", "en")).toBe(false);
  });
});
