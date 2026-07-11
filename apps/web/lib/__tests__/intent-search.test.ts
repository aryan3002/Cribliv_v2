import { describe, expect, it } from "vitest";
import { buildIntentCountPath, buildIntentSearchHref, parseIntentSearch } from "../intent-search";

const dictionary = {
  cities: ["lucknow", "noida"],
  localities: ["gomti-nagar", "hazratganj"]
};

describe("intent search helpers", () => {
  it("builds a homes URL from parsed filters and preserves unrelated refinements", () => {
    expect(
      buildIntentSearchHref(
        "en",
        "homes",
        { sort: "verified", verified_only: "true", page: "3", city: "noida", q: "old query" },
        "2BHK Lucknow under 20k semi furnished",
        dictionary
      )
    ).toBe(
      "/en/search?sort=verified&verified_only=true&bhk=2&city=lucknow&max_rent=20000&furnishing=semi_furnished"
    );
  });

  it("routes a PG intent to the PG surface instead of leaving listing type in the URL", () => {
    expect(buildIntentSearchHref("en", "homes", {}, "PG in Lucknow under 10k", dictionary)).toBe(
      "/en/pg?city=lucknow&max_rent=10000"
    );
  });

  it("keeps unparsed words as a keyword query alongside structured filters", () => {
    expect(
      buildIntentSearchHref(
        "en",
        "homes",
        { sort: "newest" },
        "2BHK Gomti Nagar balcony",
        dictionary
      )
    ).toBe("/en/search?sort=newest&bhk=2&locality=gomti-nagar&q=balcony");
  });

  it("builds a count path for the parsed target segment", () => {
    const parsed = parseIntentSearch("PG in Lucknow under 10k", dictionary);

    expect(buildIntentCountPath(parsed)).toBe(
      "/listings/search?city=lucknow&max_rent=10000&listing_type=pg&page=1&page_size=1"
    );
  });
});
