import { z } from "zod";

/**
 * Canonical rules for users.full_name, shared by apps/api and apps/web.
 *
 * Lives here rather than in either app because the two validators must agree:
 * if the web accepted something the API rejects, the user gets an opaque 400
 * after typing; if the web rejected something the API accepts, legitimate names
 * become unenterable. Sharing the implementation removes the failure mode
 * instead of testing for it.
 *
 * Order matters: normalise first, then reject. "  A  " must fail the 2-char
 * minimum rather than pass on padding.
 */

const CONTROL_CHARS = /[\p{Cc}\p{Cf}]/gu;
const WHITESPACE_RUN = /\s+/g;

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 80;

/** Rules 1-2: strip control characters, collapse whitespace runs, trim. */
export function normalizeFullName(raw: string): string {
  return raw.replace(CONTROL_CHARS, "").replace(WHITESPACE_RUN, " ").trim();
}

export const FullNameSchema = z
  .string()
  .transform(normalizeFullName)
  // An empty result is a deliberate "clear my name", not a validation failure.
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || !/[<>]/.test(value), {
    message: "Name must not contain < or >"
  })
  .refine((value) => value === null || /\p{L}/u.test(value), {
    message: "Name must contain at least one letter"
  })
  .refine(
    (value) => value === null || (value.length >= FULL_NAME_MIN && value.length <= FULL_NAME_MAX),
    { message: `Name must be between ${FULL_NAME_MIN} and ${FULL_NAME_MAX} characters` }
  );

export type ValidateFullNameResult =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

/**
 * Ergonomic wrapper for the web, which needs a message to render inline rather
 * than a ZodError to unpack.
 */
export function validateFullName(raw: string): ValidateFullNameResult {
  const parsed = FullNameSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return {
    ok: false,
    message: parsed.error.issues[0]?.message ?? "Please enter a valid name"
  };
}

/** Shared fixture so both apps' tests exercise the same cases. */
export const NAME_FIXTURES = {
  valid: [
    "Asha Devi",
    "Asha",
    "आशा देवी",
    "Jean-Luc Picard",
    "O'Brien",
    "R. K. Narayan",
    "Ab",
    "A".repeat(FULL_NAME_MAX),
    // Formula-looking, but it contains letters and no angle brackets, so the
    // rules accept it. Defence is at CSV-render time (escapeCsvCell in
    // leads.service.ts), not at input time — an input rule for this would have
    // to reject legitimate names too.
    "=cmd|'/c calc'!A0"
  ],
  invalid: [
    "A",
    "A".repeat(FULL_NAME_MAX + 1),
    "123",
    "...",
    "<script>alert(1)</script>",
    "Asha <b>Devi</b>"
  ]
} as const;
