import { describe, expect, it } from "vitest";
import { editionParts, cityLabel, deskLabel, formatRent } from "../blog-format";

describe("editionParts", () => {
  it("is No. 1 on launch day", () => {
    expect(editionParts(new Date(Date.UTC(2026, 6, 12)))).toEqual({ vol: "I", no: 1 });
  });

  it("advances the edition number daily", () => {
    expect(editionParts(new Date(Date.UTC(2026, 7, 9)))).toEqual({ vol: "I", no: 29 });
  });

  it("rolls the volume after a year of publication", () => {
    expect(editionParts(new Date(Date.UTC(2027, 6, 13)))).toEqual({ vol: "II", no: 367 });
  });

  it("never goes below edition 1 for clock skew before launch", () => {
    expect(editionParts(new Date(Date.UTC(2026, 5, 1)))).toEqual({ vol: "I", no: 1 });
  });
});

describe("formatting helpers", () => {
  it("formats city slugs into datelines", () => {
    expect(cityLabel("gomti-nagar")).toBe("Gomti Nagar");
  });

  it("labels known desks and falls back for unknown ones", () => {
    expect(deskLabel("data-reports", false)).toBe("Data Reports");
    expect(deskLabel("unknown-desk", false)).toBe("Report");
  });

  it("formats rupees with Indian grouping", () => {
    expect(formatRent(12500)).toBe("₹12,500");
  });
});
