import { describe, expect, it } from "vitest";
import { aggregateByCity } from "../ListingsByCity";

describe("aggregateByCity", () => {
  const rows = [
    { city: "lucknow", locality: "Alambagh", count: 26 },
    { city: "lucknow", locality: "LDA Colony", count: 12 },
    { city: "lucknow", locality: "Chinhat", count: 7 },
    { city: "gurugram", locality: "Sector 46", count: 1 },
    { city: "varanasi", locality: null, count: 1 }
  ];

  it("rolls localities up into city totals, sorted by count desc", () => {
    const { cities } = aggregateByCity(rows);
    expect(cities).toEqual([
      { city: "lucknow", count: 45 },
      { city: "gurugram", count: 1 },
      { city: "varanasi", count: 1 }
    ]);
  });

  it("groups localities per city, sorted by count desc", () => {
    const { localitiesByCity } = aggregateByCity(rows);
    expect(localitiesByCity.lucknow).toEqual([
      { name: "Alambagh", count: 26 },
      { name: "LDA Colony", count: 12 },
      { name: "Chinhat", count: 7 }
    ]);
    expect(localitiesByCity.gurugram).toEqual([{ name: "Sector 46", count: 1 }]);
  });

  it("omits cities whose only rows have a null locality from the breakdown", () => {
    const { localitiesByCity } = aggregateByCity(rows);
    // Varanasi still counts toward its city total but has no locality rows.
    expect(localitiesByCity.varanasi).toBeUndefined();
  });

  it("handles an empty input", () => {
    expect(aggregateByCity([])).toEqual({ cities: [], localitiesByCity: {} });
  });
});
