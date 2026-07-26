import { describe, it, expect } from "vitest";
import { buildNavData, DEFAULT_NAV_CITY } from "../nav-data";
import {
  buildOwnersPanel,
  buildPgPanel,
  buildRentPanel,
  buildTimesPanel,
  cityChipLinks
} from "../nav-model";

const LOCALES = ["en", "hi"] as const;

describe("buildNavData", () => {
  it("defaults to Lucknow — the city the layout can assume without going dynamic", () => {
    expect(DEFAULT_NAV_CITY).toBe("lucknow");
    expect(buildNavData("en")).toEqual(buildNavData("en", DEFAULT_NAV_CITY));
  });

  it("returns exactly the five keys the header consumes", () => {
    expect(Object.keys(buildNavData("en")).sort()).toEqual([
      "cities",
      "owners",
      "pg",
      "rent",
      "times"
    ]);
  });

  it("delegates every panel to nav-model rather than reimplementing one", () => {
    for (const locale of LOCALES) {
      const data = buildNavData(locale, "jaipur");
      expect(data.rent).toEqual(buildRentPanel(locale, "jaipur"));
      expect(data.pg).toEqual(buildPgPanel(locale, "jaipur"));
      expect(data.owners).toEqual(buildOwnersPanel(locale));
      expect(data.times).toEqual(buildTimesPanel(locale));
      expect(data.cities).toEqual(cityChipLinks(locale));
    }
  });

  it("honours an explicit city override for the city-scoped panels", () => {
    const jaipur = buildNavData("en", "jaipur");
    for (const link of jaipur.rent.columns.flatMap((c) => c.links)) {
      expect(link.href).not.toMatch(/city=lucknow/);
    }
    expect(jaipur.rent).not.toEqual(buildNavData("en").rent);
    // Owners and Times carry no city, so an override must not perturb them.
    expect(jaipur.owners).toEqual(buildNavData("en").owners);
    expect(jaipur.times).toEqual(buildNavData("en").times);
  });

  it("is JSON-serializable — it crosses the server/client boundary as a prop", () => {
    const data = buildNavData("hi");
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("localizes: the hi panels differ from the en panels", () => {
    expect(buildNavData("hi").rent).not.toEqual(buildNavData("en").rent);
  });
});
