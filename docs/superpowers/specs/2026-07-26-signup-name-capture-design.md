# Signup name capture

**Date:** 2026-07-26
**Status:** Approved, ready for planning

## Problem

Every Cribliv account is created by phone number alone. The OTP verify path inserts a user with
no name (`auth.service.ts:271` — the `INSERT INTO users(...)` column list omits `full_name`), and
`users.full_name` is nullable (`infra/migrations/0001_init.sql:158`). Nothing in the product ever
asks for a name afterwards except a settings page nobody visits.

This costs us in three visible places:

1. **Owners see `"Tenant"` on every inbound lead.** `leads.service.ts:196`, `:285`, `:336`, `:608`,
   and the CSV export at `:825` all read `COALESCE(u.full_name, 'Tenant')`. An owner deciding
   whether to return a call sees an anonymous phone number.
2. **Nameless owners render as `"the owner"` on public listing pages.**
   `apps/web/app/[locale]/listing/[listingId]/page.tsx:441` falls back to the literal string
   `"the owner"` / `"ओनर"` when `owner.first_name` is null.
3. **Outbound SMS/WhatsApp says the same thing.** `contacts.service.ts:200` reads
   `COALESCE(NULLIF(full_name, ''), 'एक किरायेदार')` into the notification templates.

## Goal

Collect a name from every user who does not have one, at the moment they are most willing to give
it, and make that name visible everywhere the product already expects one.

## Non-goals

- Collecting anything beyond a name (email, DOB, photo).
- Backfilling names for existing users by any means other than asking them.
- Changing how admin accounts are created (`POST /admin/users`).
- Verifying that a name is real.

## Decisions

| Question                          | Decision                                                               |
| --------------------------------- | ---------------------------------------------------------------------- |
| Who gets prompted                 | `tenant`, `owner`, `pg_operator`. Not `admin`.                         |
| When, for existing nameless users | On login, **and** unskippably before contacting an owner.              |
| Re-prompt cadence                 | Every login until answered.                                            |
| Approach                          | Capture inline during the auth flow; ambient modal for existing users. |
| Shipping                          | One slice.                                                             |
| Feature flag                      | None. Ships on.                                                        |

## Architecture

### Data model

No migration. `users.full_name text` already exists and is nullable. `NULL` and `''` both mean
"no name" — the API normalises `''` to `NULL` on write, and every read path treats them alike.

### API changes — `apps/api`

**1. Validate `PATCH /users/me`.**

The route (`auth.controller.ts:59-67`) declares an inline TypeScript body type, which erases at
runtime. The global `ValidationPipe` skips bodies whose metatype is `Object`, so today _no_
constraint runs — any length, any characters, any control bytes land in `users.full_name`.

Add a zod schema and `safeParse` in the controller, matching the idiom already used by
`pg-listing.controller.ts:57-63`:

```ts
const UpdateProfileSchema = z.object({
  full_name: z.string().optional(),
  preferred_language: z.enum(["en", "hi"]).optional(),
  whatsapp_opt_in: z.boolean().optional()
});
```

`full_name` normalisation and rules, applied in that order:

1. Strip Unicode control characters (`\p{Cc}`, `\p{Cf}`).
2. Collapse internal whitespace runs to a single space; trim.
3. Reject `<` and `>` outright — the value reaches HTML and message-template contexts.
4. Require at least one letter (`\p{L}`), so `"..."` and `"123"` are rejected.
5. Length 2–80 after normalisation.
6. Normalised `''` is stored as `NULL`, not `''`.

Rule 6 needs a change to the `UPDATE`: the current statement
(`auth.service.ts:507`) uses `full_name = COALESCE($2, full_name)`, which cannot clear the column
but _can_ write an empty string.

**Where each step lives.** Normalisation (steps 1–2, 6) is a `.transform()` on the zod schema;
rejection (steps 3–5) is a `.refine()` on the transformed value. The controller passes the _parsed_
body to `updateProfile`, so both service branches — Postgres and `AppStateService` — receive an
already-normalised `string | null` and cannot drift. The service performs no string handling of its
own. Normalisation before rejection matters: `"  A  "` must fail the 2-char minimum, not pass it.

On failure, throw `BadRequestException({ code: "invalid_payload", message })` — the shape the rest
of the codebase uses.

**2. Fix CSV formula injection in the leads export.**

`leads.service.ts:839-846` escapes a cell only when it contains `,`, `"`, or `\n`. A cell beginning
with `=`, `+`, `-`, or `@` is written raw and is interpreted as a formula by Excel and Sheets.

