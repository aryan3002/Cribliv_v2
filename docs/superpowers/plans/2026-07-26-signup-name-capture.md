# Signup Name Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect a name from every user who does not have one, at four points in the product, and surface it everywhere the code already expects a name.

**Architecture:** `users.full_name` already exists and is nullable; no migration. The API gains real validation on `PATCH /users/me` (it has none today). The web session starts carrying `full_name` as `session.user.name` via the `/auth/me` sync that already runs. One shared `NameCaptureForm` renders in two shells — an inline step inside the auth flows, and a modal — driven by a `NamePromptProvider` context that exposes a promise-based `requireName()` so the contact gate is written once rather than at four call sites.

**Tech Stack:** NestJS + zod (`apps/api`), Next.js 14 App Router + NextAuth v5 + framer-motion (`apps/web`), Vitest for unit/component tests, Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-07-26-signup-name-capture-design.md`

## Global Constraints

- **No feature flag.** This ships on. Do not add an `FF_*` or `ff_*` gate.
- **No migration.** `users.full_name text` already exists and is nullable (`infra/migrations/0001_init.sql:158`). Do not create `0055_*.sql`.
- **Roles prompted:** `tenant`, `owner`, `pg_operator`. Never `admin`.
- **`NULL` and `''` both mean "no name".** The API normalises `''` to `NULL` on write.
- **Name rules, applied in this order — normalise, then reject:**
  1. Map whitespace-category control chars (tab, LF, CR) to a single space, and **delete** all other control/format chars (`\p{Cc}`, `\p{Cf}`). Deleting tab/LF outright would silently join words — `"Asha\tDevi"` must normalise to `"Asha Devi"`, never `"AshaDevi"`.
  2. Collapse internal whitespace runs to one space; trim.
  3. Reject if it contains `<` or `>`.
  4. Reject unless it contains at least one letter (`\p{L}`).
  5. Reject unless length is 2–80 after normalisation.
  6. Normalised `''` stores as `NULL`. An explicit input `null` is accepted and means the same thing — `settings-client.tsx:96` already sends `full_name: fullName.trim() || null`, so rejecting a literal `null` would 400 the existing settings page.
- **There is exactly one implementation of the name rules**, in `packages/shared-types/src/user-name.ts`. Both apps import it. Never re-implement or re-state a rule in `apps/api` or `apps/web`.
- **Runtime values exported from `packages/shared-types` need an explicit re-export** in `src/index.ts`, not just `export *` — see the comment block already in that file. A value reached only through the barrel is `undefined` once Next.js bundles it.
- **All user-facing copy goes through `t(locale, key)`** from `apps/web/lib/i18n.ts`, with both `en` and `hi` values. `t()` signature: `t(locale: Locale, key: string): string`.
- **Dual-mode services.** Every `apps/api` change must work with `DatabaseService.isEnabled()` both true and false.
- **Commit after every task.** The pre-commit hook runs `lint-staged`; `pnpm install --frozen-lockfile` has already been run in this worktree so it works. Do not use `--no-verify` on code commits.

## Commands

| Purpose                  | Command                                     |
| ------------------------ | ------------------------------------------- |
| API tests                | `pnpm --filter @cribliv/api test`           |
| API single file          | `pnpm --filter @cribliv/api test -- <path>` |
| Web unit/component tests | `pnpm --filter @cribliv/web test`           |
| Web single file          | `pnpm --filter @cribliv/web test -- <path>` |
| Web E2E                  | `pnpm --filter @cribliv/web test:e2e`       |
| Typecheck                | `pnpm typecheck`                            |

**CI caveat:** CI never sets `TEST_DATABASE_URL`, so DB-backed API integration tests are skipped there. Run them locally against a targeted file. Do not run the full API suite locally with a DB attached — migration 0045's rollback drops `keyword_rankings` and `seo_indexing_queue`.

## File Structure

**Create — `packages/shared-types`:**

- `src/user-name.ts` — the single implementation of the name rules: `normalizeFullName`, `FullNameSchema`, `validateFullName`, `NAME_FIXTURES`.

**Modify — `packages/shared-types`:**

- `src/index.ts` — barrel line **and** explicit runtime value re-exports.

**Create — `apps/api`:**

- `src/modules/auth/dto/update-profile.dto.ts` — thin request envelope wrapping `FullNameSchema`.
- `src/modules/auth/__tests__/update-profile.dto.test.ts` — validator unit tests.
- `src/modules/auth/__tests__/update-profile.service.test.ts` — service unit tests.
- `src/modules/leads/__tests__/csv-escape.test.ts` — CSV escaping unit tests.

**Modify — `apps/api`:**

- `src/modules/auth/auth.controller.ts:59-67` — parse the body, pass the parsed value on.
- `src/modules/auth/auth.service.ts:493-541` — consume the pre-normalised value; clear on `NULL`; fix the `rowCount === 0` fallthrough.
- `src/modules/leads/leads.service.ts:839-846` — formula-injection prefix.

**Create — `apps/web`:**

- `lib/name-capture.ts` — pure: `shouldShowNamePrompt()`, dismissal read/write, `fetchFullName()`, `saveFullName()`. Re-exports `validateFullName` from `@cribliv/shared-types` rather than restating it.
- `lib/__tests__/name-capture.test.ts`
- `components/name-capture/name-capture-form.tsx` — the input + submit. No chrome.
- `components/name-capture/name-capture-modal.tsx` — modal shell around the form.
- `components/name-capture/name-prompt-provider.tsx` — ambient trigger + `requireName()` context.
- `components/name-capture/__tests__/name-capture-form.test.tsx`
- `components/name-capture/__tests__/name-prompt-provider.test.tsx`
- `tests/name-capture.spec.ts` — E2E.

**Modify — `apps/web`:**

- `auth.config.ts:29-38` and `:231-247` — carry `full_name` into `session.user.name`.
- `lib/i18n.ts` — new keys.
- `app/[locale]/layout.tsx:64-70` — mount the provider.
- `app/[locale]/auth/login/page.tsx` — moment 1 + suppress the auto-redirect guard.
- `components/unlock-contact-panel.tsx` — moment 2 + gate 3 unlock paths.
- `components/pg/PgInterestButton.tsx` — gate.

**Why this split:** name _rules_ live once in `packages/shared-types`; web _decisions_ (when to prompt, whether it was dismissed, how to read the current name) live once in `lib/name-capture.ts`. That leaves the three components purely presentational and each of the four call sites a single `await requireName()`. `NameCaptureForm` is deliberately separate from `NameCaptureModal` because moments 1 and 2 render the form with no modal around it at all.

---

### Task 1: Shared name rules + API validator

The rules live in `packages/shared-types` so `apps/api` and `apps/web` consume **one**
implementation. The spec requires the two validators to agree; sharing the code makes
disagreement impossible rather than merely tested-against.

**Files:**

- Create: `packages/shared-types/src/user-name.ts`
- Modify: `packages/shared-types/src/index.ts`
- Create: `apps/api/src/modules/auth/dto/update-profile.dto.ts`
- Test: `apps/api/src/modules/auth/__tests__/update-profile.dto.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces, from `@cribliv/shared-types`:
  - `normalizeFullName(raw: string): string` — normalisation only (rules 1–2).
  - `FullNameSchema` — zod; accepts `string`, outputs `string | null`.
  - `validateFullName(raw: string): { ok: true; value: string | null } | { ok: false; message: string }` — the web's entry point (Task 5, Task 7).
  - `NAME_FIXTURES: { valid: readonly string[]; invalid: readonly string[] }`.
- Produces, from `apps/api/.../dto/update-profile.dto.ts`:
  - `UpdateProfileSchema` — zod object wrapping `FullNameSchema`.
  - `type UpdateProfileBody = { full_name?: string | null; preferred_language?: "en" | "hi"; whatsapp_opt_in?: boolean }`

**⚠ Bundler landmine:** `packages/shared-types/src/index.ts` documents that runtime (value)
exports must be re-exported **explicitly**, not via `export *` — a barrel `export *` compiles to
`__exportStar`, which Next.js's bundler cannot statically analyse, so the imported function is
`undefined` at runtime. `normalizeFullName`, `validateFullName`, `FullNameSchema`, and
`NAME_FIXTURES` are all values. Miss this and the web validator throws "not a function" only in
the browser, never in tests.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/__tests__/update-profile.dto.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- src/modules/auth/__tests__/update-profile.dto.test.ts`
Expected: FAIL — cannot resolve `@cribliv/shared-types` exports / `../dto/update-profile.dto`.

- [ ] **Step 3: Write the shared rules module**

Create `packages/shared-types/src/user-name.ts`:

```ts
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
```

`"   "` is deliberately **not** in `invalid`: it normalises to `""`, which becomes `null` — a valid
"clear my name" instruction, asserted separately.

- [ ] **Step 4: Export it, as values not a barrel**

In `packages/shared-types/src/index.ts`, add the type-level barrel line alongside the others:

```ts
export * from "./user-name";
```

**and** add the explicit value re-exports to the runtime block at the bottom, next to
`computePgListingScore`:

```ts
export {
  normalizeFullName,
  validateFullName,
  FullNameSchema,
  NAME_FIXTURES,
  FULL_NAME_MIN,
  FULL_NAME_MAX
} from "./user-name";
```

Both lines are required. The `export *` carries the types; without the explicit block the values
resolve to `undefined` inside Next.js.

- [ ] **Step 5: Build the package**

Run: `pnpm --filter @cribliv/shared-types build`
Expected: succeeds, emits `dist/user-name.js` and `dist/user-name.d.ts`.

`apps/api`'s vitest aliases `@cribliv/shared-types` to `../../packages/shared-types/dist`, so this
build is a prerequisite for the API tests resolving the import at all.

- [ ] **Step 6: Write the API DTO**

Create `apps/api/src/modules/auth/dto/update-profile.dto.ts`:

```ts
import { z } from "zod";
import { FullNameSchema } from "@cribliv/shared-types";

/**
 * Validation for PATCH /users/me.
 *
 * Until this existed the route had no runtime validation at all: the controller
 * declared an inline TS body type, which erases, and the global ValidationPipe
 * skips bodies whose metatype is Object. Any length and any bytes reached
 * users.full_name — which is rendered on owner lead lists, written into a CSV
 * owners download, and interpolated into outbound SMS/WhatsApp bodies.
 *
 * The name rules themselves live in @cribliv/shared-types so apps/web validates
 * identically; only the request envelope is defined here.
 */
export const UpdateProfileSchema = z.object({
  full_name: FullNameSchema.optional(),
  preferred_language: z.enum(["en", "hi"]).optional(),
  whatsapp_opt_in: z.boolean().optional()
});

