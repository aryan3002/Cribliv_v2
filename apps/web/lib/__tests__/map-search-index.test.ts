import { describe, expect, it } from "vitest";
import { searchMapIndex } from "../map-search-index";

describe("searchMapIndex", () => {
  it("returns the city itself first when a city name is typed", () => {
    const results = searchMapIndex("lucknow");
    expect(results.length).toBeGreaterThan(0);
    // The city should win over its own localities — not an alphabetical dump
    // of "Aliganj Sector A/B/…" burying the city below the fold.
    expect(results[0].kind).toBe("city");
    expect(results[0].label).toBe("Lucknow");
  });

  it("still lists localities of the city below the city hit", () => {
    const results = searchMapIndex("lucknow");
    const localities = results.filter((r) => r.kind === "locality" && r.city === "lucknow");
    expect(localities.length).toBeGreaterThan(0);
  });

  it("surfaces a parent area (e.g. Alambagh) as its own selectable hit, ranked first", () => {
    const results = searchMapIndex("alambagh");
    const alambagh = results.find((r) => r.label.toLowerCase() === "alambagh");
    expect(alambagh).toBeTruthy();
    expect(results[0].label).toBe("Alambagh");
  });

  it("matches an exact locality name as the top result", () => {
    const results = searchMapIndex("Vibhuti Khand");
    expect(results[0].label).toBe("Vibhuti Khand");
  });

  it("ranks a locality name-match above a bare city-context match", () => {
    // Typing a locality's own name must beat localities that only share the city.
    const results = searchMapIndex("ashiyana colony");
    expect(results[0].label).toBe("Ashiyana Colony");
  });
});
