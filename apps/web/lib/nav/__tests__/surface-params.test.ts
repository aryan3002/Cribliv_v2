import { describe, it, expect } from "vitest";
import { getIntent, ALL_INTENTS } from "../../intent-filters";
import { translateFilters, isPgIntent, SEARCH_PARAMS, PG_PARAMS } from "../surface-params";

function intent(slug: string) {
  const i = getIntent(slug);
  if (!i) throw new Error(`fixture intent missing: ${slug}`);
  return i;
}

describe("isPgIntent", () => {
  it("flags intents whose filter says listing_type=pg", () => {
    expect(isPgIntent(intent("pg"))).toBe(true);
    expect(isPgIntent(intent("pg-for-girls"))).toBe(true);
    expect(isPgIntent(intent("with-food"))).toBe(true);
    expect(isPgIntent(intent("co-living"))).toBe(true);
  });

  it("flags `rooms`, which sits in property-type but is really a PG intent", () => {
    expect(isPgIntent(intent("rooms"))).toBe(true);
  });

  it("does not flag flat/house intents", () => {
    expect(isPgIntent(intent("2bhk"))).toBe(false);
    expect(isPgIntent(intent("family-flats"))).toBe(false);
  });

  it("does not flag budget intents, which carry no listing_type", () => {
    expect(isPgIntent(intent("under-10000"))).toBe(false);
  });
});

describe("translateFilters — search surface", () => {
  it("passes through params the search API accepts", () => {
    expect(translateFilters(intent("2bhk").filters, "search")).toEqual({
      listing_type: "flat_house",
      bhk: "2"
    });
  });

  it("maps amenity=ac to the accepted ac param", () => {
    expect(translateFilters(intent("ac-rooms").filters, "search")).toEqual({ ac: "true" });
  });

  it("maps tag to a free-text q, since neither API has a tag filter", () => {
    expect(translateFilters(intent("pet-friendly").filters, "search")).toEqual({
      q: "pet-friendly"
    });
  });

  it("drops max_area_sqft, which no endpoint accepts, but keeps the rest", () => {
    expect(translateFilters(intent("studio").filters, "search")).toEqual({
      listing_type: "flat_house",
      bhk: "1"
    });
  });

  it("never emits a key the search API does not accept", () => {
    for (const i of ALL_INTENTS) {
      for (const key of Object.keys(translateFilters(i.filters, "search"))) {
        expect(SEARCH_PARAMS, `intent ${i.slug} emitted unknown param ${key}`).toContain(key);
      }
    }
  });
});

describe("translateFilters — pg surface", () => {
  it("drops listing_type entirely, so /search?listing_type=pg can never be built", () => {
    expect(translateFilters(intent("pg").filters, "pg")).toEqual({});
  });

  it("maps occupancy_type to the PG gender_policy vocabulary", () => {
    expect(translateFilters(intent("pg-for-girls").filters, "pg")).toEqual({
      gender_policy: "girls"
    });
    expect(translateFilters(intent("pg-for-boys").filters, "pg")).toEqual({
      gender_policy: "boys"
    });
    expect(translateFilters(intent("co-living").filters, "pg")).toEqual({
      gender_policy: "coed"
    });
  });

  it("passes food_included through", () => {
    expect(translateFilters(intent("with-food").filters, "pg")).toEqual({
      food_included: "true"
    });
  });

  it("passes budget through, which the PG search service does honour", () => {
    expect(translateFilters(intent("under-10000").filters, "pg")).toEqual({ max_rent: "10000" });
    expect(translateFilters(intent("luxury").filters, "pg")).toEqual({ min_rent: "25000" });
  });

  it("drops furnishing and bhk, which mean nothing to the PG endpoint", () => {
    expect(translateFilters(intent("furnished").filters, "pg")).toEqual({});
    expect(translateFilters(intent("2bhk").filters, "pg")).toEqual({});
  });

  it("never emits a key the PG API does not accept", () => {
    for (const i of ALL_INTENTS) {
      for (const key of Object.keys(translateFilters(i.filters, "pg"))) {
        expect(PG_PARAMS, `intent ${i.slug} emitted unknown param ${key}`).toContain(key);
      }
    }
  });
});