export type UpdateProfileBody = z.infer<typeof UpdateProfileSchema>;
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- src/modules/auth/__tests__/update-profile.dto.test.ts`
Expected: PASS — every fixture, plus the 7 schema cases and the 5 `validateFullName` cases.

- [ ] **Step 8: Typecheck the package and the API**

Run: `pnpm --filter @cribliv/shared-types typecheck && pnpm --filter @cribliv/api typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-types/src/user-name.ts packages/shared-types/src/index.ts apps/api/src/modules/auth/dto/update-profile.dto.ts apps/api/src/modules/auth/__tests__/update-profile.dto.test.ts
git commit -m "feat: add shared full_name validation rules

Rules live in @cribliv/shared-types so apps/web and apps/api cannot drift.
PATCH /users/me had no runtime validation at all before this."
```

---

### Task 2: Wire validation into the profile route

**Files:**

- Modify: `apps/api/src/modules/auth/auth.controller.ts:59-67`
- Modify: `apps/api/src/modules/auth/auth.service.ts:493-541`
- Test: `apps/api/src/modules/auth/__tests__/update-profile.service.test.ts` (create)

**Interfaces:**

- Consumes: `UpdateProfileSchema`, `UpdateProfileBody` from Task 1.
- Produces: `AuthService.updateProfile(userId: string, body: UpdateProfileBody)` — now expects an already-normalised body and performs no string handling. Returns `{ id, full_name, preferred_language, whatsapp_opt_in }` or throws `NotFoundException`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/__tests__/update-profile.service.test.ts`:

```ts
import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../auth.service";

/**
 * Braced arrow bodies throughout: Vitest treats a returned value from a
 * beforeEach callback as a teardown function, so `beforeEach(() => x.reset())`
 * on a mock that returns a promise fails the test after its assertions pass.
 */
function makeService(opts: { dbEnabled: boolean }) {
  const query = vi.fn();
  const users = new Map<string, Record<string, unknown>>();
  const appState = {
    users,
    getWalletDetails: () => {
      return { balance_credits: 0 };
    }
  };
  const database = {
    isEnabled: () => {
      return opts.dbEnabled;
    },
    query
  };
  // AuthService takes three injected deps: (appState, database, d7OtpClient).
  // updateProfile touches none of the OTP client, so a bare stub is enough.
  const service = new AuthService(appState as never, database as never, {} as never);
  return { service, query, users };
}

describe("AuthService.updateProfile — DB mode", () => {
  it("writes the name it was given without re-normalising", async () => {
    const { service, query } = makeService({ dbEnabled: true });
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: "u1", full_name: "Asha Devi", preferred_language: "en", whatsapp_opt_in: false }]
    });

    const result = await service.updateProfile("u1", { full_name: "Asha Devi" });

    expect(result).toMatchObject({ full_name: "Asha Devi" });
    // 5 params: $5 is the "full_name was provided" flag the CASE WHEN needs.
    expect(query.mock.calls[0][1]).toEqual(["u1", "Asha Devi", null, null, true]);
  });

  it("clears the column when given null", async () => {
    const { service, query } = makeService({ dbEnabled: true });
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: "u1", full_name: null, preferred_language: "en", whatsapp_opt_in: false }]
    });

    await service.updateProfile("u1", { full_name: null });

    // null must reach the UPDATE as an explicit clear, distinguishable from
    // "field absent" — COALESCE alone cannot express this.
    expect(query.mock.calls[0][1][1]).toBeNull();
    expect(query.mock.calls[0][0]).toContain("full_name = CASE WHEN $5 THEN $2");
  });

  it("leaves the column alone when full_name is absent", async () => {
    const { service, query } = makeService({ dbEnabled: true });
    query.mockResolvedValue({
      rowCount: 1,
      rows: [{ id: "u1", full_name: "Asha", preferred_language: "hi", whatsapp_opt_in: false }]
    });

    await service.updateProfile("u1", { preferred_language: "hi" });

    // $5 is the "full_name was provided" flag.
    expect(query.mock.calls[0][1][4]).toBe(false);
  });

  it("throws NotFound instead of silently falling through to in-memory", async () => {
    const { service, query } = makeService({ dbEnabled: true });
    query.mockResolvedValue({ rowCount: 0, rows: [] });

    await expect(service.updateProfile("missing", { full_name: "Asha" })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});

describe("AuthService.updateProfile — in-memory mode", () => {
  it("stores the name", async () => {
    const { service, users } = makeService({ dbEnabled: false });
    users.set("u1", { id: "u1", full_name: undefined, preferred_language: "en" });

    const result = await service.updateProfile("u1", { full_name: "Asha Devi" });

    expect(result).toMatchObject({ id: "u1", full_name: "Asha Devi" });
  });

  it("clears the name when given null", async () => {
    const { service, users } = makeService({ dbEnabled: false });
    users.set("u1", { id: "u1", full_name: "Asha", preferred_language: "en" });

    const result = await service.updateProfile("u1", { full_name: null });

    expect(result).toMatchObject({ full_name: null });
  });

  it("throws NotFound for an unknown user", async () => {
    const { service } = makeService({ dbEnabled: false });
    await expect(service.updateProfile("nope", { full_name: "Asha" })).rejects.toBeInstanceOf(
      NotFoundException
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- src/modules/auth/__tests__/update-profile.service.test.ts`
Expected: FAIL — the current `updateProfile` uses `COALESCE`, returns `{}` for a missing user, and never throws.

- [ ] **Step 3: Rewrite `updateProfile`**

In `apps/api/src/modules/auth/auth.service.ts`, replace the whole `updateProfile` method (currently lines 493-541) with:

```ts
  /**
   * Body arrives already normalised and validated by UpdateProfileSchema
   * (see dto/update-profile.dto.ts). No string handling happens here — doing it
   * in one place is what keeps the DB and in-memory branches from drifting.
   *
   * full_name is tri-state: absent (leave alone), null (clear), string (set).
   * COALESCE cannot express "clear", so an explicit provided-flag is passed.
   */
  async updateProfile(userId: string, body: UpdateProfileBody) {
    const nameProvided = Object.prototype.hasOwnProperty.call(body, "full_name");
    const nextName = body.full_name ?? null;

    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        id: string;
        full_name: string | null;
        preferred_language: "en" | "hi";
        whatsapp_opt_in: boolean;
      }>(
        `
        UPDATE users
        SET
          full_name = CASE WHEN $5 THEN $2 ELSE full_name END,
          preferred_language = COALESCE($3::lang_code, preferred_language),
          whatsapp_opt_in = COALESCE($4, whatsapp_opt_in),
          updated_at = now()
        WHERE id = $1::uuid
        RETURNING id::text, full_name, preferred_language::text, whatsapp_opt_in
        `,
        [
          userId,
          nextName,
          body.preferred_language ?? null,
          typeof body.whatsapp_opt_in === "boolean" ? body.whatsapp_opt_in : null,
          nameProvided
        ]
      );

      if (!result.rowCount || !result.rows[0]) {
        // Previously this fell through to the in-memory branch and returned {},
        // so a bad id looked like a successful no-op update.
        throw new NotFoundException({ code: "user_not_found", message: "User not found" });
      }
      return result.rows[0];
    }

    const user = this.appState.users.get(userId);
    if (!user) {
      throw new NotFoundException({ code: "user_not_found", message: "User not found" });
    }

    if (nameProvided) {
      // AppStateService types full_name as string | undefined while Postgres
      // uses string | null; normalise to null so both branches return the same
      // empty representation to the client.
      user.full_name = nextName ?? undefined;
    }
    user.preferred_language = body.preferred_language ?? user.preferred_language;
    user.whatsapp_opt_in = body.whatsapp_opt_in ?? user.whatsapp_opt_in;

    return {
      id: user.id,
      full_name: user.full_name ?? null,
      preferred_language: user.preferred_language,
      whatsapp_opt_in: user.whatsapp_opt_in ?? false
    };
  }
```

Add to the imports at the top of the file — `NotFoundException` to the existing `@nestjs/common` import, and:

```ts
import type { UpdateProfileBody } from "./dto/update-profile.dto";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- src/modules/auth/__tests__/update-profile.service.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Parse the body in the controller**

In `apps/api/src/modules/auth/auth.controller.ts`, add to the imports:

```ts
import { BadRequestException } from "@nestjs/common";
import { UpdateProfileSchema } from "./dto/update-profile.dto";
```

Replace the `updateProfile` handler (lines 59-67) with:

```ts
  @UseGuards(AuthGuard)
  @Patch("users/me")
  async updateProfile(@Req() req: { user: { id: string } }, @Body() body: unknown) {
    const parsed = UpdateProfileSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "invalid_payload",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
      });
    }
    return ok(await this.authService.updateProfile(req.user.id, parsed.data));
  }
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @cribliv/api typecheck`
Expected: no errors. If `settings-client.tsx` or another caller sends `full_name: null`, that is already the intended contract.

- [ ] **Step 7: Run the auth test files**

Run: `pnpm --filter @cribliv/api test -- src/modules/auth`
Expected: PASS. DB-backed integration tests skip without `TEST_DATABASE_URL`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/auth/auth.controller.ts apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/__tests__/update-profile.service.test.ts
git commit -m "feat(api): validate and normalise full_name on PATCH /users/me

Also fixes two pre-existing bugs in updateProfile: a rowCount-0 fallthrough
that returned {} instead of 404, and COALESCE preventing the name from ever
being cleared."
```

---

### Task 3: CSV formula-injection escaping

**Files:**

- Modify: `apps/api/src/modules/leads/leads.service.ts:839-846`
- Test: `apps/api/src/modules/leads/__tests__/csv-escape.test.ts` (create)

**Interfaces:**

- Consumes: nothing.
- Produces: `escapeCsvCell(v: string | null | undefined): string`, exported from `leads.service.ts` for testing.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/leads/__tests__/csv-escape.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { escapeCsvCell } from "../leads.service";

