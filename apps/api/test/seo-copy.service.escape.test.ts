import { describe, expect, it } from "vitest";
import { SeoCopyService } from "../src/modules/seo/seo-copy.service";

describe("SeoCopyService output escaping", () => {
  it("escapes cached copy fields before returning", async () => {
    const db = {
      isEnabled: () => true,
      query: async (sql: string) => {
        if (/FROM seo_page_overrides/i.test(sql)) return { rows: [] };
        if (/FROM seo_page_copy/i.test(sql)) {
          return {
            rows: [
              {
                h1: "<script>alert(1)</script>",
                meta_title: "Title <b>bold</b>",
                meta_description: "Desc <img src=x onerror=alert(1)>",
                intro_paragraph: "Hello <iframe></iframe>",
                nearby_blurb: "<div>Nearby</div>",
                faq_items: [{ q: "<q>", a: "<a>" }],
                aggregates_hash: "4f0cce6f980d1f95",
                expires_at: new Date(Date.now() + 60_000).toISOString()
              }
            ]
          };
        }
        return { rows: [] };
      }
    } as any;

    const svc = new SeoCopyService(db);
    const copy = await svc.getOrGenerate({
      pagePath: "/seo/lucknow",
      locale: "en",
      placeName: { en: "Lucknow", hi: "लखनऊ" },
      placeKind: "city",
      aggregates: { listing_count: 1 }
    });

    expect(copy?.h1).toContain("&lt;script&gt;");
    expect(copy?.meta_description).not.toContain("<img");
    expect(copy?.faq_items[0]?.q).toBe("&lt;q&gt;");
  });
});
