import { describe, it, expect } from "vitest";
import { rentBarsFromFacts, buildRentChartSvg } from "../src/modules/blog/blog-chart";
import { countCitedDataPoints } from "../src/modules/blog/quality-gate";
import type { BlogDataPoint } from "../src/modules/blog/blog.types";

const facts: BlogDataPoint[] = [
  { key: "median_rent_1bhk", label: "Median 1BHK rent", value: 9000, unit: "₹/mo" },
  { key: "median_rent_2bhk", label: "Median 2BHK rent", value: 12000, unit: "₹/mo" },
  { key: "median_rent_pg", label: "Median PG rent", value: 6500, unit: "₹/mo" },
  { key: "listing_count", label: "Active listings", value: 34, unit: null }
];

describe("blog-chart", () => {
  it("extracts ordered rent bars, skipping non-rent facts", () => {
    const bars = rentBarsFromFacts(facts);
    expect(bars.map((b) => b.label)).toEqual(["1 BHK", "2 BHK", "PG"]);
    expect(bars.map((b) => b.value)).toEqual([9000, 12000, 6500]);
  });

  it("skips zero/absent rent medians", () => {
    expect(
      rentBarsFromFacts([
        { key: "median_rent_2bhk", label: "x", value: 0, unit: "₹/mo" },
        { key: "listing_count", label: "x", value: 5, unit: null }
      ])
    ).toEqual([]);
  });

  it("renders an SVG with one bar per value and ₹-grouped labels", () => {
    const svg = buildRentChartSvg(rentBarsFromFacts(facts), "What renters pay in Noida");
    expect(svg.startsWith("<svg")).toBe(true);
    expect((svg.match(/<rect/g) ?? []).length).toBe(3);
    expect(svg).toContain("₹12,000");
    expect(svg).toContain("What renters pay in Noida");
  });

  it("keeps the chart's figures countable by the quality gate", () => {
    const svg = buildRentChartSvg(rentBarsFromFacts(facts), "t");
    const n = countCitedDataPoints(svg, [{ label: "Cribliv live listings", asof: null }]);
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it("returns empty string when there are no rent bars", () => {
    expect(buildRentChartSvg([], "t")).toBe("");
  });
});