describe("escapeCsvCell", () => {
  it("returns empty string for null and undefined", () => {
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("passes a plain value through", () => {
    expect(escapeCsvCell("Asha Devi")).toBe("Asha Devi");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(escapeCsvCell('Asha, "Tenant"')).toBe('"Asha, ""Tenant"""');
  });

  it.each(["=", "+", "-", "@"])("neutralises a leading %s", (lead) => {
    // tenant_name is attacker-controlled now that users can set their own name,
    // and owners download this file. Excel/Sheets execute a leading formula.
    const result = escapeCsvCell(`${lead}cmd|'/c calc'!A0`);
    expect(result.startsWith("'")).toBe(true);
  });

  it("neutralises a leading tab and carriage return", () => {
    expect(escapeCsvCell("\tcmd").startsWith("'")).toBe(true);
    expect(escapeCsvCell("\rcmd").startsWith("'")).toBe(true);
  });

  it("still quotes a formula that also contains a comma", () => {
    const result = escapeCsvCell("=SUM(1,2)");
    expect(result).toBe(`"'=SUM(1,2)"`);
  });

  it("does not touch a hyphen that is not leading", () => {
    expect(escapeCsvCell("Jean-Luc")).toBe("Jean-Luc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- src/modules/leads/__tests__/csv-escape.test.ts`
Expected: FAIL — `escapeCsvCell` is not exported.

- [ ] **Step 3: Extract and harden the escaper**

In `apps/api/src/modules/leads/leads.service.ts`, add this exported function at module scope (above the service class):

```ts
/**
 * CSV cell escaping for the owner leads export.
 *
 * Beyond the usual quote/comma/newline handling, a cell beginning with = + - @
 * (or tab/CR) is prefixed with an apostrophe. Excel and Sheets treat those as
 * formulas, and tenant_name became attacker-controlled the moment users could
 * set their own full_name.
 */
export function escapeCsvCell(v: string | null | undefined): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
```

Then delete the local `const escape = (v: string | null | undefined) => {...}` block (lines 839-846) and change the `csvRows` mapping to call `escapeCsvCell`. If the local name `escape` is referenced elsewhere in the method, replace every use.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- src/modules/leads/__tests__/csv-escape.test.ts`
Expected: PASS (8 assertions across the `it.each`).

- [ ] **Step 5: Run the existing leads tests**

Run: `pnpm --filter @cribliv/api test -- src/modules/leads`
Expected: PASS. `leads.service.test.ts:84` asserts on a `full_name` of `'Asha, "Tenant"'`, which this change leaves byte-identical.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/leads/leads.service.ts apps/api/src/modules/leads/__tests__/csv-escape.test.ts
git commit -m "fix(api): escape CSV formula injection in owner leads export

tenant_name becomes attacker-controlled once users set their own name, and
owners download this file."
```

---

### Task 4: Carry full_name into the session

**Files:**

- Modify: `apps/web/auth.config.ts` (the `MeResponse` interface, and the `/auth/me` sync inside the `session` callback)

**Interfaces:**

- Consumes: nothing.
- Produces: `session.user.name: string | null | undefined` — the user's `full_name`, refreshed on every session read. No type augmentation needed: `session.user` already extends `DefaultSession["user"]`, which declares `name?: string | null`.

Background: five components already read `session.user.name` and all five get `undefined` today, because `authorize()` never returns a `name` and the session callback never sets one — even though `GET /auth/me` has always returned `full_name`. This task is what makes the header menu, owner shell, listing wizard, and PG dashboard show a real name.

- [ ] **Step 1: Add the field to the response type**

In `apps/web/auth.config.ts`, in the `MeResponse` interface, add after `preferred_language`:

```ts
full_name: string | null;
```

- [ ] **Step 2: Set it on the session**

In the `session` callback's `/auth/me` block, alongside the existing `session.user.role = payload.data.role;`, add:

```ts
// Server-authoritative on every session read, so a name saved in one
// tab shows up in the others within the SessionProvider's 30s refetch.
session.user.name = payload.data.full_name ?? undefined;
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

- [ ] **Step 4: Verify no consumer regresses**

Run: `pnpm --filter @cribliv/web test`
Expected: PASS. The five `session.user.name` readers all already handle a falsy name with a fallback (`|| "Account"`, `?? ""`, `?.split(...)`), so populating it cannot break them — but confirm rather than assume.

- [ ] **Step 5: Commit**

```bash
git add apps/web/auth.config.ts
git commit -m "feat(web): carry full_name into session.user.name

GET /auth/me already returned it; the session callback dropped it. Five
components were reading session.user.name and getting undefined."
```

---

### Task 5: Web name-capture decisions module

**Files:**

- Create: `apps/web/lib/name-capture.ts`
- Test: `apps/web/lib/__tests__/name-capture.test.ts`

**Interfaces:**

- Consumes: `validateFullName`, `NAME_FIXTURES` from `@cribliv/shared-types` (Task 1).
- Produces:
  - `validateFullName` — re-exported for convenience.
  - `hasName(name: string | null | undefined): boolean`
  - `namePromptDismissKey(userId: string): string`
  - `isNamePromptDismissed(userId: string, storage: Storage): boolean`
  - `markNamePromptDismissed(userId: string, storage: Storage): void`
  - `isSuppressedPath(pathname: string | null): boolean`
  - `shouldShowNamePrompt(input: ShouldShowNamePromptInput): boolean`
  - `fetchFullName(token: string): Promise<string | null>`
  - `saveFullName(token: string, name: string): Promise<void>`
  - `PROMPTABLE_ROLES: readonly ["tenant", "owner", "pg_operator"]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/name-capture.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasName,
  isNamePromptDismissed,
  isSuppressedPath,
  markNamePromptDismissed,
  namePromptDismissKey,
  shouldShowNamePrompt
} from "../name-capture";

/** Minimal in-memory Storage so these stay pure — no jsdom needed. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (k: string) => {
      return map.get(k) ?? null;
    },
    key: (i: number) => {
      return Array.from(map.keys())[i] ?? null;
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    }
  };
}

const base = {
  status: "authenticated" as const,
  role: "tenant" as const,
  name: null as string | null | undefined,
  userId: "u1",
  pathname: "/en",
  storage: undefined as Storage | undefined,
  welcomePending: false
};

describe("hasName", () => {
  it.each([null, undefined, "", "   "])("is false for %j", (value) => {
    expect(hasName(value)).toBe(false);
  });

  it("is true for a real name", () => {
    expect(hasName("Asha")).toBe(true);
  });
});

describe("isSuppressedPath", () => {
  it.each(["/en/auth/login", "/auth/login", "/hi/auth/login", "/en/admin", "/en/admin/leads"])(
    "suppresses %s",
    (path) => {
      expect(isSuppressedPath(path)).toBe(true);
    }
  );

  it.each(["/en", "/en/listing/abc", "/hi/pg", null])("does not suppress %j", (path) => {
    expect(isSuppressedPath(path)).toBe(false);
  });
});

describe("dismissal flag", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeStorage();
  });

  it("is namespaced per user", () => {
    expect(namePromptDismissKey("u1")).toBe("cribliv:name-prompt-dismissed:u1");
  });

  it("records a dismissal", () => {
    expect(isNamePromptDismissed("u1", storage)).toBe(false);
    markNamePromptDismissed("u1", storage);
    expect(isNamePromptDismissed("u1", storage)).toBe(true);
  });

  it("does not leak across users", () => {
    markNamePromptDismissed("u1", storage);
    expect(isNamePromptDismissed("u2", storage)).toBe(false);
  });

  it("treats a throwing storage as not-dismissed", () => {
    const hostile = {
      ...makeStorage(),
      getItem: () => {
        throw new Error("blocked");
      }
    } as unknown as Storage;
    expect(isNamePromptDismissed("u1", hostile)).toBe(false);
  });
});

describe("shouldShowNamePrompt", () => {
  it("shows for an authenticated nameless tenant", () => {
    expect(shouldShowNamePrompt({ ...base, storage: makeStorage() })).toBe(true);
  });

  it.each(["owner", "pg_operator"] as const)("shows for %s", (role) => {
    expect(shouldShowNamePrompt({ ...base, role, storage: makeStorage() })).toBe(true);
  });

  it("never shows for admin", () => {
    expect(shouldShowNamePrompt({ ...base, role: "admin", storage: makeStorage() })).toBe(false);
  });

  it("does not show when a name exists", () => {
    expect(shouldShowNamePrompt({ ...base, name: "Asha", storage: makeStorage() })).toBe(false);
  });

  it("does show for a whitespace-only name, which is not a name", () => {
    expect(shouldShowNamePrompt({ ...base, name: "   ", storage: makeStorage() })).toBe(true);
  });

  it.each(["loading", "unauthenticated"] as const)("does not show when status is %s", (status) => {
    expect(shouldShowNamePrompt({ ...base, status, storage: makeStorage() })).toBe(false);
  });

  it("does not show on a suppressed path", () => {
    expect(
      shouldShowNamePrompt({ ...base, pathname: "/en/auth/login", storage: makeStorage() })
    ).toBe(false);
  });

  it("does not show once dismissed", () => {
    const storage = makeStorage();
    markNamePromptDismissed("u1", storage);
    expect(shouldShowNamePrompt({ ...base, storage })).toBe(false);
  });

  it("does not show while the welcome-credits modal is pending", () => {
    // Both overlays lock body scroll and trap focus; two at once fight.
    expect(shouldShowNamePrompt({ ...base, welcomePending: true, storage: makeStorage() })).toBe(
      false
    );
  });

  it("does not show without a userId", () => {
    expect(shouldShowNamePrompt({ ...base, userId: undefined, storage: makeStorage() })).toBe(
      false
    );
  });

  it("shows when storage is unavailable rather than staying silent", () => {
    expect(shouldShowNamePrompt({ ...base, storage: undefined })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/name-capture.test.ts`
Expected: FAIL — cannot resolve `../name-capture`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/name-capture.ts`:

```ts
/**
 * apps/web/lib/name-capture.ts
 *
 * Decision layer for the name-capture prompt. Pure and storage-injected
 * (Storage is passed in, never reached for) so it unit-tests without jsdom —
 * same shape as lib/welcome-credits.ts.
 *
 * The name *rules* are not here: they live in @cribliv/shared-types so apps/api
 * validates identically. This module owns only the web's decisions — when to
 * prompt, whether the user already said no, and how to read/write the name.
 */

import { validateFullName } from "@cribliv/shared-types";
import { getApiBaseUrl } from "./api";

export { validateFullName };

export const PROMPTABLE_ROLES = ["tenant", "owner", "pg_operator"] as const;
export type PromptableRole = (typeof PROMPTABLE_ROLES)[number];

/**
 * Paths where a global overlay must not open.
 *
 * /auth/* is a genuine race, documented in welcome-credits-modal.tsx: signIn()
 * flips the client session to authenticated a tick before the login page's
 * window.location.href fires, so a globally-mounted modal opens on the login
 * page and is torn down mid-redirect. /admin is belt-and-braces — admins are
 * excluded by role anyway.
 */
const SUPPRESSED_PATHS = [/\/auth(\/|$)/, /(^|\/)admin(\/|$)/];

export function isSuppressedPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return SUPPRESSED_PATHS.some((pattern) => pattern.test(pathname));
}

/** Treats null, undefined, "" and whitespace-only alike — all mean "no name". */
export function hasName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim().length > 0;
}

export function namePromptDismissKey(userId: string): string {
  return `cribliv:name-prompt-dismissed:${userId}`;
}

export function isNamePromptDismissed(userId: string, storage: Storage): boolean {
  try {
    return storage.getItem(namePromptDismissKey(userId)) !== null;
  } catch {
    // Storage blocked (private mode, quota). Prefer asking over going silent.
    return false;
  }
}

export function markNamePromptDismissed(userId: string, storage: Storage): void {
  try {
    storage.setItem(namePromptDismissKey(userId), new Date().toISOString());
  } catch {
    // The provider's in-render ref still prevents a repeat this session.
  }
}

export interface ShouldShowNamePromptInput {
  status: "authenticated" | "loading" | "unauthenticated";
  role: string | undefined;
  name: string | null | undefined;
  userId: string | undefined;
  pathname: string | null;
  /** Omitted when sessionStorage is unavailable. */
  storage: Storage | undefined;
  /** True while the welcome-credits celebration is pending or on screen. */
  welcomePending: boolean;
}

/**
 * The ambient (moment 3) trigger only. The contact gate (moment 4) ignores all
 * of this — it is unskippable and resolves the name from the API instead.
 */
export function shouldShowNamePrompt(input: ShouldShowNamePromptInput): boolean {
  if (input.status !== "authenticated") return false;
  if (!input.userId) return false;
  if (!input.role || !PROMPTABLE_ROLES.includes(input.role as PromptableRole)) return false;
  if (hasName(input.name)) return false;
  if (isSuppressedPath(input.pathname)) return false;
  if (input.welcomePending) return false;
  if (input.storage && isNamePromptDismissed(input.userId, input.storage)) return false;
  return true;
}

/**
 * Server-authoritative name lookup.
 *
 * The contact gate must use this rather than session.user.name: the unlock panel
 * authenticates via POST /auth/otp/verify + writeAuthSession() straight to
 * localStorage, bypassing NextAuth entirely, so those users have no NextAuth
 * session and session.user.name is undefined regardless of whether they have a
 * name. Gating on the session there would re-prompt named users on every click.
 */
export async function fetchFullName(token: string): Promise<string | null> {
  const res = await fetch(`${getApiBaseUrl()}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  if (!res.ok) {
    throw new Error(`Failed to load profile (${res.status})`);
  }
  const payload = (await res.json()) as { data: { full_name: string | null } };
  return payload.data.full_name ?? null;
}

export async function saveFullName(token: string, name: string): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/users/me`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ full_name: name })
  });
  if (!res.ok) {
    throw new Error(`Failed to save name (${res.status})`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/name-capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify `getApiBaseUrl` is the right import**

Run: `grep -n "export function getApiBaseUrl\|export const getApiBaseUrl" apps/web/lib/api.ts`
Expected: one match. `settings-client.tsx` already calls `getApiBaseUrl()` for exactly these two endpoints — match it. If the export is named differently, use whatever `settings-client.tsx:62` imports.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/name-capture.ts apps/web/lib/__tests__/name-capture.test.ts
git commit -m "feat(web): add name-capture decision module"
```

---

### Task 6: Copy

**Files:**

- Modify: `apps/web/lib/i18n.ts` (append to the `dictionary` object, before the closing `};`)

**Interfaces:**

- Consumes: nothing.
- Produces: the keys below, all reachable via `t(locale, key)`.

Role-dependent framing: a tenant is told the owner will see who is calling; an owner is told seekers will see the name on their listings. The unskippable variant names the reason it is being asked _now_.

- [ ] **Step 1: Add the keys**

In `apps/web/lib/i18n.ts`, immediately before the `};` that closes `dictionary`:

```ts
  nameCaptureTitle: { en: "What should we call you?", hi: "हम आपको क्या कहें?" },
  nameCaptureTitleRequired: {
    en: "Add your name to continue",
    hi: "जारी रखने के लिए अपना नाम जोड़ें"
  },
  nameCaptureBodyTenant: {
    en: "Owners see your name when you contact them, so they know who's calling.",
    hi: "जब आप ओनर से संपर्क करते हैं तो उन्हें आपका नाम दिखता है, ताकि वे जानें कि कौन कॉल कर रहा है।"
  },
  nameCaptureBodyOwner: {
    en: "Seekers see your name on your listings. Listings with a name get more enquiries.",
    hi: "खोजने वालों को आपकी लिस्टिंग पर आपका नाम दिखता है। नाम वाली लिस्टिंग को ज़्यादा पूछताछ मिलती है।"
  },
  nameCaptureBodyContact: {
    en: "The owner will see this name when you contact them.",
    hi: "जब आप संपर्क करेंगे तो ओनर को यह नाम दिखेगा।"
  },
  nameCaptureLabel: { en: "Your name", hi: "आपका नाम" },
  nameCapturePlaceholder: { en: "e.g. Asha Devi", hi: "उदा. आशा देवी" },
  nameCaptureSave: { en: "Save", hi: "सेव करें" },
  nameCaptureSaving: { en: "Saving…", hi: "सेव हो रहा है…" },
  nameCaptureSaveAndContinue: { en: "Save and continue", hi: "सेव करें और जारी रखें" },
  nameCaptureSkip: { en: "Not now", hi: "अभी नहीं" },
  nameCaptureClose: { en: "Close", hi: "बंद करें" },
  nameCaptureError: {
    en: "Couldn't save your name. Please try again.",
    hi: "आपका नाम सेव नहीं हो सका। कृपया फिर कोशिश करें।"
  },
  nameCaptureTooShort: {
    en: "Please enter at least 2 characters.",
    hi: "कृपया कम से कम 2 अक्षर दर्ज करें।"
  },
  nameCaptureInvalid: {
    en: "Please enter a valid name.",
    hi: "कृपया एक मान्य नाम दर्ज करें।"
  }
```

- [ ] **Step 2: Verify every key resolves in both locales**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/name-capture.test.ts`

Then add this test to `apps/web/lib/__tests__/name-capture.test.ts`:

```ts
import { locales, t } from "../i18n";

describe("name-capture copy", () => {
  const keys = [
    "nameCaptureTitle",
    "nameCaptureTitleRequired",
    "nameCaptureBodyTenant",
    "nameCaptureBodyOwner",
    "nameCaptureBodyContact",
    "nameCaptureLabel",
    "nameCapturePlaceholder",
    "nameCaptureSave",
    "nameCaptureSaving",
    "nameCaptureSaveAndContinue",
    "nameCaptureSkip",
    "nameCaptureClose",
    "nameCaptureError",
    "nameCaptureTooShort",
    "nameCaptureInvalid"
  ];

  // t() returns the key itself when missing, which would otherwise ship as
  // visible gibberish like "nameCaptureSave" in the UI.
  it.each(locales)("resolves every key in %s", (locale) => {
    for (const key of keys) {
      expect(t(locale, key)).not.toBe(key);
    }
  });
});
```

- [ ] **Step 3: Run it**

Run: `pnpm --filter @cribliv/web test -- lib/__tests__/name-capture.test.ts`
Expected: PASS for both `en` and `hi`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/i18n.ts apps/web/lib/__tests__/name-capture.test.ts
git commit -m "feat(web): add name-capture copy in en and hi"
```

---

### Task 7: NameCaptureForm

The shared input. No chrome, no modal, no positioning — moments 1 and 2 render it inline inside an
existing card, moments 3 and 4 render it inside `NameCaptureModal`.

**Files:**

- Create: `apps/web/components/name-capture/name-capture-form.tsx`
- Test: `apps/web/components/name-capture/__tests__/name-capture-form.test.tsx`

**Interfaces:**

- Consumes: `validateFullName`, `saveFullName` from `lib/name-capture` (Task 5); copy keys from Task 6.
- Produces:

```ts
export interface NameCaptureFormProps {
  locale: Locale;
  /** Drives which body copy renders. */
  variant: "tenant" | "owner" | "contact";
  token: string;
  /** Omitted for the unskippable variants. When absent, no skip control renders. */
  onSkip?: () => void;
  onSaved: (name: string) => void;
  /** Label override; defaults to nameCaptureSave. */
  submitLabelKey?: string;
  autoFocus?: boolean;
}
export function NameCaptureForm(props: NameCaptureFormProps): JSX.Element;
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/name-capture/__tests__/name-capture-form.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NameCaptureForm } from "../name-capture-form";

const saveFullName = vi.fn();
vi.mock("../../../lib/name-capture", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/name-capture")>(
    "../../../lib/name-capture"
  );
  return {
    ...actual,
    saveFullName: (...args: unknown[]) => {
      return saveFullName(...args);
    }
  };
});

