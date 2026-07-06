import { describe, it, expect, vi } from "vitest";
import { BlogGeneratorService } from "../src/modules/blog/blog-generator.service";
import type { BlogBriefRow } from "../src/modules/blog/blog.types";

const BRIEF: BlogBriefRow = {
  id: "b1",
  target_keyword: "2bhk rent gomti nagar",
  intent: "informational",
  outline: [{ heading: "Overview" }, { heading: "What tenants pay" }],
  required_data: [
    { key: "median_rent_2bhk", label: "Median 2BHK rent", value: 0 },
    { key: "median_rent_1bhk", label: "Median 1BHK rent", value: 0 },
    { key: "listing_count", label: "Active listings", value: 0 }
  ],
  internal_link_targets: [
    { href: "/city/lucknow/gomti-nagar", label: "Flats in Gomti Nagar" },
    { href: "/rent-in/lucknow", label: "Rentals in Lucknow" }
  ],
  source: "data_trend",
  status: "pending",
  city_slug: "lucknow",
  category_slug: "data-reports",
  post_type: "data_report",
  notes: null,
  created_at: "t",
  updated_at: "t"
};

function fakeAggregates() {
  return {
    aggregatesForLocality: vi.fn(async () => ({
      listing_count: 42,
      pg_count: 5,
      flat_count: 37,
      median_rent_pg: 7000,
      median_rent_1bhk: 11000,
      median_rent_2bhk: 18000,
      median_rent_3bhk: 26000
    })),
    localitiesForCity: vi.fn(async () => [{ slug: "gomti-nagar", name_en: "Gomti Nagar" }])
  } as never;
}

function fakeCallJson() {
  return vi.fn(async (opts: { system: string; user: string }) => {
    if (/outline/i.test(opts.system)) {
      return { sections: [{ heading: "Overview" }, { heading: "What tenants pay" }] };
    }
    if (/section/i.test(opts.system)) {
      return {
        html:
          "<p>The median 2BHK rent in Gomti Nagar is ₹18,000, the 1BHK median is ₹11,000, " +
          "and there are 42 active listings. " +
          'See more <a href="/city/lucknow/gomti-nagar">flats in Gomti Nagar</a> and ' +
          '<a href="/rent-in/lucknow">rentals in Lucknow</a> and ' +
          '<a href="/city/lucknow/metro/gomti-nagar">metro homes</a>. ' +
          "Gomti Nagar has parks and reliable supply. ".repeat(160) +
          "</p>"
      };
    }
    if (/fact/i.test(opts.system)) {
      return { ok: true, removed: [], html_unchanged: true };
    }
    if (/seo|readability/i.test(opts.system)) {
      return {
        title: "2BHK rent in Gomti Nagar - Cribliv",
        h1: "2BHK rent in Gomti Nagar",
        meta_title: "2BHK rent in Gomti Nagar - Cribliv",
        meta_description:
          "The median 2BHK rent in Gomti Nagar is ₹18,000. See live listings and what tenants really pay in this Lucknow neighbourhood guide.",
        excerpt: "What tenants really pay for a 2BHK in Gomti Nagar, from live listings.",
        faq_items: [{ q: "Average 2BHK rent in Gomti Nagar?", a: "About ₹18,000." }],
        body_hi: "<p>गोमती नगर में 2BHK का औसत किराया ₹18,000 है।</p>"
      };
    }
    return null;
  });
}

describe("BlogGeneratorService", () => {
  it("buildDataFacts pulls live aggregates for the brief's locality", async () => {
    const svc = new BlogGeneratorService(fakeAggregates(), fakeCallJson() as never);
    const facts = await svc.buildDataFacts(BRIEF);
    const byKey = Object.fromEntries(facts.map((f) => [f.key, f.value]));
    expect(byKey.median_rent_2bhk).toBe(18000);
    expect(byKey.listing_count).toBe(42);
  });

  it("generate runs all four steps and produces a gate-passing data post", async () => {
    const call = fakeCallJson();
    const svc = new BlogGeneratorService(fakeAggregates(), call as never);
    const post = await svc.generate(BRIEF, 0.4);
    expect(post).not.toBeNull();
    expect(post!.isDataPost).toBe(true);

    const sectionCall = call.mock.calls.find((c) => /section/i.test(c[0].system));
    expect(sectionCall).toBeTruthy();
    expect(String(sectionCall![0].user)).toContain("18000");
    expect(post!.quality.passed).toBe(true);
    expect(post!.citedDataPointCount).toBeGreaterThanOrEqual(3);
    expect(post!.bodyEn).toContain("₹18,000");
    expect(post!.slug).toBe("2bhk-rent-gomti-nagar");
  });

  it("generate returns null when the outline step fails", async () => {
    const call = vi.fn(async () => null);
    const svc = new BlogGeneratorService(fakeAggregates(), call as never);
    await expect(svc.generate(BRIEF)).resolves.toBeNull();
  });

  it("marks a too-short draft as gate-failed (not thrown)", async () => {
    const call = vi.fn(async (opts: { system: string }) => {
      if (/outline/i.test(opts.system)) return { sections: [{ heading: "X" }] };
      if (/section/i.test(opts.system)) return { html: "<p>Too short. ₹1.</p>" };
      if (/fact/i.test(opts.system)) return { ok: true, removed: [], html_unchanged: true };
      if (/seo|readability/i.test(opts.system)) {
        return {
          title: "2bhk rent gomti nagar - Cribliv",
          h1: "2bhk rent gomti nagar",
          meta_title: "t",
          meta_description: "d",
          excerpt: "e",
          faq_items: [],
          body_hi: "<p>x</p>"
        };
      }
      return null;
    });
    const svc = new BlogGeneratorService(fakeAggregates(), call as never);
    const post = await svc.generate(BRIEF);
    expect(post).not.toBeNull();
    expect(post!.quality.passed).toBe(false);
  });
});
