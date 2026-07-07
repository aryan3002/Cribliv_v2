import { describe, it, expect } from "vitest";
import { buildArticle } from "../structured-data";

describe("buildArticle", () => {
  it("returns a schema.org Article with author + publisher", () => {
    const a = buildArticle({
      headline: "2BHK rent in Gomti Nagar",
      description: "What tenants pay",
      authorName: "Aditi Sharma",
      authorUrl: "/en/blog/author/aditi-sharma",
      datePublished: "2026-07-02",
      dateModified: "2026-07-03",
      image: "/images/blog/hero.jpg",
      url: "/en/blog/2bhk-rent-gomti-nagar"
    });
    expect(a["@type"]).toBe("Article");
    expect(a.headline).toBe("2BHK rent in Gomti Nagar");
    expect((a.author as Record<string, unknown>)["@type"]).toBe("Person");
    expect((a.author as Record<string, unknown>).name).toBe("Aditi Sharma");
    expect((a.publisher as Record<string, unknown>)["@type"]).toBe("Organization");
    expect(String(a.mainEntityOfPage)).toContain("/en/blog/2bhk-rent-gomti-nagar");
    expect(String((a.author as Record<string, unknown>).url)).toContain("/author/aditi-sharma");
  });

  it("defaults dateModified to datePublished and omits missing fields", () => {
    const a = buildArticle({
      headline: "Deposit rules",
      authorName: "Aditi Sharma",
      authorUrl: "/en/blog/author/aditi-sharma",
      datePublished: "2026-07-02",
      url: "/en/blog/deposit-rules"
    });
    expect(a.dateModified).toBe("2026-07-02");
    expect(a.image).toBeUndefined();
    expect(a.description).toBeUndefined();
  });
});