function setup(overrides: Partial<React.ComponentProps<typeof NameCaptureForm>> = {}) {
  const onSaved = vi.fn();
  const onSkip = vi.fn();
  render(
    <NameCaptureForm
      locale="en"
      variant="tenant"
      token="acc_test"
      onSaved={onSaved}
      onSkip={onSkip}
      {...overrides}
    />
  );
  return { onSaved, onSkip };
}

describe("NameCaptureForm", () => {
  beforeEach(() => {
    // Braced: Vitest treats a returned value as a teardown callback, and
    // mockReset returns the mock — an unbraced arrow silently breaks teardown.
    saveFullName.mockReset();
    saveFullName.mockResolvedValue(undefined);
  });

  it("saves a valid name and reports it upward", async () => {
    const { onSaved } = setup();
    await userEvent.type(screen.getByLabelText("Your name"), "Asha Devi");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveFullName).toHaveBeenCalledWith("acc_test", "Asha Devi");
    });
    expect(onSaved).toHaveBeenCalledWith("Asha Devi");
  });

  it("submits the normalised name, not the raw input", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Your name"), "  Asha   Devi  ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(saveFullName).toHaveBeenCalledWith("acc_test", "Asha Devi");
    });
  });

  it("rejects a too-short name without calling the API", async () => {
    const { onSaved } = setup();
    await userEvent.type(screen.getByLabelText("Your name"), "A");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(saveFullName).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("rejects angle brackets", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("Your name"), "<b>Asha</b>");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(saveFullName).not.toHaveBeenCalled();
  });

  it("refuses to submit an empty name", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(saveFullName).not.toHaveBeenCalled();
  });

  it("surfaces an API failure and does not report success", async () => {
    saveFullName.mockRejectedValue(new Error("500"));
    const { onSaved } = setup();
    await userEvent.type(screen.getByLabelText("Your name"), "Asha Devi");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Couldn't save/i);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("clears a validation error once the user edits", async () => {
    setup();
    const input = screen.getByLabelText("Your name");
    await userEvent.type(input, "A");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.type(input, "sha");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a skip control when onSkip is provided", async () => {
    const { onSkip } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("renders no skip control when onSkip is omitted", () => {
    render(<NameCaptureForm locale="en" variant="contact" token="acc_test" onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Not now" })).not.toBeInTheDocument();
  });

  it("shows owner-specific copy for the owner variant", () => {
    setup({ variant: "owner" });
    expect(screen.getByText(/Seekers see your name/i)).toBeInTheDocument();
  });

  it("shows contact-specific copy for the contact variant", () => {
    setup({ variant: "contact" });
    expect(screen.getByText(/The owner will see this name/i)).toBeInTheDocument();
  });

  it("disables the submit control while in flight", async () => {
    let resolve: () => void = () => {};
    saveFullName.mockImplementation(() => {
      return new Promise<void>((r) => {
        resolve = r;
      });
    });
    setup();
    await userEvent.type(screen.getByLabelText("Your name"), "Asha Devi");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    resolve();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- components/name-capture/__tests__/name-capture-form.test.tsx`
Expected: FAIL — cannot resolve `../name-capture-form`.

- [ ] **Step 3: Write the component**

Create `apps/web/components/name-capture/name-capture-form.tsx`:

```tsx
"use client";

import { useCallback, useId, useState } from "react";
import { t, type Locale } from "../../lib/i18n";
import { saveFullName, validateFullName } from "../../lib/name-capture";

export interface NameCaptureFormProps {
  locale: Locale;
  variant: "tenant" | "owner" | "contact";
  token: string;
  /** Omitted for unskippable variants — no skip control renders without it. */
  onSkip?: () => void;
  onSaved: (name: string) => void;
  submitLabelKey?: string;
  autoFocus?: boolean;
}

const BODY_KEY: Record<NameCaptureFormProps["variant"], string> = {
  tenant: "nameCaptureBodyTenant",
  owner: "nameCaptureBodyOwner",
  contact: "nameCaptureBodyContact"
};

export function NameCaptureForm({
  locale,
  variant,
  token,
  onSkip,
  onSaved,
  submitLabelKey = "nameCaptureSave",
  autoFocus = true
}: NameCaptureFormProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const errorId = `${inputId}-error`;

  const onSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (saving) return;

      // Validated with the same module the API uses, so a name that passes here
      // cannot 400 on the server for a rule reason.
      const parsed = validateFullName(value);
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
      if (parsed.value === null) {
        // Blank means "clear my name" elsewhere; in a capture prompt it is just
        // an empty submit, so re-use the too-short message rather than saving.
        setError(t(locale, "nameCaptureTooShort"));
        return;
      }

      setSaving(true);
      setError(null);
      try {
        await saveFullName(token, parsed.value);
        onSaved(parsed.value);
      } catch {
        setError(t(locale, "nameCaptureError"));
      } finally {
        setSaving(false);
      }
    },
    [locale, onSaved, saving, token, value]
  );

  return (
    <form className="name-capture-form" onSubmit={onSubmit} noValidate>
      <p className="name-capture-form__body">{t(locale, BODY_KEY[variant])}</p>

      <label className="name-capture-form__label" htmlFor={inputId}>
        {t(locale, "nameCaptureLabel")}
      </label>
      <input
        id={inputId}
        className="input"
        type="text"
        value={value}
        autoFocus={autoFocus}
        autoComplete="name"
        maxLength={80}
        placeholder={t(locale, "nameCapturePlaceholder")}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        data-testid="name-capture-input"
        onChange={(event) => {
          setValue(event.target.value);
          // Clear on edit: leaving a stale error under a now-valid field reads
          // as the form being broken.
          if (error) setError(null);
        }}
      />

      {error ? (
        <p className="name-capture-form__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}

      <div className="name-capture-form__actions">
        <button
          type="submit"
          className="btn btn--primary"
          disabled={saving}
          data-testid="name-capture-submit"
        >
          {saving ? t(locale, "nameCaptureSaving") : t(locale, submitLabelKey)}
        </button>
        {onSkip ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onSkip}
            disabled={saving}
            data-testid="name-capture-skip"
          >
            {t(locale, "nameCaptureSkip")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- components/name-capture/__tests__/name-capture-form.test.tsx`
Expected: PASS (12 tests).

- [ ] **Step 5: Add the styles**

Append to `apps/web/app/globals.css`:

```css
/* ── Name capture ─────────────────────────────────────────────────────────── */
.name-capture-form__body {
  margin: 0 0 12px;
  color: var(--text-muted, #5a6472);
  font-size: 14px;
  line-height: 1.5;
}
.name-capture-form__label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
}
.name-capture-form__error {
  margin: 8px 0 0;
  color: var(--danger, #c62828);
  font-size: 13px;
}
.name-capture-form__actions {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 16px;
}
```

Check the existing custom-property names in `globals.css` first (`grep -n "\-\-text-muted\|\-\-danger" apps/web/app/globals.css`) and use whatever that file already defines; the fallbacks above only apply if the variable is missing.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/name-capture/name-capture-form.tsx apps/web/components/name-capture/__tests__/name-capture-form.test.tsx apps/web/app/globals.css
git commit -m "feat(web): add NameCaptureForm"
```

---

### Task 8: NameCaptureModal

**Files:**

- Create: `apps/web/components/name-capture/name-capture-modal.tsx`

**Interfaces:**

- Consumes: `NameCaptureForm` (Task 7).
- Produces:

```ts
export interface NameCaptureModalProps {
  locale: Locale;
  variant: "tenant" | "owner" | "contact";
  token: string;
  /** When true: no skip button, no overlay-click close, no Esc. */
  required: boolean;
  onSaved: (name: string) => void;
  onDismiss: () => void;
}
export function NameCaptureModal(props: NameCaptureModalProps): JSX.Element;
```

- [ ] **Step 1: Write the component**

Follow the house modal contract: the global `.modal-overlay` / `.modal` / `.modal__header|__title|__close|__body` classes from `globals.css:5454+`, overlay-click-to-close via `e.target === e.currentTarget`, `role="dialog"` + `aria-modal`, and a `data-testid`. Focus trap, scroll lock, and focus restore mirror `welcome-credits-modal.tsx:151-193`.

Create `apps/web/components/name-capture/name-capture-modal.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import { t, type Locale } from "../../lib/i18n";
import { NameCaptureForm } from "./name-capture-form";

export interface NameCaptureModalProps {
  locale: Locale;
  variant: "tenant" | "owner" | "contact";
  token: string;
  required: boolean;
  onSaved: (name: string) => void;
  onDismiss: () => void;
}

export function NameCaptureModal({
  locale,
  variant,
  token,
  required,
  onSaved,
  onDismiss
}: NameCaptureModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const dismiss = useCallback(() => {
    // The required variant has no exit that isn't saving.
    if (required) return;
    onDismiss();
  }, [onDismiss, required]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    headingRef.current?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (required) {
        // Swallow it: without this the browser may still blur/close things and
        // the user perceives a dismissable dialog that isn't.
        event.preventDefault();
        return;
      }
      event.preventDefault();
      onDismiss();
    };

    // Keep focus inside the dialog. Simpler than welcome-credits' explicit
    // first/last refs because this dialog's controls are not fixed in number.
    const onFocusIn = (event: FocusEvent) => {
      const node = event.target;
      if (node instanceof Node && !dialogRef.current?.contains(node)) {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        (focusables?.[0] ?? headingRef.current)?.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [onDismiss, required]);

  const titleKey = required ? "nameCaptureTitleRequired" : "nameCaptureTitle";

  return (
    <div
      className="modal-overlay name-capture-overlay"
      role="dialog"
      aria-modal
      aria-label={t(locale, titleKey)}
      data-testid="name-capture-modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className="modal name-capture-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal__header">
          <h2 className="modal__title" ref={headingRef} tabIndex={-1}>
            {t(locale, titleKey)}
          </h2>
          {required ? null : (
            <button
              type="button"
              className="modal__close"
              aria-label={t(locale, "nameCaptureClose")}
              onClick={onDismiss}
              data-testid="name-capture-close"
            >
              ✕
            </button>
          )}
        </div>
        <div className="modal__body">
          <NameCaptureForm
            locale={locale}
            variant={variant}
            token={token}
            onSaved={onSaved}
            onSkip={required ? undefined : onDismiss}
            submitLabelKey={required ? "nameCaptureSaveAndContinue" : "nameCaptureSave"}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the overlay z-index**

`WelcomeCreditsModal` uses its own `.welcome-reward-overlay` at `z-index: 120`, above the shared `.modal-overlay` at 100. The name modal must sit _below_ the welcome modal so that if both ever mount the celebration still wins. Append to `apps/web/app/globals.css`:

```css
.name-capture-overlay {
  z-index: 110;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/name-capture/name-capture-modal.tsx apps/web/app/globals.css
git commit -m "feat(web): add NameCaptureModal with a required mode"
```

---

### Task 9: NamePromptProvider

The ambient trigger and the promise-based gate, in one context so the four call sites in Tasks 11–12
are each a single `await requireName(...)`.

**Files:**

- Create: `apps/web/components/name-capture/name-prompt-provider.tsx`
- Modify: `apps/web/app/[locale]/layout.tsx`
- Test: `apps/web/components/name-capture/__tests__/name-prompt-provider.test.tsx`

**Interfaces:**

- Consumes: `shouldShowNamePrompt`, `hasName`, `fetchFullName`, `markNamePromptDismissed` (Task 5); `NameCaptureModal` (Task 8); `shouldShowWelcome` from `lib/welcome-credits`.
- Produces:

```ts
/** Resolves true once a name is on file, false if the user backed out. */
export type RequireName = (opts: { token: string }) => Promise<boolean>;
export function useNamePrompt(): { requireName: RequireName };
export function NamePromptProvider(props: {
  locale: Locale;
  children?: React.ReactNode;
}): JSX.Element;
```

`useNamePrompt()` outside the provider must not throw — it returns a `requireName` that resolves
`true`, so a component rendered in isolation (or in an existing test) keeps working and never blocks
a contact action on missing context.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/name-capture/__tests__/name-prompt-provider.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NamePromptProvider, useNamePrompt } from "../name-prompt-provider";

const useSession = vi.fn();
vi.mock("next-auth/react", () => {
  return {
    useSession: () => {
      return useSession();
    }
  };
});

const usePathname = vi.fn();
vi.mock("next/navigation", () => {
  return {
    usePathname: () => {
      return usePathname();
    }
  };
});

const fetchFullName = vi.fn();
const saveFullName = vi.fn();
vi.mock("../../../lib/name-capture", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/name-capture")>(
    "../../../lib/name-capture"
  );
  return {
    ...actual,
    fetchFullName: (...args: unknown[]) => {
      return fetchFullName(...args);
    },
    saveFullName: (...args: unknown[]) => {
      return saveFullName(...args);
    }
  };
});

function authed(overrides: Record<string, unknown> = {}) {
  return {
    status: "authenticated",
    data: {
      user: { id: "u1", role: "tenant", name: undefined },
      accessToken: "acc_test",
      isNewUser: false,
      ...overrides
    }
  };
}

function Consumer() {
  const { requireName } = useNamePrompt();
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await requireName({ token: "acc_test" });
        document.title = ok ? "granted" : "refused";
      }}
    >
      go
    </button>
  );
}

describe("NamePromptProvider — ambient prompt", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/en");
    useSession.mockReturnValue(authed());
    fetchFullName.mockReset();
    fetchFullName.mockResolvedValue(null);
    saveFullName.mockReset();
    saveFullName.mockResolvedValue(undefined);
    window.sessionStorage.clear();
    document.title = "";
  });

  it("opens for an authenticated nameless tenant", async () => {
    render(<NamePromptProvider locale="en" />);
    expect(await screen.findByTestId("name-capture-modal")).toBeInTheDocument();
  });

  it("stays shut when the user has a name", () => {
    useSession.mockReturnValue(authed({ user: { id: "u1", role: "tenant", name: "Asha" } }));
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("stays shut for admin", () => {
    useSession.mockReturnValue(authed({ user: { id: "u1", role: "admin", name: undefined } }));
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("stays shut on the login page", () => {
    usePathname.mockReturnValue("/en/auth/login");
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("stays shut while the welcome-credits modal is pending", () => {
    useSession.mockReturnValue(
      authed({ isNewUser: true, signupReward: { creditsGranted: 50, expiresAt: null } })
    );
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("is dismissable and does not reopen in the same session", async () => {
    const { unmount } = render(<NamePromptProvider locale="en" />);
    await userEvent.click(await screen.findByTestId("name-capture-skip"));
    await waitFor(() => {
      expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
    });

    unmount();
    render(<NamePromptProvider locale="en" />);
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("closes after a successful save", async () => {
    render(<NamePromptProvider locale="en" />);
    await userEvent.type(await screen.findByTestId("name-capture-input"), "Asha Devi");
    await userEvent.click(screen.getByTestId("name-capture-submit"));
    await waitFor(() => {
      expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
    });
  });
});

describe("NamePromptProvider — requireName gate", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/en/listing/abc");
    // Named, so the ambient prompt stays out of the way of these assertions.
    useSession.mockReturnValue(authed({ user: { id: "u1", role: "tenant", name: "Asha" } }));
    fetchFullName.mockReset();
    saveFullName.mockReset();
    saveFullName.mockResolvedValue(undefined);
    window.sessionStorage.clear();
    document.title = "";
  });

  it("resolves true immediately when the API says a name exists", async () => {
    fetchFullName.mockResolvedValue("Asha Devi");
    render(
      <NamePromptProvider locale="en">
        <Consumer />
      </NamePromptProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(document.title).toBe("granted");
    });
    expect(screen.queryByTestId("name-capture-modal")).not.toBeInTheDocument();
  });

  it("opens an unskippable modal when there is no name, then resolves true on save", async () => {
    fetchFullName.mockResolvedValue(null);
    render(
      <NamePromptProvider locale="en">
        <Consumer />
      </NamePromptProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));

    expect(await screen.findByTestId("name-capture-modal")).toBeInTheDocument();
    // Required mode: no skip, no close.
    expect(screen.queryByTestId("name-capture-skip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("name-capture-close")).not.toBeInTheDocument();

    await userEvent.type(screen.getByTestId("name-capture-input"), "Asha Devi");
    await userEvent.click(screen.getByTestId("name-capture-submit"));
    await waitFor(() => {
      expect(document.title).toBe("granted");
    });
  });

  it("resolves true rather than blocking when the name lookup fails", async () => {
    // A dead /auth/me must not make the product unusable — fail open.
    fetchFullName.mockRejectedValue(new Error("offline"));
    render(
      <NamePromptProvider locale="en">
        <Consumer />
      </NamePromptProvider>
    );
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(document.title).toBe("granted");
    });
  });

  it("resolves true outside a provider so isolated components still work", async () => {
    render(<Consumer />);
    await userEvent.click(screen.getByRole("button", { name: "go" }));
    await waitFor(() => {
      expect(document.title).toBe("granted");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- components/name-capture/__tests__/name-prompt-provider.test.tsx`
Expected: FAIL — cannot resolve `../name-prompt-provider`.

- [ ] **Step 3: Write the provider**

Create `apps/web/components/name-capture/name-prompt-provider.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import type { Locale } from "../../lib/i18n";
import {
  fetchFullName,
  hasName,
  markNamePromptDismissed,
  shouldShowNamePrompt,
  type PromptableRole
} from "../../lib/name-capture";
import { shouldShowWelcome } from "../../lib/welcome-credits";
import { NameCaptureModal } from "./name-capture-modal";

export type RequireName = (opts: { token: string }) => Promise<boolean>;

interface NamePromptContextValue {
  requireName: RequireName;
}

/**
 * Default resolves true. A component rendered outside the provider — in an
 * existing test, or on a route that doesn't mount it — must not have its
 * contact action silently blocked by missing context.
 */
const NamePromptContext = createContext<NamePromptContextValue>({
  requireName: async () => {
    return true;
  }
});

export function useNamePrompt(): NamePromptContextValue {
  return useContext(NamePromptContext);
}

type Pending = {
  token: string;
  resolve: (granted: boolean) => void;
};

export function NamePromptProvider({
  locale,
  children
}: {
  locale: Locale;
  children?: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const inFlightRef = useRef(false);

  const userId = session?.user?.id;
  const role = session?.user?.role as PromptableRole | undefined;
  const token = (session as { accessToken?: string } | null)?.accessToken;
  const storage = typeof window === "undefined" ? undefined : window.sessionStorage;

  /**
   * Both this and WelcomeCreditsModal lock body scroll and trap focus, so they
   * must never be on screen together. The credits celebration wins — it is the
   * reward moment; the name prompt returns on the next navigation.
   */
  const welcomePending =
    storage !== undefined &&
    shouldShowWelcome({
      isNewUser: session?.isNewUser,
      userId,
      creditsGranted: session?.signupReward?.creditsGranted,
      storage: window.localStorage
    });

  const ambientOpen =
    !dismissed &&
    !pending &&
    shouldShowNamePrompt({
      status,
      role,
      name: session?.user?.name,
      userId,
      pathname,
      storage,
      welcomePending
    });

  const requireName = useCallback<RequireName>(async ({ token: callerToken }) => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    try {
      // Server-authoritative: the unlock panel's users may have no NextAuth
      // session at all, so session.user.name cannot answer this.
      const current = await fetchFullName(callerToken);
      if (hasName(current)) return true;
      return await new Promise<boolean>((resolve) => {
        setPending({ token: callerToken, resolve });
      });
    } catch {
      // Fail open. A dead /auth/me must not make contacting an owner
      // impossible — the worst case is one lead with no name attached.
      return true;
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  const value = useMemo(() => {
    return { requireName };
  }, [requireName]);

  const variant: "tenant" | "owner" | "contact" = pending
    ? "contact"
    : role === "owner" || role === "pg_operator"
      ? "owner"
      : "tenant";

  const activeToken = pending?.token ?? token;

  return (
    <NamePromptContext.Provider value={value}>
      {children}
      {activeToken && (ambientOpen || pending) ? (
        <NameCaptureModal
          locale={locale}
          variant={variant}
          token={activeToken}
          required={Boolean(pending)}
          onSaved={() => {
            if (pending) {
              pending.resolve(true);
              setPending(null);
              return;
            }
            // The SessionProvider's 30s refetch will pick the name up; hide now
            // so the user isn't looking at a dialog they already completed.
            setDismissed(true);
          }}
          onDismiss={() => {
            if (pending) {
              // Unreachable in required mode, but keep the promise from leaking.
              pending.resolve(false);
              setPending(null);
              return;
            }
            setDismissed(true);
            if (userId && storage) markNamePromptDismissed(userId, storage);
          }}
        />
      ) : null}
    </NamePromptContext.Provider>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- components/name-capture/__tests__/name-prompt-provider.test.tsx`
Expected: PASS (11 tests).

- [ ] **Step 5: Mount it**

In `apps/web/app/[locale]/layout.tsx`, add the import and wrap the existing tree. The provider must be an **ancestor** of `LocaleChrome` so page content can call `useNamePrompt()`:

```tsx
import { NamePromptProvider } from "../../components/name-capture/name-prompt-provider";
```

Replace the `<ToastProvider>` block with:

```tsx
<ToastProvider>
  <NamePromptProvider locale={params.locale as Locale}>
    <LocaleChrome locale={params.locale as Locale} navData={navData}>
      {children}
    </LocaleChrome>
  </NamePromptProvider>
  <WelcomeCreditsModal locale={params.locale as Locale} />
  <WhatsappFab />
</ToastProvider>
```

Confirm the relative import path resolves from `app/[locale]/layout.tsx` — the file already imports siblings, so match their depth rather than assuming `../../`.

- [ ] **Step 6: Typecheck and run the full web suite**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web test`
Expected: PASS. Any component test that renders a subtree calling `useNamePrompt()` gets the default context, which resolves `true`, so nothing should newly fail.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/name-capture/name-prompt-provider.tsx apps/web/components/name-capture/__tests__/name-prompt-provider.test.tsx "apps/web/app/[locale]/layout.tsx"
git commit -m "feat(web): add NamePromptProvider with ambient prompt and requireName gate"
```

---

### Task 10: Moment 1 — name step in the login flow

Fires for **any** nameless user finishing OTP, not just new ones: an existing nameless user logging
in gets this calm in-flow step rather than a modal on landing. This is also what makes "every login
until answered" hold without depending on storage — the step ignores the dismissal flag.

**Files:**

- Modify: `apps/web/app/[locale]/auth/login/page.tsx`

**Interfaces:**

- Consumes: `NameCaptureForm` (Task 7); `hasName`, `markNamePromptDismissed` (Task 5).
- Produces: nothing other tasks depend on.

**⚠ The page redirects itself away.** The effect at `:219-223` calls `window.location.replace(...)`
the moment `status === "authenticated"`. `signIn()` flips the session to authenticated _before_
step 3 can render, so without suppressing that guard the name step is torn down mid-typing. This is
the single thing most likely to be missed in this task.

Note `const locale = "en";` at `:79` — the page hardcodes the locale today. Use that existing
constant; do not introduce a second source of locale here.

- [ ] **Step 1: Widen the step state**

Change `:86`:

```tsx
const [step, setStep] = useState<1 | 2 | 3>(1);
```

Add alongside the other form state:

```tsx
// Where to go once the name step is done (saved or skipped).
const [pendingDest, setPendingDest] = useState<string | null>(null);
const [nameToken, setNameToken] = useState<string | null>(null);
const [nameUserId, setNameUserId] = useState<string | null>(null);
const [nameRole, setNameRole] = useState<string | null>(null);
```

- [ ] **Step 2: Add the imports**

```tsx
import { NameCaptureForm } from "../../../../components/name-capture/name-capture-form";
import { hasName, markNamePromptDismissed } from "../../../../lib/name-capture";
```

Verify the depth: from `app/[locale]/auth/login/page.tsx` the repo root of `apps/web` is four levels
up. Match whatever the file's existing relative imports use rather than trusting this count.

- [ ] **Step 3: Divert to the name step in `handleVerify`**

In `handleVerify`, replace the final redirect (`window.location.href = safeDest;` at `:202`) with:

```tsx
const safeDest = resolveAuthedDestination(role, fromPath, locale);

// Divert to the name step when the account has no name. Covers brand-new
// signups (always nameless) and existing users who never set one.
// session.user.name is populated by the /auth/me sync in the session
// callback, so it is authoritative by this point.
if (!hasName(session?.user?.name) && role !== "admin") {
  const token = (session as { accessToken?: string } | null)?.accessToken ?? null;
  if (token) {
    setNameToken(token);
    setNameUserId(session?.user?.id ?? null);
    setNameRole(role ?? null);
    setPendingDest(safeDest);
    setStep(3);
    return;
  }
}

window.location.href = safeDest;
```

Leave the surrounding comment about `window.location.href` in place — it explains a real middleware
cookie race and still applies to both exits below.

- [ ] **Step 4: Suppress the auto-redirect guard while the name step shows**

Change the effect at `:219-223` to:

```tsx
useEffect(() => {
  // step 3 is the post-verify name capture: the session IS authenticated
  // there by design, so this guard must stand down or it redirects the user
  // away mid-typing.
  if (step === 3) return;
  if (status === "authenticated") {
    window.location.replace(resolveAuthedDestination(session?.user?.role, fromPath, locale));
  }
}, [status, session, fromPath, locale, step]);
```

- [ ] **Step 5: Render the step**

Add a `step === 3` branch alongside the existing step 1 / step 2 render blocks. Match the
surrounding card markup and `fadeUp` motion the other steps use:

```tsx
{
  step === 3 && nameToken ? (
    <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
      <h1 className="auth-card__title">{t(locale, "nameCaptureTitle")}</h1>
      <NameCaptureForm
        locale={locale}
        variant={nameRole === "owner" || nameRole === "pg_operator" ? "owner" : "tenant"}
        token={nameToken}
        submitLabelKey="nameCaptureSaveAndContinue"
        onSaved={() => {
          if (pendingDest) window.location.href = pendingDest;
        }}
        onSkip={() => {
          // Suppress the ambient modal on landing — being asked twice in a
          // row reads as a broken form. It returns on the next login.
          if (nameUserId && typeof window !== "undefined") {
            markNamePromptDismissed(nameUserId, window.sessionStorage);
          }
          if (pendingDest) window.location.href = pendingDest;
        }}
      />
    </motion.div>
  ) : null;
}
```

Import `t` from `../../../../lib/i18n` if the file does not already. Check whether the existing steps
are rendered with `{step === 1 && (...)}` or a ternary chain and follow that shape.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/[locale]/auth/login/page.tsx"
git commit -m "feat(web): capture name as a step in the login flow

Fires for any nameless user, not just new signups, and suppresses the
already-authenticated redirect guard so the step survives long enough to fill in."
```

---

### Task 11: Moment 4 — gate the unlock panel

**Files:**

- Modify: `apps/web/components/unlock-contact-panel.tsx`

**Interfaces:**

- Consumes: `useNamePrompt` (Task 9).
- Produces: nothing.

**Design note — a deliberate simplification of the spec.** The spec described moment 2 as a new
`"name"` value in the panel's `authStep` union. It is not needed: `requireName()` already opens an
unskippable modal, which is the same experience with none of the extra render branch. Moments 2 and 4
therefore collapse into the same two guards below.

Only **two** insertion points are needed, not the four the spec counted:

- `onUnlockClick` (`:324`) — the logged-in click.
- `verifyOtpAndUnlock` (`:226`) — the guest who signs up inline.

`handleCreditsCaptured` (`:414`) needs **no** guard: it only ever runs after an unlock attempt
already failed with `insufficient_credits`, which means one of the two guards above already passed.
Gating it again would prompt a user who just paid.

`onNotifyClick` / `joinWaitlist` also need **no** guard: joining an availability waitlist is not
contacting an owner, and the spec scopes the gate to owner contact.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/components/__tests__/unlock-contact-purchase.test.tsx`, reusing its
`routeFetch` / `shortlistRoute` / `jsonOk` helpers rather than building a second harness. That file
mocks the **global `fetch`**, not `fetchApi`, so assertions inspect `fetch` call URLs.

Add the gate mock alongside the file's other `vi.mock` calls:

```tsx
const requireName = vi.fn();
vi.mock("../name-capture/name-prompt-provider", () => ({
  useNamePrompt: () => ({ requireName })
}));
```

Extend the file's existing `beforeEach` — **required**, or every pre-existing test in the file breaks
on an `undefined` gate result:

```tsx
requireName.mockReset();
requireName.mockResolvedValue(true);
```

Then add this block:

```tsx
describe("UnlockContactPanel name gate", () => {
  const unlockCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes("/tenant/contact-unlocks"));

  it("does not POST contact-unlocks when the gate refuses", async () => {
    requireName.mockResolvedValue(false);
    const fetchMock = routeFetch([shortlistRoute()]);
    vi.stubGlobal("fetch", fetchMock);

    render(<UnlockContactPanel listingId="listing-1" locale="en" />);
    fireEvent.click(screen.getByTestId("unlock-cta"));

    await waitFor(() => expect(requireName).toHaveBeenCalledWith({ token: "session-tok" }));
    // routeFetch throws on an unmocked call, so a leaked unlock would fail
    // loudly too — assert explicitly so the reason is unambiguous.
    expect(unlockCalls(fetchMock)).toHaveLength(0);
  });

  it("POSTs contact-unlocks once the gate grants", async () => {
    requireName.mockResolvedValue(true);
    const fetchMock = routeFetch([
      shortlistRoute(),
      {
        match: (url: string, init?: RequestInit) =>
          url.includes("/tenant/contact-unlocks") && init?.method === "POST",
        respond: () =>
          jsonOk({
            unlock_id: "unl_1",
            response_deadline_at: "2026-08-01T00:00:00.000Z"
          })
      },
      {
        match: (url: string) => url.includes("/wallet"),
        respond: () => jsonOk({ balance_credits: 5 })
      }
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(<UnlockContactPanel listingId="listing-1" locale="en" />);
    fireEvent.click(screen.getByTestId("unlock-cta"));

    await waitFor(() => expect(unlockCalls(fetchMock)).toHaveLength(1));
  });
});
```

`getByTestId("unlock-cta")` works because Step 3 of this task adds that testid to the button. Keep
the two in sync — the Task 13 E2E spec selects on it too.

One thing to resolve against the real file when implementing, rather than guessing:

1. **The wallet and unlock response shapes.** `refreshWalletSnapshot` runs after a successful unlock.
   Copy both route stubs verbatim from the existing successful-unlock test in that file instead of
   using the invented payloads above.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- components/__tests__/unlock-contact-purchase.test.tsx`
Expected: FAIL — the gate is not consulted, so the refuse case still POSTs.

- [ ] **Step 3: Add the hook and a stable CTA testid**

Add the import:

```tsx
import { useNamePrompt } from "./name-capture/name-prompt-provider";
```

and inside the component, near the other hooks:

```tsx
const { requireName } = useNamePrompt();
```

Also add `data-testid="unlock-cta"` to the panel's unlock button. Both the unit test in this task and
the E2E spec in Task 13 select on it, and the button's visible label is i18n-driven and varies by
flag branch — a testid is the only stable handle.

- [ ] **Step 4: Guard `onUnlockClick`**

```tsx
async function onUnlockClick() {
  // If the NextAuth session is still initialising, wait — don't prematurely
  // show the OTP form just because the token hasn't arrived yet.
  if (sessionStatus === "loading") return;

  if (!accessToken) {
    setAuthStep("otp_send");
    return;
  }
  // The owner sees this name on the lead. Resolved from the API, not the
  // session: this panel's users may hold a localStorage-only session.
  if (!(await requireName({ token: accessToken }))) return;
  await unlockContact(accessToken);
}
```

- [ ] **Step 5: Guard `verifyOtpAndUnlock`**

In `verifyOtpAndUnlock`, change the terminal branch to:

```tsx
// isUnavailable takes precedence: same OTP challenge, different
// terminal action — join the waitlist instead of unlocking the number.
if (isUnavailable) {
  // No name gate: a waitlist join is not owner contact.
  await joinWaitlist(verified.access_token);
} else {
  if (!(await requireName({ token: verified.access_token }))) return;
  await unlockContact(verified.access_token);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- components/__tests__/unlock-contact-purchase.test.tsx components/__tests__/unlock-panel-availability.test.tsx`
Expected: PASS. The availability suite must be unaffected — that path is deliberately ungated.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/unlock-contact-panel.tsx apps/web/components/__tests__/
git commit -m "feat(web): require a name before unlocking owner contact"
```

---

### Task 12: Gate the PG interest button

**Files:**

- Modify: `apps/web/components/pg/PgInterestButton.tsx`
- Test: `apps/web/components/pg/__tests__/PgInterestButton.test.tsx`

**Interfaces:**

- Consumes: `useNamePrompt` (Task 9).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

In `apps/web/components/pg/__tests__/PgInterestButton.test.tsx`, add the mock next to the existing
`vi.mock` calls at the top of the file (before the `import { PgInterestButton }` line, so hoisting
order matches the others):

```tsx
const requireName = vi.fn();
vi.mock("../../name-capture/name-prompt-provider", () => ({
  useNamePrompt: () => ({ requireName })
}));
```

Extend the existing `beforeEach` — **this is required, not optional.** The file's four existing tests
do not know about the gate; without a default of `true` the mock resolves `undefined`, the guard
treats it as a refusal, and every one of them fails:

```tsx
beforeEach(() => {
  expressPgInterest.mockReset();
  __session = null;
  requireName.mockReset();
  requireName.mockResolvedValue(true);
});
```

Then add:

```tsx
it("does not express interest when the name gate refuses", async () => {
  __session = { access_token: "tok_1" };
  requireName.mockResolvedValue(false);
  render(<PgInterestButton listingId="abc" locale="en" />);

  fireEvent.click(screen.getByRole("button", { name: /i'?m interested/i }));

  await waitFor(() => expect(requireName).toHaveBeenCalledWith({ token: "tok_1" }));
  expect(expressPgInterest).not.toHaveBeenCalled();
});

it("expresses interest once the name gate grants", async () => {
  __session = { access_token: "tok_1" };
  requireName.mockResolvedValue(true);
  expressPgInterest.mockResolvedValue({ interested: true, created: true, lead_id: "l1" });
  render(<PgInterestButton listingId="abc" locale="en" />);

  fireEvent.click(screen.getByRole("button", { name: /i'?m interested/i }));

  await waitFor(() => expect(screen.getByText(/has your interest/i)).toBeTruthy());
  expect(expressPgInterest).toHaveBeenCalledWith("abc", "tok_1", undefined);
});

it("does not leave the button spinning when the gate refuses", async () => {
  __session = { access_token: "tok_1" };
  requireName.mockResolvedValue(false);
  render(<PgInterestButton listingId="abc" locale="en" />);

  fireEvent.click(screen.getByRole("button", { name: /i'?m interested/i }));

  // The guard runs before setState("loading"), so the CTA stays clickable.
  await waitFor(() => expect(requireName).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /i'?m interested/i })).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- components/pg/__tests__/PgInterestButton.test.tsx`
Expected: FAIL — interest is expressed regardless of the gate.

- [ ] **Step 3: Add the guard**

Add the import:

```tsx
import { useNamePrompt } from "../name-capture/name-prompt-provider";
```

Inside the component add `const { requireName } = useNamePrompt();`, then change `onClick` (`:89`):

```tsx
  async function onClick() {
    onBefore?.();
    // The operator sees this name on the lead.
    if (!(await requireName({ token: token as string }))) return;
    setState("loading");
    try {
      const res = await expressPgInterest(listingId, token as string, sharing || undefined);
```

`onBefore?.()` stays first so any scroll/analytics side effect the parent wires up still fires.
`setState("loading")` moves _after_ the gate — otherwise the button sits spinning behind the modal.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- components/pg/__tests__/PgInterestButton.test.tsx components/pg/__tests__/PgDetailClient.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/pg/PgInterestButton.tsx apps/web/components/pg/__tests__/PgInterestButton.test.tsx
git commit -m "feat(web): require a name before expressing PG interest"
```

---

### Task 13: E2E and full verification

**Files:**

- Create: `apps/web/tests/name-capture.spec.ts`
- Possibly modify: `apps/web/tests/lead-credit-purchase.spec.ts`, `phase1-smoke.spec.ts`, `admin-lead-center.spec.ts`, `owner-workspace-mobile.spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

The four existing specs POST `/tenant/contact-unlocks` directly against the API rather than driving
the panel, so the new gate does not affect them — **verify this rather than assuming it.** Any spec
that drives the _UI_ to unlock will now hit the name modal and needs its seeded user given a name.

- [ ] **Step 1: Write the E2E spec**

Create `apps/web/tests/name-capture.spec.ts`, using the shared helpers in
`apps/web/tests/utils/auth.ts` (`loginWithOtp`, `loginAsRole`, `setSessionOnPage`). Do **not** write a
new session-injection helper.

Two things about those helpers that shape this spec:

- `ROLE_PHONE.tenant` is `+919999999902` — a _seeded_ user who may already have a name. Tests that
  need a nameless account must use a fresh phone number, and tests that need a **named** account
  should set the name explicitly via `PATCH /users/me` rather than assuming.
- `setSessionOnPage` establishes both a NextAuth cookie and the legacy `localStorage` session, so it
  is the right helper for the contact-gate test.

```ts
import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginWithOtp, setSessionOnPage } from "./utils/auth";

function apiBase() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

/** A phone nobody has used, so the account is created fresh and nameless. */
function freshPhone(suffix: number) {
  return `+9198${String(suffix).padStart(8, "0")}`;
}

async function setName(request: APIRequestContext, token: string, fullName: string) {
  const res = await request.patch(`${apiBase()}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { full_name: fullName }
  });
  expect(res.ok()).toBeTruthy();
}

test.describe("name capture at login", () => {
  test("a nameless user is asked for a name before landing", async ({ page }) => {
    const phone = freshPhone(20260726);

    await page.goto("/en/auth/login");
    await page.getByLabel(/phone/i).fill(phone);
    await page.getByRole("button", { name: /send|continue|get otp/i }).click();

    // OTP_PROVIDER=mock pre-fills the OTP box via dev_otp.
    await page.getByRole("button", { name: /verify|sign in|log in/i }).click();

    await expect(page.getByTestId("name-capture-input")).toBeVisible();
    // Crucially: still on the login route, i.e. the auto-redirect guard stood down.
    expect(new URL(page.url()).pathname).toContain("/auth/login");

    await page.getByTestId("name-capture-input").fill("Asha Devi");
    await page.getByTestId("name-capture-submit").click();

    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page.getByTestId("name-capture-modal")).toHaveCount(0);
  });

  test("skipping does not immediately re-prompt on the landing page", async ({ page }) => {
    const phone = freshPhone(20260727);

    await page.goto("/en/auth/login");
    await page.getByLabel(/phone/i).fill(phone);
    await page.getByRole("button", { name: /send|continue|get otp/i }).click();
    await page.getByRole("button", { name: /verify|sign in|log in/i }).click();

    await expect(page.getByTestId("name-capture-input")).toBeVisible();
    await page.getByTestId("name-capture-skip").click();

    await expect(page).not.toHaveURL(/\/auth\/login/);
    // Being asked twice back-to-back reads as a broken form.
    await expect(page.getByTestId("name-capture-modal")).toHaveCount(0);
  });
});

test.describe("name capture at contact", () => {
  test("a nameless user cannot unlock contact without giving a name", async ({ page, request }) => {
    const phone = freshPhone(20260728);
    const session = await loginWithOtp(request, phone);
    await setSessionOnPage(page, session);

    await page.goto(LISTING_PATH);
    await page.getByTestId("unlock-cta").click();

    const modal = page.getByTestId("name-capture-modal");
    await expect(modal).toBeVisible();
    // Unskippable: no skip control, no close control, Esc does nothing.
    await expect(page.getByTestId("name-capture-skip")).toHaveCount(0);
    await expect(page.getByTestId("name-capture-close")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(modal).toBeVisible();

    await page.getByTestId("name-capture-input").fill("Asha Devi");
    await page.getByTestId("name-capture-submit").click();
    await expect(modal).toHaveCount(0);
  });

  test("a user who already has a name is never interrupted", async ({ page, request }) => {
    const phone = freshPhone(20260729);
    const session = await loginWithOtp(request, phone);
    await setName(request, session.access_token, "Asha Devi");
    await setSessionOnPage(page, session);

    await page.goto(LISTING_PATH);
    await page.getByTestId("unlock-cta").click();

    await expect(page.getByTestId("name-capture-modal")).toHaveCount(0);
  });
});
```

Three selectors above must be pinned to the real UI before this spec will run — resolve each by
reading the code, not by guessing:

1. `LISTING_PATH` — define it from whatever seeded listing the existing
   `lead-credit-purchase.spec.ts` / `callback-leads.spec.ts` navigate to. Do not hardcode a new id.
2. `getByTestId("unlock-cta")` — the unlock CTA has no such testid today. Either reuse the selector
   those specs already use, or add `data-testid="unlock-cta"` to the button in
   `unlock-contact-panel.tsx` as part of Task 11 and keep it consistent with the unit test there.
3. The phone and OTP field/button labels in the login tests — copy them from
   `apps/web/tests/phase1-smoke.spec.ts`, which already drives this form.

- [ ] **Step 2: Run the E2E suite**

Run: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test:e2e -- name-capture`
Expected: PASS. Requires the API and web dev servers per the E2E setup in `CLAUDE.md`.

- [ ] **Step 3: Confirm the pre-existing specs still pass**

Run: `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test:e2e -- lead-credit-purchase phase1-smoke`
Expected: PASS. If either now stalls on a name modal, give its seeded user a `full_name` via
`PATCH /users/me` in that spec's setup — do **not** weaken the gate to make a test pass.

- [ ] **Step 4: Full repo verification**

Run each and confirm clean:

```bash
pnpm build
```

```bash
pnpm lint
```

```bash
pnpm typecheck
```

```bash
pnpm test
```

`pnpm build` matters specifically here: it is the only step that exercises the Next.js bundling of
`@cribliv/shared-types`, which is where a missed explicit value re-export (Task 1, Step 4) shows up.

- [ ] **Step 5: Manual verification in the browser**

Start the dev server and confirm, with a real nameless account:

1. Login → the name step appears before landing.
2. Saving a name → the header menu shows it (this is the Task 4 side effect).
3. A nameless account clicking Unlock → an unskippable modal; Esc and overlay-click do nothing.
4. `/hi` → all copy is Hindi, not raw keys like `nameCaptureSave`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/tests/
git commit -m "test(web): E2E coverage for name capture at login and contact"
```

---

## Spec coverage

| Spec requirement                                  | Task                                             |
| ------------------------------------------------- | ------------------------------------------------ |
| No migration; `NULL`/`''` both mean no name       | Global constraints; Task 2                       |
| zod validation on `PATCH /users/me`               | Tasks 1, 2                                       |
| Normalise before reject; `''` → `NULL`            | Task 1 (schema), Task 2 (persistence)            |
| CSV formula-injection fix                         | Task 3                                           |
| `full_name` → `session.user.name`                 | Task 4                                           |
| `shouldShowNamePrompt` / dismissal / suppression  | Task 5                                           |
| Role-dependent copy, en + hi                      | Task 6                                           |
| `NameCaptureForm`                                 | Task 7                                           |
| `NameCaptureModal` with `required` mode           | Task 8                                           |
| `NamePromptProvider`: ambient + `requireName()`   | Task 9                                           |
| Mounted in `[locale]/layout.tsx`                  | Task 9, Step 5                                   |
| Moment 1 — login page step                        | Task 10                                          |
| Moment 2 — inline OTP signup on a listing         | Task 11 (via `requireName`, see its design note) |
| Moment 3 — ambient modal                          | Task 9                                           |
| Moment 4 — contact gate                           | Tasks 11, 12                                     |
| Never prompt `admin`                              | Task 5 (`PROMPTABLE_ROLES`), Task 10             |
| Don't collide with `WelcomeCreditsModal`          | Task 5 (`welcomePending`), Task 8 (z-index)      |
| Gate reads the name from the API, not the session | Task 5 (`fetchFullName`), Task 9                 |
| Fix `updateProfile` `rowCount === 0` fallthrough  | Task 2                                           |
| Tests: unit, component, E2E                       | Tasks 1–13                                       |

**Deliberate deviations from the spec, both recorded above:**

1. The name rules live in `packages/shared-types`, not duplicated in each app with a shared fixture. Sharing the implementation makes drift impossible instead of merely tested-for.
2. Moment 2 uses `requireName()`'s required modal rather than a new `authStep: "name"` branch in the unlock panel. Same UX, no extra render path, and it drops the spec's four gate call sites to two.

**Out of scope, as per the spec:** validation on `POST /admin/users`; consolidating token resolution across `UnlockContactPanel` / `PgInterestButton` / `SeekerFormPanel`; deleting the dead `apps/web/app/auth/login/page.tsx`.
