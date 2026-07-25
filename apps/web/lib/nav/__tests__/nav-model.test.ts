import { describe, it, expect } from "vitest";
import {
  buildRentPanel,
  buildPgPanel,
  buildOwnersPanel,
  buildTimesPanel,
  cityChipLinks,
  type NavPanel
} from "../nav-model";
import { HUB_CITY_SLUGS } from "../cities";
import { BLOG_DESKS } from "../../blog-desks";
import { localityLinks } from "../localities";
import { PG_CITY_CONTENT } from "../../pg-city-content";

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
  it("has the five approved columns, localized per locale", () => {
    const panel = buildRentPanel("en", "lucknow");
    expect(panel.id).toBe("rent");

    const expectedTitles: Record<"en" | "hi", string[]> = {
      en: ["Property type", "By budget", "By lifestyle", "Popular localities"],
      hi: ["प्रॉपर्टी का प्रकार", "बजट", "लाइफस्टाइल", "लोकप्रिय इलाके"]
    };
    for (const locale of LOCALES) {
      expect(buildRentPanel(locale, "lucknow").columns.map((c) => c.title)).toEqual(
        expectedTitles[locale]
      );
    }
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
  });

  it("omits listing_type from Rent links — /search hard-forces flat_house anyway, and the param only renders a filter chip whose remove is a no-op", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const link of allLinks(buildRentPanel(locale, city))) {
          expect(link.href, link.label).not.toContain("listing_type=");
        }
      }
    }
  });

  it("still narrows Rent links by their real filters", () => {
    const twoBhk = allLinks(buildRentPanel("en", "lucknow")).find((l) => l.label === "2 BHK flats");
    expect(twoBhk).toBeDefined();
    expect(twoBhk!.href).toContain("/en/search?");
    expect(twoBhk!.href).toContain("city=lucknow");
    expect(twoBhk!.href).toContain("bhk=2");
  });

  it("uses Hindi labels for the hi locale", () => {
    const labels = allLinks(buildRentPanel("hi", "lucknow")).map((l) => l.label);
    expect(labels).toContain("2 बीएचके फ्लैट");
    expect(labels).not.toContain("2 BHK flats");
  });
});