This is inert today because no user has a name. It stops being inert the moment this feature
ships: `tenant_name` in that export is attacker-controlled the instant we start collecting names.
Prefix a `'` on any cell whose first character is `=`, `+`, `-`, `@`, tab, or CR.

`POST /admin/users` (`admin.controller.ts:870`) has the same missing validation. It is admin-only
and out of scope here; noted as a follow-up.

### Session changes — `apps/web`

`session.user.name` is read in five places today and is **always `undefined`**:

| File                                                   | Line |
| ------------------------------------------------------ | ---- |
| `apps/web/components/header-menu.tsx`                  | 358  |
| `apps/web/components/owner/workspace-shell.tsx`        | 60   |
| `apps/web/components/owner/owner-overview-client.tsx`  | 133  |
| `apps/web/app/[locale]/owner/listings/new/page.tsx`    | 87   |
| `apps/web/app/[locale]/pg-operator/dashboard/page.tsx` | 69   |

The cause: `authorize()` never returns a `name`, and the session callback's `/auth/me` sync
(`auth.config.ts:231-247`) copies only `role`, `walletBalance`, and `promotionalCredits` — even
though `GET /auth/me` already returns `full_name` (`auth.service.ts:481`).

Two changes:

- Add `full_name: string | null` to the `MeResponse` interface (`auth.config.ts:29-38`).
- Set `session.user.name = payload.data.full_name ?? undefined` inside the existing sync block.

No extra network call — that fetch already runs on every session read. This makes the session the
single source of truth for "does this user have a name", and fixes the five consumers above as a
side effect.

Because `SessionProvider` sets `refetchInterval={30}` (`components/auth/session-provider.tsx:16`),
a name saved anywhere propagates within 30s; call sites additionally invoke NextAuth's `update()`
for immediate propagation.

### Web components

Three new pieces under `apps/web/components/name-capture/`:

**`NameCaptureForm`** — presentational. A single text input, client-side validation mirroring the
API rules exactly (shared helper, see below), submit to `PATCH /users/me` with
`Authorization: Bearer ${session.accessToken}`, then `update()`. Props: `locale`, `role`,
`onSaved`, `onSkip?`. Renders no chrome of its own so it can sit inside a modal or a page step.

**`NameCaptureModal`** — house modal shell around the form, using the existing global CSS trio
`.modal-overlay` / `.modal` / `.modal__header|__body|__footer` (`app/globals.css:5454+`), following
`credit-purchase-dialog.tsx:364-391` for structure, `role="dialog"`, `aria-modal`, `data-testid`,
and overlay-click-to-close via `e.target === e.currentTarget`.

Prop `required: boolean`. When true: no skip button, no overlay-click close, no Esc. Focus trap,
body-scroll lock, and focus restore follow `welcome-credits-modal.tsx:151-193`.

**`NamePromptProvider`** — a client context mounted globally. Responsibilities:

- _Ambient trigger._ When the session is authenticated, the role is not `admin`, `session.user.name`
  is empty, the path is not suppressed, and the session dismissal flag is unset — open the modal in
  skippable mode.
- _Imperative gate._ Exposes `requireName(): Promise<boolean>`. Opens the modal in `required` mode
  and resolves `true` once a name is saved, `false` if the user backs out. This is what keeps the
  gate from being copy-pasted into four call sites.

**Shared validation helper** — `apps/web/lib/name-capture.ts`, a pure module holding the
normalisation and validation rules plus `shouldShowNamePrompt()` and the dismissal read/write. Pure
and storage-injected, mirroring `apps/web/lib/welcome-credits.ts` so it is unit-testable without
jsdom. The API's zod refinement and this helper must encode the same rules; a shared test fixture
of valid/invalid names keeps them honest.

### Where capture happens

There are **two** places a user can be created, not one. The login page is the obvious one; the
other is the inline OTP flow inside the unlock panel, where a guest on a listing page can sign up
and unlock in a single sequence (`unlock-contact-panel.tsx:192-234`). A design that only touched
the login page would miss every user created that way.

| #   | Moment                                               | Implementation                                                                                                        | Skippable |
| --- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | **Any** nameless user finishes OTP on the login page | New step after `verify`, before the redirect at `app/[locale]/auth/login/page.tsx:202`                                | Yes       |
| 2   | Nameless user finishes inline OTP on a listing       | New `"name"` value in the `authStep` union at `unlock-contact-panel.tsx:110`, rendered before `unlockContact()` fires | **No**    |
| 3   | Existing nameless user, already-live session         | Ambient modal from `NamePromptProvider`                                                                               | Yes       |
| 4   | Nameless user initiates contact                      | `await requireName()` pre-flight                                                                                      | **No**    |

