# Admin OTP-free login via TOTP — Design

**Date:** 2026-07-13
**Status:** Approved (design)
**Author:** Aryan + Claude

## Problem

Admins log in through the same phone → SMS-OTP flow as every other user. In
production the OTP is sent via D7 SMS (`OTP_PROVIDER=d7`), which costs money on
**every single admin login**. There is no email infrastructure on the site, so
email magic-links and email-based password resets are not options.

We want a way for `role = 'admin'` users to log in **without incurring an SMS
cost per login**, while keeping the admin panel (god-view over leads, users,
listings) reasonably secure.

## Decision summary

- **Method:** TOTP only (authenticator app — Google Authenticator / Authy /
  Microsoft Authenticator / any RFC-6238 app). No password.
- **Cost:** ₹0 per login, forever. TOTP is an open standard with no vendor, no
  API, no per-use fee. Only cost is one-time engineering.
- **Bootstrap & recovery:** the existing SMS-OTP flow stays available to admins
  as a **rare break-glass** — used for first-time enrollment and for recovering
  a lost device. So SMS fires a handful of times a year instead of every login.
- **No separate recovery codes:** OTP break-glass already covers a lost device,
  so we intentionally skip a recovery-code system to keep it simpler.

## Non-goals

- Changing the OTP flow for tenants / owners / pg_operators (untouched).
- Passwords for admins.
- Email of any kind.
- Recovery codes.

## Architecture

"Admin" is already just a `users` row with `role = 'admin'`. We add a **second
authentication path** for those rows (a TOTP code) that mints the exact same
session as the OTP path. The OTP flow is left fully intact.

### 1. Data model — new table (migration `0056_admin_totp.sql`)

```
admin_totp
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
  secret_encrypted bytea NOT NULL      -- AES-256-GCM (see §4)
  status           text  NOT NULL      -- 'pending' | 'enabled'
  last_used_step   bigint              -- replay guard (see §5)
  failed_attempts  int   NOT NULL DEFAULT 0
  locked_until     timestamptz
  created_at       timestamptz NOT NULL DEFAULT now()
  enabled_at       timestamptz
  updated_at       timestamptz NOT NULL DEFAULT now()
```

- One row per enrolled admin. `status = 'pending'` between `enroll/start` and a
  successful `enroll/verify`; `enabled` afterward.
- Ships with a matching `0056_admin_totp.rollback.sql`.

### 2. Libraries (API only)

- `otplib` — generate secret + verify TOTP codes.
- `qrcode` — render the enrollment QR as a data-URL **server-side**, so the
  secret never leaves our server and we avoid any external QR service (CSP /
  privacy safe).

Both are free / MIT. No new web dependency (web renders the data-URL in an
`<img>`).

### 3. Secret encryption at rest

TOTP secrets are encrypted at rest, **reusing the existing AES-256-GCM pattern**
in `apps/api/src/modules/rent-agreement/crypto/pan.crypto.ts`
(layout `[iv(12) | authTag(16) | ciphertext]`). A new module
`apps/api/src/modules/auth/admin-totp/totp.crypto.ts` mirrors it with a new
base64 env key:

```
ADMIN_TOTP_ENC_KEY   # 32-byte key, base64-encoded (mirrors RENT_AGREEMENT_PAN_KEY)
```

### 4. API endpoints

New controller `auth/admin-totp/admin-totp.controller.ts` (or extend the auth
module), all following the established `@UseGuards(AuthGuard, RolesGuard)` +
`@Roles("admin")` convention where auth is required.

| Method & path                         | Guard             | Purpose                                                                                |
| ------------------------------------- | ----------------- | -------------------------------------------------------------------------------------- |
| `POST /auth/admin/totp/enroll/start`  | admin (logged in) | Generate secret, store `pending`, return `{ otpauth_uri, qr_data_url }`.               |
| `POST /auth/admin/totp/enroll/verify` | admin (logged in) | Body `{ totp_code }`. Confirm the scan; flip `pending → enabled`.                      |
| `GET  /auth/admin/totp/status`        | admin (logged in) | Return `{ enrolled: boolean }`.                                                        |
| `POST /auth/admin/login`              | **public**        | Body `{ phone_e164, totp_code }`. The OTP-free login (see §5).                         |
| `POST /auth/admin/totp/reset`         | admin (logged in) | Wipe the secret so a new device can be enrolled (used after an OTP break-glass login). |

**`POST /auth/admin/login` logic:**

1. Look up `users` by `phone_e164`.
2. Require `role = 'admin'` **and** an `admin_totp` row with `status = 'enabled'`.
3. Enforce lockout (`locked_until`) and verify the code (§5).
4. On success: reset `failed_attempts`, stamp `last_used_step`, and **issue a
   session** identical to the OTP path (4-hour admin session, `acc_`/`ref_`
   tokens).
5. On failure: increment `failed_attempts`; at 5 → set `locked_until = now +
15 min`.

