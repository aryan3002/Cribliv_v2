import { describe, it, expect } from "vitest";
import { buildArticle } from "../structured-data";

describe("buildArticle", () => {
  it("returns a schema.org Article with author + publisher", () => {
    const a = buildArticle({
      headline: "2BHK rent in Gomti Nagar",
      description: "What tenants pay",
      authorName: "Cribliv Data Desk",
      authorType: "Organization",
      authorUrl: "/en/blog/author/cribliv-data-desk",
      datePublished: "2026-07-02",
      dateModified: "2026-07-03",
      image: "/images/blog/hero.jpg",
      url: "/en/blog/2bhk-rent-gomti-nagar"
    });
    expect(a["@type"]).toBe("Article");
    expect(a.headline).toBe("2BHK rent in Gomti Nagar");
    expect((a.author as Record<string, unknown>)["@type"]).toBe("Organization");
    expect((a.author as Record<string, unknown>).name).toBe("Cribliv Data Desk");
    expect((a.publisher as Record<string, unknown>)["@type"]).toBe("Organization");
    expect(String(a.mainEntityOfPage)).toContain("/en/blog/2bhk-rent-gomti-nagar");
    expect(String((a.author as Record<string, unknown>).url)).toContain(
      "/author/cribliv-data-desk"
    );
  });

  it("defaults the author to a Person when no type is given", () => {
    const a = buildArticle({
      headline: "Guest column",
      authorName: "A Guest Writer",
      authorUrl: "/en/blog/author/cribliv-data-desk",
      datePublished: "2026-07-02",
      url: "/en/blog/guest-column"
    });
    expect((a.author as Record<string, unknown>)["@type"]).toBe("Person");
  });

  it("defaults dateModified to datePublished and omits missing fields", () => {
    const a = buildArticle({
      headline: "Deposit rules",
      authorName: "Cribliv Data Desk",
      authorUrl: "/en/blog/author/cribliv-data-desk",
      datePublished: "2026-07-02",
      url: "/en/blog/deposit-rules"
    });
    expect(a.dateModified).toBe("2026-07-02");
    expect(a.image).toBeUndefined();
    expect(a.description).toBeUndefined();
  });
});
