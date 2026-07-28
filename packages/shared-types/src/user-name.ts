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
 * The single source of truth for full_name validation, shared by apps/web and
 * apps/api. Returns a stable `code` (for localised copy) and a `message` (for
 * logs / non-UI callers) rather than a ZodError to unpack.
 *
 * apps/api's UpdateProfileSchema (apps/api/src/modules/auth/dto/update-profile.dto.ts)
 * builds its zod wrapper directly on top of this function's result via
 * `superRefine`, instead of re-implementing these rules as a second, parallel
 * set of zod `.refine()`s. This package used to carry exactly that second
 * implementation (a `FullNameSchema` built from chained zod `.refine()`s,
 * kept in agreement with this function only by tests). It has been removed
 * — this function is now the only place these rules live, and the only
 * runtime dependency zod-free.
 *
 * Checks run in a fixed order — angle brackets, then letter presence, then
 * length — matching normalizeFullName's rule ordering above. Do not reorder:
 * doing so changes which `code` a multi-violation input reports (e.g. "<>"
 * fails both the angle-bracket and letter-presence rules; whichever is
 * checked first wins the reported code).
 *
 * Accepts `null`/`undefined`: a literal `null` is a real request shape (the
 * settings page sends `full_name: fullName.trim() || null`), and this
 * function being the one shared implementation is what keeps apps/web and
 * apps/api from ever silently disagreeing on it. Do not narrow this back to
 * `raw: string` — that reintroduces a crash on that exact payload.
 */
export function validateFullName(raw: string | null | undefined): ValidateFullNameResult {
  // null/undefined mean "no name given", same as an empty or whitespace-only
  // string ends up meaning below.
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