**Shared session helper:** factor the session-minting block currently inline in
`AuthService.verifyOtp` into a private `issueSession(user, client)` helper so
both login paths mint identical sessions (`last_login_at` stamp, 4h vs 30d
duration, token shape). This is a small, focused refactor of existing code.

### 5. Security specifics

- **Replay guard:** persist `last_used_step` (the TOTP time-step of the last
  accepted code). Reject any code whose step ≤ `last_used_step` — a 6-digit code
  can't be reused inside its 30s window.
- **Clock skew:** accept a ±1 step window (±30s) via otplib's `window` option.
- **Brute force:**
  - Route-level `@Throttle` on `/auth/admin/login` (mirrors the OTP routes'
    strict limits).
  - Per-account lockout: 5 wrong codes → `locked_until = now + 15 min`.
- **No admin enumeration:** dedicated `/auth/admin/login` route + generic error
  responses, so we never reveal on the public login page whether a given phone
  belongs to an admin.

### 6. Web (NextAuth + UI)

- **Second Credentials provider** `admin-totp` in `apps/web/auth.config.ts`,
  fields `{ phone, totpCode }`, calling `POST /auth/admin/login`. The existing
  `OTP` provider is unchanged. Both feed the same `jwt`/`session` callbacks.
- **Dedicated admin login page** at `app/[locale]/admin/login/page.tsx`: phone +
  6-digit code → "Sign in." The normal `/auth/login` stays as the OTP
  break-glass (an admin can still use it any time; role is enforced server-side).
- **Enrollment panel** inside `AdminShell` (a "Security" section):
  - "Set up authenticator" → calls `enroll/start`, shows the QR + a confirm-code
    field → `enroll/verify`.
  - "Reset device" → `totp/reset`, then re-enroll.
  - Uses `GET /auth/admin/totp/status` to decide which state to show.

### 7. Bootstrap & recovery flow

1. **First setup:** admin logs in once via existing OTP → Admin → Security →
   "Set up authenticator" → scan QR → confirm code. Enrolled.
2. **Steady state:** every subsequent login uses `/en/admin/login` (phone +
   TOTP), ₹0.
3. **Lost device:** log in once via OTP break-glass → Security → "Reset device"
   → scan new QR.

Net effect: SMS OTP for admins goes from **per-login** to **a few times a year**.

### 8. Rollout safety

Gate the new login route + `admin-totp` provider behind a feature flag
`FF_ADMIN_TOTP` (API `apps/api/src/config/feature-flags.ts`, web
`NEXT_PUBLIC_FF_ADMIN_TOTP`), default **off**, per the repo's `FF_*` convention.
Flip on after admins are enrolled. Because OTP break-glass always works, this is
zero-risk to existing logins.

### 9. DB dual-mode

Per `DatabaseService.isEnabled()`, implement **both** code paths:

- DB mode: the `admin_totp` table above.
- In-memory mode (local/no-DB dev): a minimal `Map` in `AppStateService`
  mirroring the same shape. Local dev has no real admins, so this path is
  intentionally minimal but present for parity.

## Files touched (anticipated)

**API**

- `infra/migrations/0056_admin_totp.sql` + `.rollback.sql`
- `apps/api/src/modules/auth/admin-totp/totp.crypto.ts` (new, mirrors pan.crypto)
- `apps/api/src/modules/auth/admin-totp/admin-totp.service.ts` (new)
- `apps/api/src/modules/auth/admin-totp/admin-totp.controller.ts` (new)
- `apps/api/src/modules/auth/auth.service.ts` (extract `issueSession` helper)
- `apps/api/src/modules/auth/auth.module.ts` (wire new provider/controller)
- `apps/api/src/config/feature-flags.ts` (`FF_ADMIN_TOTP`)
- `apps/api/src/common/app-state.service.ts` (in-memory store)
- `apps/api/package.json` (`otplib`, `qrcode`)

**Web**

- `apps/web/auth.config.ts` (second Credentials provider)
- `apps/web/app/[locale]/admin/login/page.tsx` (new)
- Admin "Security" panel under `apps/web/components/admin/…`
- `apps/web/lib/feature-flags.ts` usage where the new route/link is gated

## Testing

- **API unit:** TOTP verify (valid / expired / skew / replay), lockout after 5,
  crypto round-trip, `issueSession` parity.
- **API integration:** enroll/start → verify → login happy path; login rejected
  for non-admin phone; login rejected when not enrolled; lockout path.
- **Web E2E (Playwright):** admin enrolls (mock secret) then logs in via the
  TOTP page; OTP break-glass still works.

## Open questions / assumptions

- Assumes admins are a small, trusted internal set (confirmed).
- `ADMIN_TOTP_ENC_KEY` must be provisioned in the Azure container-app secrets
  before enabling in prod (ops step, like `RENT_AGREEMENT_PAN_KEY`).
