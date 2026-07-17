import { describe, it, expect } from "vitest";

import { ogImageFor } from "../og-image";

const FALLBACK = "https://cribliv.com/cribliv.png";

describe("ogImageFor", () => {
  it("returns the first absolute image URL", () => {
    expect(ogImageFor(["https://img.test/a.jpg", "https://img.test/b.jpg"], FALLBACK)).toBe(
      "https://img.test/a.jpg"
    );
  });

  it("skips non-absolute entries and returns the first absolute one", () => {
    expect(ogImageFor(["/relative.jpg", "https://img.test/b.jpg"], FALLBACK)).toBe(
      "https://img.test/b.jpg"
    );
  });

  it("falls back when there is no absolute image", () => {
    expect(ogImageFor(["/relative.jpg", null, undefined], FALLBACK)).toBe(FALLBACK);
    expect(ogImageFor([], FALLBACK)).toBe(FALLBACK);
    expect(ogImageFor(null, FALLBACK)).toBe(FALLBACK);
  });
});