Moment 1 keys off `!session.user.name`, **not** off `is_new_user`. New users are always nameless so
they are covered, but so is an existing nameless user logging in — and they get the calm in-flow
step instead of a modal. This has two consequences worth stating plainly:

- **The ambient modal (moment 3) becomes a fallback**, not the primary path. It only fires for users
  whose session was already live when this shipped, or who skipped earlier in the same tab.
- **"Every login until answered" is satisfied structurally.** The login step fires on every login
  regardless of any dismissal flag, so the cadence does not depend on storage being intact.

Moment 2 is unskippable because the user is already mid-contact; it _is_ the moment-4 gate for that
path, and it is the highest-intent moment in the product.

Because new users arrive already named, the ambient modal does not fire for them, which is what
keeps it from colliding with `WelcomeCreditsModal` (see Risks).

### Contact gate call sites

`requireName()` must be awaited before the request fires. There is no shared contact hook today —
two components, four trigger paths:

- `unlock-contact-panel.tsx` → `onUnlockClick()` (`:324`)
- `unlock-contact-panel.tsx` → `verifyOtpAndUnlock()` (`:226`) — covered by moment 2
- `unlock-contact-panel.tsx` → `handleCreditsCaptured()` (`:414`)
- `pg/PgInterestButton.tsx` → `onClick()` (`:89`)

`verifyOtpAndUnlock` bypasses `onUnlockClick` entirely, so a gate placed only on the button handler
would leak. Follow the existing _login_ gate pattern in that file (`:327-332`) — a pre-flight check
that returns before the API call — not the credits gate, which is reactive on a 402.

### Mount point

`apps/web/app/[locale]/layout.tsx:64-70`, as a sibling of `WelcomeCreditsModal`:

```tsx
<ToastProvider>
  <LocaleChrome …>{children}</LocaleChrome>
  <NamePromptProvider locale={…} />   {/* new */}
  <WelcomeCreditsModal locale={…} />
  <WhatsappFab />
</ToastProvider>
```

### Dismissal semantics

"Every login until answered" is implemented as: `sessionStorage`, key
`cribliv:name-prompt-dismissed:<userId>`, set on skip and never cleared.

It needs no clearing because **moment 1 ignores the flag entirely**. The login-page step fires
whenever the account has no name, so every login re-asks by construction; the flag exists only to
stop the _ambient_ modal from re-opening on the landing page immediately after the user just skipped
at login, which would read as a broken form.

That also means the cadence does not depend on storage surviving. If `sessionStorage` is cleared or
blocked, the worst case is the ambient modal appearing once more in a new tab — never a missed
prompt.

This deliberately avoids keying on `tokenIssuedAt`: that value is rewritten by the token-rotation
machinery (`auth.config.ts:155-200`), which would make the prompt reappear mid-session.

Within a session the dismissal survives the 30s session refetch and all in-app navigation. The
contact gate ignores the flag entirely — it is unskippable regardless.

### Path suppression

`welcome-credits-modal.tsx:29-38` documents a race we inherit: `signIn()` flips the client session
to `authenticated` a tick before the login page's `window.location.href` redirect fires, so a
globally-mounted modal briefly opens on the login page and is torn down mid-redirect. Reuse the
same suppression list — `[/\/auth(\/|$)/]` — plus `/admin`, since admins are excluded anyway.

### Copy

All strings go through `t(locale, key)` in `apps/web/lib/i18n.ts`, `en` and `hi`. The value
proposition differs by role, so the body copy is role-dependent:

| Role                   | Framing                                      |
| ---------------------- | -------------------------------------------- |
| `tenant`               | Owners will see who is calling.              |
| `owner`, `pg_operator` | Seekers will see your name on your listings. |

The unskippable variants (moments 2 and 4) say why the name is needed _now_ — the owner is about to
be contacted — rather than presenting it as a settings chore.

## Testing

**API unit** — the normalisation/validation helper against a shared fixture of valid and invalid
names, including Devanagari, single-token names, 1-char, 81-char, control characters, `<script>`,
digit-only, and whitespace-only. CSV escaping for cells starting with `=`, `+`, `-`, `@`.

**API integration** — `PATCH /users/me` rejects invalid names with `invalid_payload`; a valid name
round-trips through `GET /auth/me`; empty string stores as `NULL`. Note that CI never sets
`TEST_DATABASE_URL`, so DB-backed tests are skipped there and must be run locally against a
targeted file.

