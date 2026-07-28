import { describe, expect, it } from "vitest";
import {
  FULL_NAME_MAX,
  NAME_FIXTURES,
  normalizeFullName,
  validateFullName
} from "@cribliv/shared-types";
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

  it("accepts an explicit null and normalises it to null", () => {
    const result = parseName(null);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.full_name).toBeNull();
  });

  it("accepts the settings page's `trim() || null` payload", () => {
    // Regression test for Finding 1: apps/web/components/settings-client.tsx:96
    // sends `full_name: fullName.trim() || null` — a literal JSON null, not an
    // absent key — whenever the name field is empty. The full_name field's
    // `.optional()` wrapper only widens for `undefined`, so before this fix
    // this exact payload 400'd on every save with an empty name field,
    // breaking a working page for exactly the users (those with no name yet)
    // this feature exists to serve.
    const result = UpdateProfileSchema.safeParse({
      full_name: null,
      preferred_language: "en",
      whatsapp_opt_in: false
    });
    expect(result.success).toBe(true);
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

  it("returns null for a null input rather than throwing", () => {
    // Regression test: validateFullName used to delegate to a zod schema
    // (a `FullNameSchema`, since removed — see
    // packages/shared-types/src/user-name.ts — whose `.union([z.string(),
    // z.null()])` accepted null), but a rewrite that added `code` started
    // calling normalizeFullName(raw) directly, which crashed with
    // `TypeError: Cannot read properties of null (reading 'replace')` on a
    // literal null. The settings page really does send
    // `full_name: fullName.trim() || null`, so this must not throw.
    expect(validateFullName(null)).toEqual({ ok: true, value: null });
  });

  it("returns null for an undefined input rather than throwing", () => {
    expect(validateFullName(undefined)).toEqual({ ok: true, value: null });
  });

  it("keeps UpdateProfileSchema and validateFullName agreeing on null input", () => {
    // Pins the two validators together: UpdateProfileSchema's full_name field
    // is built directly on top of validateFullName (see ../dto/update-profile.dto),
    // so this package's rules and the API's request-envelope schema can never
    // silently diverge on what counts as a valid name.
    expect(UpdateProfileSchema.safeParse({ full_name: null }).success).toBe(true);
    expect(validateFullName(null).ok).toBe(true);
  });

  it("still validates an ordinary string the same as always", () => {
    // The signature was widened to accept null/undefined (above); a normal
    // web-controlled string — the common case — must behave unchanged.
    expect(validateFullName("Asha Devi")).toEqual({ ok: true, value: "Asha Devi" });
  });

  it("returns a human-readable message on failure", () => {
    const result = validateFullName("A");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/2 and 80/);
  });

  describe("failure code — what the UI maps to localised copy, not the message text", () => {
    it("codes a 1-char name as too_short", () => {
      const result = validateFullName("A");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("too_short");
    });

    it("codes an 81-char name as too_long", () => {
      const result = validateFullName("A".repeat(FULL_NAME_MAX + 1));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("too_long");
    });

    it('codes "123" as no_letter', () => {
      const result = validateFullName("123");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("no_letter");
    });

    it('codes "<b>x</b>" as invalid_chars', () => {
      const result = validateFullName("<b>x</b>");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("invalid_chars");
    });
  });
});
