import { describe, it, expect } from "vitest";
import {
  buildRentPanel,
  buildPgPanel,
  buildOwnersPanel,
  buildTimesPanel,
  cityChipLinks
} from "../nav-model";
import { HUB_CITY_SLUGS } from "../cities";
import { BLOG_DESKS } from "../../blog-desks";

const LOCALES = ["en", "hi"] as const;

function allLinks(panel: { columns: { links: { href: string; label: string }[] }[] }) {
  return panel.columns.flatMap((c) => c.links);
}

function everyPanel(locale: "en" | "hi", city: string) {
  return [
    buildRentPanel(locale, city),
    buildPgPanel(locale, city),
    buildOwnersPanel(locale),
    buildTimesPanel(locale)
  ];
}

describe("spec §C2 — link correctness", () => {
  it("never emits /search?listing_type=pg on any panel, city or locale", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const panel of everyPanel(locale, city)) {
          for (const link of allLinks(panel)) {
            expect(link.href, `${panel.id}/${link.label}`).not.toMatch(
              /\/search\?[^#]*listing_type=pg/
            );
          }
        }
      }
    }
  });

  it("never links to varanasi", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const panel of everyPanel(locale, city)) {
          for (const link of allLinks(panel)) {
            expect(link.href).not.toContain("varanasi");
          }
        }
      }
    }
  });

  it("prefixes every href with the locale", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const panel of everyPanel(locale, city)) {
          for (const link of allLinks(panel)) {
            expect(link.href.startsWith(`/${locale}/`), link.href).toBe(true);
          }
        }
      }
    }
  });

  it("gives every link a non-empty label", () => {
    for (const locale of LOCALES) {
      for (const panel of everyPanel(locale, "lucknow")) {
        for (const link of allLinks(panel)) expect(link.label.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("buildRentPanel", () => {
  it("has the five approved columns", () => {
    const panel = buildRentPanel("en", "lucknow");
    expect(panel.id).toBe("rent");
    expect(panel.columns.map((c) => c.title)).toEqual([
      "Property type",
      "By budget",
      "By lifestyle",
      "Popular localities"
    ]);
  });

  it("excludes `rooms`, a PG intent that lives in the property-type category", () => {
    const labels = allLinks(buildRentPanel("en", "lucknow")).map((l) => l.label);
    expect(labels).not.toContain("Single rooms");
    expect(labels).not.toContain("PG accommodations");
  });

  it("includes the flat/house property types", () => {
    const labels = allLinks(buildRentPanel("en", "lucknow")).map((l) => l.label);
    expect(labels).toContain("2 BHK flats");
    expect(labels).toContain("Flats & houses");
  });

  it("points intent links at /search with the city applied", () => {
    const twoBhk = allLinks(buildRentPanel("en", "lucknow")).find((l) => l.label === "2 BHK flats");
    expect(twoBhk).toBeDefined();
    expect(twoBhk!.href).toContain("/en/search?");
    expect(twoBhk!.href).toContain("city=lucknow");
    expect(twoBhk!.href).toContain("bhk=2");
    expect(twoBhk!.href).toContain("listing_type=flat_house");
  });

  it("uses Hindi labels for the hi locale", () => {
    const labels = allLinks(buildRentPanel("hi", "lucknow")).map((l) => l.label);
    expect(labels).toContain("2 बीएचके फ्लैट");
    expect(labels).not.toContain("2 BHK flats");
  });
});

describe("buildPgPanel", () => {
  it("has the approved columns including budget", () => {
    const panel = buildPgPanel("en", "lucknow");
    expect(panel.id).toBe("pg");
    expect(panel.columns.map((c) => c.title)).toEqual([
      "By sharing",
      "By who it's for",
      "By budget",
      "Food & amenities",
      "Popular PG hubs"
    ]);
  });

  it("sends every link to /pg, never /search", () => {
    for (const link of allLinks(buildPgPanel("en", "lucknow"))) {
      expect(link.href).toMatch(/^\/en\/pg(\?|$)/);
    }
  });

  it("offers the four sharing kinds the PG API accepts", () => {
    const sharing = buildPgPanel("en", "lucknow").columns[0];
    expect(sharing.links.map((l) => l.href.match(/sharing=(\w+)/)?.[1])).toEqual([
      "single",
      "double",
      "triple",
      "quad"
    ]);
  });

  it("translates girls/boys/co-living into the gender_policy vocabulary", () => {
    const hrefs = allLinks(buildPgPanel("en", "lucknow")).map((l) => l.href);
    expect(hrefs.some((h) => h.includes("gender_policy=girls"))).toBe(true);
    expect(hrefs.some((h) => h.includes("gender_policy=boys"))).toBe(true);
    expect(hrefs.some((h) => h.includes("gender_policy=coed"))).toBe(true);
    expect(hrefs.some((h) => h.includes("occupancy_type="))).toBe(false);
  });

  it("includes budget links, which pg-search.service.ts does honour", () => {
    const budget = buildPgPanel("en", "lucknow").columns[2];
    expect(budget.links.length).toBeGreaterThan(0);
    expect(budget.links.some((l) => l.href.includes("max_rent=10000"))).toBe(true);
  });

  it("draws PG hubs from PG_CITY_CONTENT", () => {
    const hubs = buildPgPanel("en", "delhi").columns[4];
    expect(hubs.links.map((l) => l.label)).toContain("North Campus");
  });
});

describe("buildOwnersPanel and buildTimesPanel", () => {
  it("owners links point at real static routes", () => {
    const hrefs = allLinks(buildOwnersPanel("en")).map((l) => l.href);
    expect(hrefs).toContain("/en/become-owner");
    expect(hrefs).toContain("/en/pg-operator/become");
    expect(hrefs).toContain("/en/pricing");
    expect(hrefs).toContain("/en/rent-agreement");
    expect(hrefs).toContain("/en/how-it-works");
    expect(hrefs).toContain("/en/faq");
  });

  it("times links point at the four real blog desks", () => {
    const hrefs = allLinks(buildTimesPanel("en")).map((l) => l.href);
    expect(hrefs).toEqual([
      "/en/blog/category/data-reports",
      "/en/blog/category/local-guides",
      "/en/blog/category/tenancy",
      "/en/blog/category/market-updates"
    ]);
  });

  it("times uses Hindi desk labels for hi", () => {
    expect(allLinks(buildTimesPanel("hi")).map((l) => l.label)).toContain("डेटा रिपोर्ट");
  });

  it("times panel and the shared desk list cannot drift apart", () => {
    const links = buildTimesPanel("en").columns[0].links;
    expect(links.map((l) => l.href.split("/").pop())).toEqual(BLOG_DESKS.map((d) => d.slug));
    expect(links.map((l) => l.label)).toEqual(BLOG_DESKS.map((d) => d.en));
  });
});

describe("cityChipLinks", () => {
  it("lists the 8 hub cities pointing at their city hubs", () => {
    const links = cityChipLinks("en");
    expect(links).toHaveLength(8);
    expect(links[0]).toEqual({ label: "Delhi", href: "/en/city/delhi" });
    expect(links.map((l) => l.label)).not.toContain("Varanasi");
  });
});
