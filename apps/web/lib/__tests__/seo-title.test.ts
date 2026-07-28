import { describe, expect, it } from "vitest";

import { stripBrandSuffix } from "../seo";

/**
 * The root layout appends the brand via `title.template = "%s | Cribliv"`
 * (apps/web/app/layout.tsx). Anything that already carries the brand therefore
 * double-brands, eating ~10 characters of the SERP snippet.
 *
 * The live case was NOT a code bug: the locality page prefers
 * `stored.meta_title` from the seo_copy table, and rows generated before the
 * title fix end in "— Cribliv". Production served
 * "Rent Flats in Gomti Nagar, Lucknow — Cribliv | Cribliv". Sanitising at render
 * repairs every existing row without a prod data migration.
 */
describe("stripBrandSuffix", () => {
  it("strips the pipe form the template itself would add", () => {
    expect(stripBrandSuffix("PGs in Lucknow: Verified | Cribliv")).toBe("PGs in Lucknow: Verified");
  });

  it("strips the em-dash form stored copy actually contains", () => {
    expect(stripBrandSuffix("Rent Flats in Gomti Nagar, Lucknow — Cribliv")).toBe(
      "Rent Flats in Gomti Nagar, Lucknow"
    );
  });

  it("strips en-dash, hyphen and middot separators too", () => {
    expect(stripBrandSuffix("A – Cribliv")).toBe("A");
    expect(stripBrandSuffix("B - Cribliv")).toBe("B");
    expect(stripBrandSuffix("C · Cribliv")).toBe("C");
  });

  it("strips a repeated suffix rather than leaving one behind", () => {
    expect(stripBrandSuffix("Doubled — Cribliv | Cribliv")).toBe("Doubled");
  });

  it("is case-insensitive about the brand", () => {
    expect(stripBrandSuffix("Lower | cribliv")).toBe("Lower");
  });

  it("leaves a title that does not end in the brand alone", () => {
    expect(stripBrandSuffix("Rent Flats in Gomti Nagar, Lucknow")).toBe(
      "Rent Flats in Gomti Nagar, Lucknow"
    );
  });

  it("does not touch the brand when it is part of the phrase, not a suffix", () => {
    // "Cribliv Times" is the publication's own name — stripping it would rename
    // the masthead. Only a trailing separator + bare brand is a suffix.
    expect(stripBrandSuffix("Local Guides · Cribliv Times")).toBe("Local Guides · Cribliv Times");
    expect(stripBrandSuffix("Why Cribliv verifies owners")).toBe("Why Cribliv verifies owners");
  });

  it("never returns an empty string, even if the title is only the brand", () => {
    expect(stripBrandSuffix("Cribliv")).toBe("Cribliv");
    expect(stripBrandSuffix("| Cribliv")).toBe("| Cribliv");
  });

  it("tolerates empty and whitespace input", () => {
    expect(stripBrandSuffix("")).toBe("");
    expect(stripBrandSuffix("   ")).toBe("");
  });
});
