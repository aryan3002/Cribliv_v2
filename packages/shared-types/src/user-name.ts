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

/**
 * Rules 1-2: normalise control/format characters, then collapse whitespace
 * runs and trim.
 *
 * Tab, line feed, and carriage return are simultaneously control characters
 * (category Cc) and whitespace, so they are turned into a single space here
 * rather than deleted outright — deleting them before the whitespace-collapse
 * pass below would silently join words together (a tab or newline between
 * two words would vanish instead of separating them). Every other control or
 * format character (NUL, BEL, zero-width space, and so on) has no such
 * overlap with whitespace and is still deleted outright. Do not "simplify"
 * this back into a single blanket delete of CONTROL_CHARS — that reintroduces
 * the word-joining bug.
 */
export function normalizeFullName(raw: string): string {
  return raw
    .replace(CONTROL_CHARS, (char) => (/\s/.test(char) ? " " : ""))
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

export const FullNameSchema = z
  // Accept an explicit null as input, not just a string: the existing settings
  // page sends `full_name: fullName.trim() || null`, so a literal null is a real
  // request shape and means "clear my name" — the same as an empty string.
  .union([z.string(), z.null()])
  .transform((value) => value ?? "")
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

/**
 * Stable, machine-readable failure reasons. UI layers map these to localised
 * copy; `message` (below) stays an English default for logs and non-UI
 * callers, and must never be string-matched to recover one of these.
 */
export type FullNameErrorCode = "too_short" | "too_long" | "no_letter" | "invalid_chars";

export type ValidateFullNameResult =
  | { ok: true; value: string | null }
  | { ok: false; code: FullNameErrorCode; message: string };

/**
 * Ergonomic wrapper for the web, which needs a stable code to map to localised
 * copy (plus a message to log) rather than a ZodError to unpack.
 *
 * Runs its own explicit checks in the same order as FullNameSchema's chained
 * `.refine()`s, instead of reverse-engineering a code from zod's issue
 * message text — that text is an English sentence, not a stable identifier,
 * and string-matching it would silently break the moment either drifts.
 * Accept/reject and `message` must stay byte-identical to FullNameSchema's
 * behaviour: same normalisation, same rules, same order (angle brackets,
 * then letter presence, then length).
 *
 * Accepts `null`/`undefined` for the same reason FullNameSchema's input is
 * `.union([z.string(), z.null()])`: a literal `null` is a real request shape
 * (the settings page sends `full_name: fullName.trim() || null`), and the two
 * validators exist specifically so they never disagree. Do not narrow this
 * back to `raw: string` — that reintroduces a crash on that exact payload.
 */
export function validateFullName(raw: string | null | undefined): ValidateFullNameResult {
  // null/undefined mean "no name given", same as an empty or whitespace-only
  // string ends up meaning below — mirrors FullNameSchema's
  // `.union([z.string(), z.null()])` -> `.transform((value) => value ?? "")`.
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }
  const normalized = normalizeFullName(raw);
  const value = normalized === "" ? null : normalized;

  if (value === null) {
    return { ok: true, value: null };
  }
  if (/[<>]/.test(value)) {
    return { ok: false, code: "invalid_chars", message: "Name must not contain < or >" };
  }
  if (!/\p{L}/u.test(value)) {
    return { ok: false, code: "no_letter", message: "Name must contain at least one letter" };
  }
  const lengthMessage = `Name must be between ${FULL_NAME_MIN} and ${FULL_NAME_MAX} characters`;
  if (value.length < FULL_NAME_MIN) {
    return { ok: false, code: "too_short", message: lengthMessage };
  }
  if (value.length > FULL_NAME_MAX) {
    return { ok: false, code: "too_long", message: lengthMessage };
  }
  return { ok: true, value };
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
