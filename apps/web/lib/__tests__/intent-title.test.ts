import { describe, expect, it } from "vitest";
import {
  cityLabel,
  cityLabelFromSlug,
  getIntent,
  placeWithCity,
  renderIntentTitle
} from "../intent-filters";

const pgForGirls = getIntent("pg-for-girls")!;
const pg = getIntent("pg")!;

describe("cityLabelFromSlug", () => {
  it("title-cases a single-word slug", () => {
    expect(cityLabelFromSlug("lucknow")).toBe("Lucknow");
  });

  it("title-cases every word of a hyphenated slug", () => {
    expect(cityLabelFromSlug("greater-noida")).toBe("Greater Noida");
  });
});

describe("cityLabel", () => {
  it("returns the seeded English name", () => {
    expect(cityLabel("lucknow", "en")).toBe("Lucknow");
  });

  it("returns the seeded Hindi name so Hindi titles stay in one script", () => {
    expect(cityLabel("lucknow", "hi")).toBe("लखनऊ");
    expect(cityLabel("ghaziabad", "hi")).toBe("गाज़ियाबाद");
  });

  it("falls back to the slug for a city that is not seeded yet", () => {
    expect(cityLabel("greater-noida", "en")).toBe("Greater Noida");
    expect(cityLabel("greater-noida", "hi")).toBe("Greater Noida");
  });
});

describe("placeWithCity", () => {
  it("appends the city to a place that lacks it", () => {
    expect(placeWithCity("Gomti Nagar", "Lucknow")).toBe("Gomti Nagar, Lucknow");
  });

  it("leaves a place that already names the city alone", () => {
    expect(placeWithCity("IET Lucknow", "Lucknow")).toBe("IET Lucknow");
    expect(placeWithCity("Lucknow University", "Lucknow")).toBe("Lucknow University");
  });

  it("ignores case when checking for the city", () => {
    expect(placeWithCity("Wipro LUCKNOW", "Lucknow")).toBe("Wipro LUCKNOW");
  });

  it("returns the place unchanged when there is no city to add", () => {
    expect(placeWithCity("Gomti Nagar", "")).toBe("Gomti Nagar");
  });
});

describe("renderIntentTitle", () => {
  it("keeps 'in' for a locality and appends the city", () => {
    expect(
      renderIntentTitle(
        pgForGirls,
        { name: "Gomti Nagar", kind: "locality", city: "Lucknow" },
        "en"
      )
    ).toBe("PG for Girls in Gomti Nagar, Lucknow");
  });

  it("uses 'near' for a landmark so the title matches how people search", () => {
    expect(
      renderIntentTitle(
        pgForGirls,
        { name: "Integral University", kind: "landmark", city: "Lucknow" },
        "en"
      )
    ).toBe("PG for Girls near Integral University, Lucknow");
  });

  it("uses 'near' for a metro station", () => {
    expect(
      renderIntentTitle(pg, { name: "Hazratganj Metro", kind: "metro", city: "Lucknow" }, "en")
    ).toBe("PGs near Hazratganj Metro, Lucknow");
  });

  it("does not repeat the city when the place name already contains it", () => {
    expect(
      renderIntentTitle(pg, { name: "IET Lucknow", kind: "landmark", city: "Lucknow" }, "en")
    ).toBe("PGs near IET Lucknow");
  });

  it("never appends the Cribliv brand — the root layout template owns that", () => {
    const title = renderIntentTitle(
      pgForGirls,
      { name: "Integral University", kind: "landmark", city: "Lucknow" },
      "en"
    );
    expect(title).not.toContain("Cribliv");
  });

  it("keeps the Hindi locative for a locality", () => {
    expect(
      renderIntentTitle(pgForGirls, { name: "गोमती नगर", kind: "locality", city: "लखनऊ" }, "hi")
    ).toBe("गोमती नगर, लखनऊ में लड़कियों के लिए पीजी");
  });

  it("swaps the Hindi locative to 'के पास' for a landmark", () => {
    expect(
      renderIntentTitle(
        pgForGirls,
        { name: "इंटीग्रल यूनिवर्सिटी", kind: "landmark", city: "लखनऊ" },
        "hi"
      )
    ).toBe("इंटीग्रल यूनिवर्सिटी, लखनऊ के पास लड़कियों के लिए पीजी");
  });
});
