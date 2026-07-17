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

const INPUTS = {
  pagePath: "/city/lucknow/gomti-nagar",
  locale: "en" as const,
  placeName: { en: "Gomti Nagar", hi: "गोमती नगर" },
  placeKind: "locality" as const,
  aggregates: { listing_count: 5 }
};

describe("SeoCopyService.getProvenance", () => {
  it("returns 'template' when neither override nor cache exists", async () => {
    const svc = new SeoCopyService(makeDb({}));
    expect(await svc.getProvenance("/city/lucknow/gomti-nagar", "en")).toBe("template");
  });

  it("returns 'ai' when a fresh cache row exists and no override", async () => {
    const svc = new SeoCopyService(makeDb({ copy: [CACHE_ROW] }));
    expect(await svc.getProvenance("/city/lucknow/gomti-nagar", "en")).toBe("ai");
  });

  it("returns 'template' when the only cache row has expired", async () => {
    const expired = { ...CACHE_ROW, expires_at: new Date(Date.now() - 1000).toISOString() };
    const svc = new SeoCopyService(makeDb({ copy: [expired] }));
    expect(await svc.getProvenance("/p", "en")).toBe("template");
  });

  it("returns 'override' when an override row exists, even a meta-only one alongside cache", async () => {
    const svc = new SeoCopyService(
      makeDb({ overrides: [{ meta_title: "Only meta" }], copy: [CACHE_ROW] })
    );
    expect(await svc.getProvenance("/p", "en")).toBe("override");
  });
});

describe("SeoCopyService.generateAndCache", () => {
  it("regenerates and writes the AI cache even when an override exists (no short-circuit)", async () => {
    const db = makeDb({
      overrides: [{ h1: "Override H1", intro_paragraph: "override intro" }],
      copy: []
    });
    const svc = new SeoCopyService(db);
    const FRESH = {
      h1: "Fresh",
      meta_title: "MT",
      meta_description: "MD",
      intro_paragraph: "fresh intro",
      nearby_blurb: null,
      faq_items: []
    };
    // Stub the private LLM call so no network happens.
    vi.spyOn(svc as unknown as { generate: () => Promise<unknown> }, "generate").mockResolvedValue(
      FRESH
    );
    const result = await svc.generateAndCache(INPUTS);
    expect(result).toEqual(FRESH);
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([sql]) => /INSERT INTO seo_page_copy/i.test(sql))).toBe(true);
  });

  it("returns null and writes nothing when generation fails", async () => {
    const db = makeDb({});
    const svc = new SeoCopyService(db);
    vi.spyOn(svc as unknown as { generate: () => Promise<unknown> }, "generate").mockResolvedValue(
      null
    );
    const result = await svc.generateAndCache(INPUTS);
    expect(result).toBeNull();
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.some(([sql]) => /INSERT INTO seo_page_copy/i.test(sql))).toBe(false);
  });
});

describe("SeoCopyService.upsertOverride", () => {
  it("upserts into seo_page_overrides with jsonb faq_items and updated_at", async () => {
    const db = makeDb({});
    const svc = new SeoCopyService(db);
    await svc.upsertOverride(
      "/city/lucknow/gomti-nagar",
      "en",
      {
        h1: "Custom H1",
        meta_title: "Custom MT",
        meta_description: "Custom MD",
        intro_paragraph: "custom intro",
        nearby_blurb: "around",
        faq_items: [{ q: "Q", a: "A" }]
      },
      "hand-written"
    );
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls;
    const insert = calls.find(([sql]) => /INSERT INTO seo_page_overrides/i.test(sql));
    expect(insert).toBeTruthy();
    const [sql, params] = insert as [string, unknown[]];
    expect(sql).toMatch(/ON CONFLICT \(page_path, locale\) DO UPDATE/i);
    expect(sql).toMatch(/::jsonb/);
    expect(sql).toMatch(/updated_at\s*=\s*now\(\)/i);
    expect(params[0]).toBe("/city/lucknow/gomti-nagar");
    expect(params[1]).toBe("en");
    expect(params[2]).toBe("Custom H1");
    expect(params).toContain("hand-written");
    expect(params.some((p) => typeof p === "string" && p.includes('"q":"Q"'))).toBe(true);
  });

  it("is a no-op when the database is disabled", async () => {
    const query = vi.fn();
    const disabled = { isEnabled: () => false, query } as unknown as DatabaseService;
    const svc = new SeoCopyService(disabled);
    await svc.upsertOverride("/p", "en", {
      h1: "",
      meta_title: "",
      meta_description: "",
      intro_paragraph: "",
      nearby_blurb: null,
      faq_items: []
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("SeoCopyService.deleteOverride", () => {
  it("deletes the override row for the page + locale", async () => {
    const db = makeDb({});
    const svc = new SeoCopyService(db);
    await svc.deleteOverride("/city/lucknow/gomti-nagar", "en");
    const calls = (db.query as ReturnType<typeof vi.fn>).mock.calls;
    const del = calls.find(([sql]) => /DELETE FROM seo_page_overrides/i.test(sql));
    expect(del).toBeTruthy();
    expect((del as [string, unknown[]])[1]).toEqual(["/city/lucknow/gomti-nagar", "en"]);
  });

  it("is a no-op when the database is disabled", async () => {
    const query = vi.fn();
    const disabled = { isEnabled: () => false, query } as unknown as DatabaseService;
    const svc = new SeoCopyService(disabled);
    await svc.deleteOverride("/p", "en");
    expect(query).not.toHaveBeenCalled();
  });
});
