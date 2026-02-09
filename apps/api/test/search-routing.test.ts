import { describe, expect, it } from "vitest";
import { SearchService } from "../src/modules/search/search.service";
import { AppStateService } from "../src/common/app-state.service";
import { DatabaseService } from "../src/common/database.service";

function createService() {
  delete process.env.DATABASE_URL;
  return new SearchService(new AppStateService(), new DatabaseService());
}

describe("SearchService routeQuery", () => {
  it("parses Hindi/Hinglish query into city/type/bhk/max_rent filters", () => {
    const service = createService();
    const result = service.routeQuery("Noida me 2BHK 25k tak", "en");

    expect(result.route).toBe("/search");
    expect(result.filters).toMatchObject({
      city: "noida",
      listing_type: "flat_house",
      bhk: 2,
      max_rent: 25000
    });
    expect(result.clarifying_question).toBeUndefined();
  });

  it("routes city-only query to city browse page", () => {
    const service = createService();
    const result = service.routeQuery("दिल्ली", "hi");

    expect(result.intent).toBe("city_browse");
    expect(result.route).toBe("/city/delhi");
    expect(result.filters).toMatchObject({ city: "delhi" });
  });

  it("routes post intent to owner dashboard", () => {
    const service = createService();
    const result = service.routeQuery("I want to post my flat in gurgaon", "en");

    expect(result.intent).toBe("post_listing");
    expect(result.route).toBe("/owner/dashboard");
  });

  it("routes uuid-like query directly to listing detail", () => {
    const service = createService();
    const listingId = "11a9357e-b130-4f64-8cb9-3f91595f5f19";
    const result = service.routeQuery(`show listing ${listingId}`, "en");

    expect(result.intent).toBe("open_listing");
    expect(result.route).toBe(`/listing/${listingId}`);
  });

  it("asks clarification when city and type are missing", () => {
    const service = createService();
    const result = service.routeQuery("near metro under 20k", "en");

    expect(result.route).toBe("/search");
    expect(result.clarifying_question?.id).toBe("missing_city");
    expect(result.clarifying_question?.options?.length).toBeGreaterThan(0);
  });

  it("parses range rents from Hinglish pattern", () => {
    const service = createService();
    const result = service.routeQuery("pg noida between 15k and 20k", "en");

    expect(result.filters).toMatchObject({
      city: "noida",
      listing_type: "pg",
      min_rent: 15000,
      max_rent: 20000
    });
  });
});
