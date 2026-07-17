import { describe, expect, it } from "vitest";
import { PG_AMENITY_CORE, PG_AMENITY_EXTRAS, PG_AMENITY_LABELS } from "@cribliv/shared-types";

describe("PG amenity taxonomy", () => {
  it("keeps legacy tokens and adds density", () => {
    expect(PG_AMENITY_CORE).toContain("wifi");
    expect(PG_AMENITY_CORE).toContain("lift");
    expect(PG_AMENITY_EXTRAS.length).toBeGreaterThanOrEqual(16);
  });

  it("has a label for every token", () => {
    for (const token of [...PG_AMENITY_CORE, ...PG_AMENITY_EXTRAS]) {
      expect(PG_AMENITY_LABELS[token], `missing label for ${token}`).toBeTruthy();
    }
  });
});
