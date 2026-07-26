import { describe, expect, it } from "vitest";
import { NAME_FIXTURES, normalizeFullName, validateFullName } from "@cribliv/shared-types";
import { UpdateProfileSchema } from "../dto/update-profile.dto";

const parseName = (full_name: unknown) => UpdateProfileSchema.safeParse({ full_name });

describe("normalizeFullName", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeFullName("  Asha   Devi  ")).toBe("Asha Devi");
  });

  it("strips control characters", () => {
    // \u200b zero-width space (Cf), \u0007 bell (Cc). Written as escapes on
    // purpose — an invisible literal in a test file is unreviewable.
    expect(normalizeFullName("As\u200bha\u0007")).toBe("Asha");
  });

  it("leaves an already-clean name untouched", () => {
    expect(normalizeFullName("Asha Devi")).toBe("Asha Devi");
  });

  it("turns a tab between words into a single space rather than joining them", () => {
    // Tab is both a control character and whitespace-category; deleting
    // controls before collapsing whitespace used to join words instead of
    // spacing them (the bug this test guards against).
    expect(normalizeFullName("Asha\tDevi")).toBe("Asha Devi");
  });

  it("turns a newline between words into a single space rather than joining them", () => {
    expect(normalizeFullName("Asha\nDevi")).toBe("Asha Devi");
  });

  it("collapses a run of whitespace-category control characters to one space", () => {
    expect(normalizeFullName("Asha\t\t  Devi")).toBe("Asha Devi");
  });

  it("still deletes a zero-width space outright rather than turning it into a space", () => {
    expect(normalizeFullName("As\u200bha")).toBe("Asha");
  });

  it("still deletes a BEL control character outright", () => {
    expect(normalizeFullName("Asha\u0007")).toBe("Asha");
  });

  it("normalises a string of only whitespace-category control characters to empty", () => {
    expect(normalizeFullName("\t\n  ")).toBe("");
  });
});

describe("UpdateProfileSchema full_name", () => {
  it.each(NAME_FIXTURES.valid)("accepts %j", (name) => {
    expect(parseName(name).success).toBe(true);
  });

  it.each(NAME_FIXTURES.invalid)("rejects %j", (name) => {
    expect(parseName(name).success).toBe(false);
  });

  it("normalises before length-checking, so a padded 1-char name is rejected", () => {
    expect(parseName("  A  ").success).toBe(false);
  });

  it("parses an all-whitespace name to null rather than rejecting", () => {
    const result = parseName("   ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.full_name).toBeNull();
  });

  it("returns the normalised value, not the raw input", () => {
    const result = parseName("  Asha   Devi ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.full_name).toBe("Asha Devi");
  });

  it("accepts a body with no full_name at all", () => {
    const result = UpdateProfileSchema.safeParse({ preferred_language: "hi" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.full_name).toBeUndefined();
  });

  it("rejects an unknown language", () => {
    expect(UpdateProfileSchema.safeParse({ preferred_language: "fr" }).success).toBe(false);
  });
});

describe("validateFullName — the shape the web consumes", () => {
  it.each(NAME_FIXTURES.valid)("accepts %j", (name) => {
    expect(validateFullName(name).ok).toBe(true);
  });

  it.each(NAME_FIXTURES.invalid)("rejects %j", (name) => {
    expect(validateFullName(name).ok).toBe(false);
  });

  it("returns the normalised value on success", () => {
    const result = validateFullName("  Asha   Devi ");
    expect(result).toEqual({ ok: true, value: "Asha Devi" });
  });

  it("returns null for a blank name", () => {
    expect(validateFullName("   ")).toEqual({ ok: true, value: null });
  });

  it("returns a human-readable message on failure", () => {
    const result = validateFullName("A");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/2 and 80/);
  });
});
