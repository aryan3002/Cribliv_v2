import { describe, it, expect } from "vitest";
import { buildMapIntent, guardRent } from "../map-intent";

describe("buildMapIntent", () => {
  it("splits a full query into camera + server + client filters + chips", () => {
    const r = buildMapIntent({ transcript: "2bhk in gomti nagar under 20k with parking" });
    expect(r.serverFilters.bhk).toBe(2);
    expect(r.serverFilters.max_rent).toBe(20000);
    expect(r.clientFilters).toContainEqual({ kind: "locality", value: expect.any(String) });
    expect(r.camera).not.toBeNull();
    const parking = r.chips.find((c) => c.kind === "amenity");
    expect(parking?.status).toBe("unsupported");
    expect(parking?.reason).toMatch(/can't filter/i);
  });

  it("attaches quotedSource from the transcript for the reason ledger", () => {
    const r = buildMapIntent({ transcript: "2 bhk under 20k" });
    const bhk = r.chips.find((c) => c.kind === "bhk");
    expect(bhk?.quotedSource?.toLowerCase()).toContain("bhk");
  });

  it("no locality → camera is null", () => {
    const r = buildMapIntent({ transcript: "3bhk under 30k" });
    expect(r.camera).toBeNull();
  });
});

describe("guardRent", () => {
  it("reverts a 10x mishearing when the transcript says the smaller number", () => {
    expect(guardRent(200000, "under 20k")).toBe(20000);
  });
  it("leaves a consistent value alone", () => {
    expect(guardRent(20000, "under 20k")).toBe(20000);
  });
});
