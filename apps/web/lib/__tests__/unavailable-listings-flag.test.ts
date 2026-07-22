import { afterEach, describe, expect, it } from "vitest";

import { isUnavailableListingsEnabled } from "../unavailable-listings-flag";

describe("isUnavailableListingsEnabled", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS;
  });

  it("defaults to off", () => {
    expect(isUnavailableListingsEnabled()).toBe(false);
  });

  it("is enabled by true or 1", () => {
    process.env.NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS = "true";
    expect(isUnavailableListingsEnabled()).toBe(true);

    process.env.NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS = "1";
    expect(isUnavailableListingsEnabled()).toBe(true);
  });
});
