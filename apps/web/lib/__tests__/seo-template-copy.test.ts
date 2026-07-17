import { describe, it, expect } from "vitest";
import { buildLocalityTemplateCopy, nearestMetroForLocality } from "../seo-template-copy";

const base = {
  locale: "en" as const,
  placeName: { en: "Gomti Nagar", hi: "गोमती नगर" },
  cityName: "Lucknow",
  aggregates: {
    listing_count: 8,
    median_rent_1bhk: 12000,
    median_rent_2bhk: 18000,
    median_rent_pg: 6000
  },
  nearestMetro: { station_name: "CCS Airport", line_name: "Red Line", dist: 2.3 }
};

describe("buildLocalityTemplateCopy", () => {
  it("builds English template copy from aggregates", () => {
    const c = buildLocalityTemplateCopy(base);
    expect(c.h1).toBe("Verified Rentals in Gomti Nagar, Lucknow");
    expect(c.meta_title).toBe("Rentals in Gomti Nagar, Lucknow · Cribliv");
    expect(c.meta_description).toContain("8+ verified PGs and flats in Gomti Nagar, Lucknow");
    expect(c.intro_paragraph).toContain("Gomti Nagar in Lucknow has 8 verified rentals");
    expect(c.intro_paragraph).toContain("₹12,000/mo");
    expect(c.faq_items).toHaveLength(4);
    expect(c.faq_items[0].q).toContain("1BHK in Gomti Nagar");
    expect(c.faq_items[0].a).toContain("₹12,000");
    expect(c.faq_items[2].a).toContain("CCS Airport");
    expect(c.nearby_blurb).toBe("");
  });

  it("builds Hindi template copy", () => {
    const c = buildLocalityTemplateCopy({ ...base, locale: "hi" });
    expect(c.h1).toContain("गोमती नगर");
    expect(c.meta_title).toContain("किराये");
    expect(c.faq_items).toHaveLength(4);
  });

  it("handles missing rents and metro gracefully", () => {
    const c = buildLocalityTemplateCopy({
      ...base,
      aggregates: {
        listing_count: 1,
        median_rent_1bhk: null,
        median_rent_2bhk: null,
        median_rent_pg: null
      },
      nearestMetro: null
    });
    expect(c.intro_paragraph).toContain("1 verified rental");
    expect(c.intro_paragraph).not.toContain("rentals on Cribliv");
    expect(c.faq_items[0].a).toContain("Not enough 1BHK data");
    expect(c.faq_items[2].a).toContain("No metro data");
  });
});

describe("nearestMetroForLocality", () => {
  it("returns the closest station with a distance", () => {
    const metros = [
      { station_name: "Far", line_name: "Blue Line", lat: 27.0, lng: 81.0 },
      { station_name: "Near", line_name: "Red Line", lat: 26.85, lng: 80.95 }
    ];
    const n = nearestMetroForLocality(metros, 26.8548, 80.9498);
    expect(n?.station_name).toBe("Near");
    expect(typeof n?.dist).toBe("number");
  });

  it("returns null when there are no metros or no coordinates", () => {
    expect(nearestMetroForLocality([], 26, 80)).toBeNull();
    expect(
      nearestMetroForLocality([{ station_name: "X", line_name: "Y", lat: 26, lng: 80 }], null, null)
    ).toBeNull();
  });
});