describe("buildPgPanel", () => {
  it("has the approved columns including budget, localized per locale", () => {
    const panel = buildPgPanel("en", "lucknow");
    expect(panel.id).toBe("pg");

    const expectedTitles: Record<"en" | "hi", string[]> = {
      en: ["By sharing", "By who it's for", "By budget", "Food & amenities", "Popular PG hubs"],
      hi: ["शेयरिंग", "किसके लिए", "बजट", "खाना और सुविधाएं", "लोकप्रिय पीजी हब"]
    };
    for (const locale of LOCALES) {
      expect(buildPgPanel(locale, "lucknow").columns.map((c) => c.title)).toEqual(
        expectedTitles[locale]
      );
    }
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
    expect(hrefs).toContain("/en/blog/category/tenancy");
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

// Fix 2 (final-review wave): only one Rent intent and one Times desk were ever
// asserted in Hindi. This walks every panel's links position-by-position and
// requires the hi label to differ from its en counterpart wherever the
// underlying data actually carries a translation. Locality display names and
// PG hub names have no Hindi variant at all — they are plain strings pulled
// from RENT_CITY_CONTENT / the Lucknow micro-localities seed / PG_CITY_CONTENT
// — so they legitimately coincide between locales. `allowedToCoincide` is the
// escape hatch for exactly those proper nouns, not a general bypass: anything
// else that comes out identical in both locales is a real bug.
function assertLocalesDiffer(
  panelId: string,
  enPanel: NavPanel,
  hiPanel: NavPanel,
  allowedToCoincide: ReadonlySet<string>
) {
  expect(hiPanel.columns.length, `${panelId}: column count differs between locales`).toBe(
    enPanel.columns.length
  );
  enPanel.columns.forEach((column, columnIndex) => {
    const hiColumn = hiPanel.columns[columnIndex];
    expect(
      hiColumn.links.length,
      `${panelId}/"${column.title}": link count differs between locales`
    ).toBe(column.links.length);
    column.links.forEach((enLink, linkIndex) => {
      const hiLink = hiColumn.links[linkIndex];
      const identical = enLink.label === hiLink.label;
      expect(
        identical && !allowedToCoincide.has(enLink.label),
        `${panelId}/"${column.title}": link "${enLink.label}" (${enLink.href}) is not translated into Hindi`
      ).toBe(false);
    });
  });
}

/** Locality names and PG hub names are proper nouns with no Hindi variant. */
function properNounsFor(citySlug: string): Set<string> {
  const nouns = new Set<string>();
  for (const link of localityLinks("en", citySlug)) nouns.add(link.label);
  for (const hub of PG_CITY_CONTENT[citySlug]?.hubs ?? []) nouns.add(hub);
  return nouns;
}

describe("spec §C2 — Hindi actually differs from English, across every panel", () => {
  it("buildRentPanel: every hi label differs from its en counterpart, except locality names", () => {
    for (const city of HUB_CITY_SLUGS) {
      assertLocalesDiffer(
        "rent",
        buildRentPanel("en", city),
        buildRentPanel("hi", city),
        properNounsFor(city)
      );
    }
  });

  it("buildPgPanel: every hi label differs from its en counterpart, except PG hub names", () => {
    for (const city of HUB_CITY_SLUGS) {
      assertLocalesDiffer(
        "pg",
        buildPgPanel("en", city),
        buildPgPanel("hi", city),
        properNounsFor(city)
      );
    }
  });

  it("buildOwnersPanel: every hi label differs from its en counterpart", () => {
    assertLocalesDiffer("owners", buildOwnersPanel("en"), buildOwnersPanel("hi"), new Set());
  });

  it("buildTimesPanel: every hi label differs from its en counterpart", () => {
    assertLocalesDiffer("times", buildTimesPanel("en"), buildTimesPanel("hi"), new Set());
  });
});

// Fix 4 (final-review wave): bySlugs() silently filters out unknown slugs and
// inCategory() silently returns [] for a renamed category — neither is a type
// error, because the category union in intent-filters.ts is hand-written over
// an `as unknown as` cast on the JSON. Without a pinned count, an entire
// column (e.g. "By lifestyle") could quietly go to zero links and every other
// assertion in this file would stay green. These counts are derived from
// data/seeds/lucknow/intents.json + PG_CITY_CONTENT and are locale-invariant
// (filtering never depends on locale), so pinning against "en" is sufficient.
describe("spec — column cardinality is pinned", () => {
  it("every column of every panel has at least one link, for every hub city and locale", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const panel of everyPanel(locale, city)) {
          for (const column of panel.columns) {
            expect(
              column.links.length,
              `${panel.id}/"${column.title}" (${locale}/${city}) has no links`
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("never offers two links to the same URL within a column", () => {
    for (const locale of LOCALES) {
      for (const city of HUB_CITY_SLUGS) {
        for (const panel of everyPanel(locale, city)) {
          for (const col of panel.columns) {
            const hrefs = col.links.map((l) => l.href);
            expect(new Set(hrefs).size, `${panel.id} / ${col.title} has duplicate hrefs`).toBe(
              hrefs.length
            );
          }
        }
      }
    }
  });

  it("drops `studio`, whose only distinguishing filter no endpoint accepts", () => {
    // studio is {listing_type: flat_house, bhk: 1, max_area_sqft: 450}. Neither
    // /listings/search nor /pg/listings has an area filter, so max_area_sqft is
    // dropped and studio collapses onto 1bhk's exact URL. dedupeByHref removes
    // it. If an area filter is ever added, studio becomes distinct and this
    // test fails — which is the signal to re-pin the counts above.
    const labels = allLinks(buildRentPanel("en", "lucknow")).map((l) => l.label);
    expect(labels).toContain("1 BHK flats");
    expect(labels).not.toContain("Studio apartments");
  });

  it("pins buildRentPanel's per-column link counts", () => {
    // [Property type, By budget, By lifestyle, Popular localities]. Property
    // type's 4 = 6 category intents, minus `pg` and `rooms` (both listing_type
    // =pg), minus `studio` which dedupeByHref removes — see the dedupe test
    // below. Lifestyle's 7 = 5 category-derived (furnished/semi/unfurnished/
    // pet-friendly/ac-rooms) + family-flats + bachelor-flats via bySlugs —
    // losing either of the last two, or ac-rooms, drops this to 6 or fewer.
    for (const city of HUB_CITY_SLUGS) {
      const counts = buildRentPanel("en", city).columns.map((c) => c.links.length);
      expect(counts, city).toEqual([4, 5, 7, 8]);
    }
  });

  it("pins buildPgPanel's per-column link counts", () => {
    // [By sharing, By who it's for, By budget, Food & amenities, Popular PG
    // hubs]. Food & amenities' 4 = with-food/vegetarian-pg/ac-rooms/co-living
    // via bySlugs — losing vegetarian-pg or ac-rooms drops this to 3.
    for (const city of HUB_CITY_SLUGS) {
      const counts = buildPgPanel("en", city).columns.map((c) => c.links.length);
      expect(counts, city).toEqual([4, 4, 5, 4, 6]);
    }
  });

  it("pins buildOwnersPanel's per-column link counts", () => {
    // [List your property, Pricing, Tools, Learn]. Learn is 3 after Fix 5
    // added the /blog/category/tenancy link.
    const counts = buildOwnersPanel("en").columns.map((c) => c.links.length);
    expect(counts).toEqual([2, 1, 1, 3]);
  });

  it("pins buildTimesPanel's per-column link count", () => {
    const counts = buildTimesPanel("en").columns.map((c) => c.links.length);
    expect(counts).toEqual([4]);
  });
});
