import { describe, expect, it } from "vitest";
import { SeoCopyService } from "../src/modules/seo/seo-copy.service";

/**
 * The service returns copy as PLAIN text. It intentionally does NOT HTML-escape:
 * escaping here double-encoded entities on the page (an "&" rendered as
 * "&amp;amp;"), because the copy is shown as React text (safe via textContent)
 * and embedded in JSON-LD via `jsonLdSafe` on the web. Output safety is the
 * render layer's job, not this service's.
 */
describe("SeoCopyService output", () => {
  it("returns cached copy as plain, trimmed text (no HTML entity encoding)", async () => {
    const db = {
      isEnabled: () => true,
      query: async (sql: string) => {
        if (/FROM seo_page_overrides/i.test(sql)) return { rows: [] };
        if (/FROM seo_page_copy/i.test(sql)) {
          return {
            rows: [
              {
                h1: "Flats for Rent in LDA Colony — 1BHK & 2BHK",
                meta_title: "1BHK & 2BHK flats in LDA Colony",
                meta_description: "Rent flats from ₹4,750/mo. Owners & PGs.",
                intro_paragraph: "  Peaceful locality with families & students.  ",
                nearby_blurb: "Near Rajajipuram & Kanpur Road.",
                faq_items: [{ q: "1BHK cost?", a: "Around ₹4,750/mo" }],
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

    // Ampersands stay literal — no "&amp;" (the old double-encoding bug).
    expect(copy?.h1).toBe("Flats for Rent in LDA Colony — 1BHK & 2BHK");
    expect(copy?.meta_title).not.toContain("&amp;");
    expect(copy?.faq_items[0]?.a).toBe("Around ₹4,750/mo");
    // Whitespace is trimmed.
    expect(copy?.intro_paragraph).toBe("Peaceful locality with families & students.");
  });
});
