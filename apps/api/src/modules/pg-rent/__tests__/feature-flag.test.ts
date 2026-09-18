import { afterEach, describe, expect, it } from "vitest";

import { readFeatureFlags } from "../../../config/feature-flags";

describe("FF_PG_RENT_COLLECTION", () => {
  const original = process.env.FF_PG_RENT_COLLECTION;
  afterEach(() => {
    if (original === undefined) delete process.env.FF_PG_RENT_COLLECTION;
    else process.env.FF_PG_RENT_COLLECTION = original;
  });

  it("defaults off", () => {
    delete process.env.FF_PG_RENT_COLLECTION;
    expect(readFeatureFlags().ff_pg_rent_collection).toBe(false);
  });

  it("turns on with the usual truthy values", () => {
    process.env.FF_PG_RENT_COLLECTION = "true";
    expect(readFeatureFlags().ff_pg_rent_collection).toBe(true);
    process.env.FF_PG_RENT_COLLECTION = "1";
    expect(readFeatureFlags().ff_pg_rent_collection).toBe(true);
  });
});