**Web unit** — `shouldShowNamePrompt()` truth table (role, name present/absent, dismissal flag,
suppressed path); the shared validator against the _same_ fixture as the API; `NameCaptureForm`
submit success, validation failure, and API error.

**Web component** — none of the four contact trigger paths can fire while nameless; the required
modal cannot be dismissed by Esc or overlay click; the skippable one can.

**E2E** — a new user signing up on the login page is asked for a name before landing; a nameless
existing user is blocked at contact and proceeds once the name is saved.

**Existing tests to update:** `components/__tests__/unlock-contact-purchase.test.tsx`,
`components/__tests__/unlock-panel-availability.test.tsx`,
`components/pg/__tests__/PgInterestButton.test.tsx`,
`components/pg/__tests__/PgDetailClient.test.tsx`, and the E2E specs that POST
`/tenant/contact-unlocks` directly (`tests/lead-credit-purchase.spec.ts`, `phase1-smoke.spec.ts`,
`admin-lead-center.spec.ts`, `owner-workspace-mobile.spec.ts`).

## Risks

**Two overlays fighting.** `WelcomeCreditsModal` triggers on `session.isNewUser` and locks
body-scroll and focus. If a new user skips moment 1, they land nameless and the ambient modal would
open on top of it. Mitigation: `NamePromptProvider` does not open while a welcome modal is pending
or showing, gating on the same `shouldShowWelcome()` helper. The ambient prompt then appears on the
next navigation or the next login.

**A stale legacy login page — confirmed unreachable.** `apps/web/app/auth/login/page.tsx` is a
non-locale duplicate with its own inlined redirect helpers, and `auth.config.ts:271` points
`pages.signIn` at it. It never renders: `middleware.ts:215` intercepts `/auth/login` and redirects
to `/{locale}/auth/login`, and `/auth/login` is in the middleware matcher (`:292`). Every
`href="/auth/login"` in the codebase therefore lands on the locale page. **Moment 1 is implemented
only on `app/[locale]/auth/login/page.tsx`.** The legacy file is dead code; deleting it is a
follow-up, not part of this slice.

**The login page redirects itself away.** An effect at `app/[locale]/auth/login/page.tsx:219-223`
calls `window.location.replace(...)` as soon as `status === "authenticated"`. Since `signIn()` flips
the session to authenticated _before_ moment 1 renders, that effect would tear the name step down
mid-typing. The guard must be suppressed while the name step is showing — it is not enough to add
the step and rely on ordering.

**The unlock panel does not use NextAuth.** `verifyOtpAndUnlock` (`unlock-contact-panel.tsx:192-234`)
calls `POST /auth/otp/verify` through `fetchApi` and persists the result with `writeAuthSession()` to
localStorage; the panel prefers that token over the NextAuth one (`:117-121`). Users authenticated
this way have **no NextAuth session at all**, so `session.user.name` is `undefined` for reasons that
have nothing to do with whether they have a name.

Consequence: `requireName()` must resolve the current name from `GET /auth/me` using whichever token
the caller holds, not from the session. The ambient modal (moment 3) may keep using
`session.user.name`, because it only ever runs for NextAuth-authenticated users. Reading the name
from the session inside the contact gate would prompt every localStorage-session user on every
click, including those who already have a name.

**Name becomes attacker-controlled output.** Beyond the CSV, `full_name` flows into WhatsApp
template parameters and SMS bodies (`notification.templates.ts:57`, `:62`), admin dashboards, and
the public listing page's `owner.first_name`. The input rules above (no angle brackets, no control
characters, 80-char cap) are the mitigation; React escapes the HTML surfaces.

**In-memory / DB drift.** `UserRecord.full_name` is `string | undefined` in `AppStateService`
(`app-state.service.ts:10`) but `string | null` in Postgres. Normalising in the service rather than
per-branch keeps the two from diverging further.

**Pre-existing bug in `updateProfile`.** If the DB is enabled but `rowCount` is 0, the DB branch
falls through into the in-memory branch and returns `{}` instead of a 404
(`auth.service.ts:522-525`). Worth fixing while in this file; call it out in the plan rather than
letting it silently ride along.

## Out of scope / follow-ups

- Validation on `POST /admin/users` (`admin.controller.ts:870`), which has the same gap.
- Consolidating the duplicated token-resolution logic across `UnlockContactPanel`,
  `PgInterestButton`, and `SeekerFormPanel`.
- Deleting the dead `apps/web/app/auth/login/page.tsx` duplicate and repointing
  `auth.config.ts:271` `pages.signIn` at a locale-aware path.
