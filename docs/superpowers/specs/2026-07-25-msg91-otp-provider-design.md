# MSG91 as a third OTP provider

> **SUPERSEDED 2026-07-26 — do not implement.** MSG91's domestic rate (₹0.25 + 18% GST)
> is no better than D7's own domestic rate (₹0.26), so migrating providers buys nothing.
> The real cost driver is the *route*, not the vendor: we are on D7's international route
> at ₹4.93/SMS because we have no DLT registration. See
> `2026-07-26-whatsapp-first-otp-design.md` for the replacement direction (WhatsApp
> authentication templates at ₹0.115, no DLT). The `OtpProvider` abstraction described
> below survives into that design — only the MSG91-specific parts are dead.

**Date:** 2026-07-25
**Status:** Superseded
**Scope:** Login OTP only. Transactional SMS (`notifications/sms.client.ts`) is explicitly out of scope.

## Problem

Login OTP is sent through D7 Networks (`OTP_PROVIDER=d7`), which is live in production
sending real SMS. We want MSG91 as an alternative provider, selectable by env var, with a
safe way to validate it on production before cutting over.

MSG91 was chosen for cost and because the account already exists with a funded wallet.
This spec covers only the code change. Account-side prerequisites (KYC, DLT) are listed
in "Go-live prerequisites" but are not engineering work.

## Non-goals

- Transactional SMS via MSG91's Flow API. Every notification body would need its own
  DLT-approved template registered first, which is lead time rather than code time.
  `SmsClient` stays on D7/mock.
- Removing D7. D7 remains a fully working provider so rollback is an env flip.
- MSG91's OTP Widget (client-side JS + JWT). We use the server-side OTP API only.

## Architecture

### Provider abstraction

`AuthService.sendOtp` currently branches inline on `readOtpProviderConfig()` and calls an
injected `D7OtpClient` directly. Adding a third branch there would make an already long
method harder to follow. Instead, extract the provider behind an interface:

```
apps/api/src/modules/auth/otp/
  otp-provider.interface.ts    // OtpProvider: send / verify
  mock-otp.provider.ts         // moves the randomInt(100000, 999999) path out of AuthService
  d7-otp.provider.ts           // thin wrapper over the existing D7OtpClient
  msg91-otp.provider.ts        // new
  otp-provider.resolver.ts     // chooses a provider for a send; maps a marker back for verify
```

Interface shape:

```ts
interface OtpProvider {
  readonly name: "mock" | "d7" | "msg91";
  /** Sends the code. Returns the value to persist in otp_challenges.otp_hash. */
  send(input: { phoneE164: string }): Promise<{ marker: string; expirySec: number }>;
  /** Throws OtpVerifyError('invalid_otp' | 'otp_expired') on failure. */
  verify(input: { marker: string; phoneE164: string; code: string }): Promise<void>;
}
```

`AuthService` keeps every responsibility it already owns: per-phone and per-IP rate
limiting, the `otp_challenges` row lifecycle, attempt counting, blocking, and session
minting. It delegates only code generation and code checking. This keeps the change
additive and leaves the existing D7 integration tests meaningful.

### Verify routing is per-challenge, not per-env

`otp_challenges.otp_hash` already acts as a discriminated union and continues to:

| Value              | Provider | Verify strategy                                  |
| ------------------ | -------- | ------------------------------------------------ |
| `123456` (digits)  | mock     | `timingSafeOtpEqual` against the stored value     |
| `d7:<otp_id>`      | d7       | `POST /verify/v1/otp/verify-otp` with that otp_id |
| `msg91:`           | msg91    | `GET /api/v5/otp/verify` keyed on phone + code    |

MSG91 needs no id: its verify endpoint is keyed on mobile + code, and `AuthService`
already has `challenge.phone_e164`. The bare `msg91:` prefix is the marker.

Because the challenge row records who sent it, verify always routes back to the provider
that issued that specific code. Flipping `OTP_PROVIDER` mid-flight cannot strand a user
holding an unverified code. No forced logout on cutover.

### Provider selection at send time

`OtpProviderResolver.forSend(phoneE164)`:

1. `OTP_PROVIDER=mock` → mock, unconditionally. Local dev and tests are unaffected.
2. `phoneE164` is in `MSG91_TEST_PHONES` **and** `MSG91_AUTH_KEY` is set → msg91.
3. Otherwise → whatever `OTP_PROVIDER` names.

The allowlist deliberately outranks `OTP_PROVIDER` so a single test phone can exercise
MSG91 against production while every real user stays on D7. Rollout is therefore:

1. Deploy with `MSG91_*` set and `OTP_PROVIDER=d7`. Only allowlisted phones hit MSG91.
2. Verify end-to-end on production with roughly five SMS.
3. Flip `OTP_PROVIDER=msg91`, clear `MSG91_TEST_PHONES`.
4. Rollback at any point is `OTP_PROVIDER=d7`.

If `MSG91_AUTH_KEY` is absent the allowlist is inert rather than fatal, so a
half-configured environment degrades to D7 instead of failing logins.

## MSG91 client

| Operation | Request                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------- |
| Send      | `POST https://control.msg91.com/api/v5/otp?authkey=…&template_id=…&mobile=…&otp_length=6&otp_expiry=5&realTimeResponse=1` |
| Verify    | `GET https://control.msg91.com/api/v5/otp/verify?mobile=…&otp=…`, `authkey` as a **header**                 |

Three provider quirks the client must handle:

- **Auth placement differs per endpoint.** Query param on send, header on verify. MSG91's
  docs are explicit and inconsistent about this; we follow them per endpoint.
- **Errors return HTTP 200.** A failed verify is `200 {"type":"error","message":"OTP not match"}`.
  Checking `response.ok` is insufficient — the client must parse the `type` field.
  Map `"OTP not match"` → `invalid_otp`, `"OTP expired"` → `otp_expired`, anything else →
  a generic provider error surfaced as HTTP 502.
- **Phone format.** MSG91 wants `919044904818`, so strip the leading `+` from the stored
  E.164 value.

Config values (`otp_length=6`, `otp_expiry=5` minutes) are chosen to match the current D7
behaviour so the user-visible flow is unchanged. MSG91 defaults are 4 digits and 15
minutes, so both must be passed explicitly.

Timeout stays at the existing 8s `AbortController` pattern used by `D7OtpClient`.

MSG91's `/api/v5/otp/retry` endpoint is not used. Resend goes through our own `sendOtp`,
which already enforces rate limits; adopting MSG91's retry would add a second, invisible
limit of 2 that our rate limiter could not see.

## Environment variables

| Var                     | Required when            | Notes                                                    |
| ----------------------- | ------------------------ | -------------------------------------------------------- |
| `MSG91_AUTH_KEY`        | `OTP_PROVIDER=msg91`     | Panel → AuthKey. Secret.                                  |
| `MSG91_OTP_TEMPLATE_ID` | `OTP_PROVIDER=msg91`     | OTP → Templates. Content must contain `##OTP##`.          |
| `MSG91_TEST_PHONES`     | never                    | Comma-separated E.164. Routes only these to MSG91.        |
| `MSG91_BASE_URL`        | never                    | Defaults to `https://control.msg91.com`. Test override.   |
| `MSG91_OTP_EXPIRY_SEC`  | never                    | Defaults to 300, matching D7.                             |

`readOtpProviderConfig()` gains a `msg91` branch that throws
`otp_provider_misconfigured` when the auth key or template id is missing, mirroring how
the existing D7 branch validates `D7_KEY`.

Sender ID reuses the existing `OTP_SENDER_ID`; MSG91 resolves the header from the
template rather than the request, so it is informational only.

## Fixed in passing

1. **`d7-otp.client.ts:49`** — a `console.log` prints the full provider response on every
   send in production. Becomes `Logger.debug`.
2. **`auth.service.ts:366`** — `handleInvalidDbOtp` always throws, but its signature and
   call sites read like it returns, which makes the surrounding control flow easy to
   misread. Annotate the return type as `Promise<never>` so the compiler documents it.
   No behaviour change.

**Previously claimed and retracted:** an earlier revision of this spec asserted that a
wrong OTP on the D7 path incorrectly surfaced as `otp_expired`. That was a misreading.
Because `handleInvalidDbOtp` always throws, the `otp_expired` throw at `auth.service.ts:235`
is only reachable when the provider genuinely reports expiry. Current behaviour is
correct, and `test/auth-d7.provider.test.ts` already covers it. The MSG91 provider must
match this behaviour rather than "fix" it.

## Testing

Vitest unit tests with a stubbed `fetch`, no live SMS in CI:

- MSG91 send: success returns `{type: "success", request_id}` → marker `msg91:`
- MSG91 send: HTTP 200 with `{type: "error"}` → provider error, not a false success
- MSG91 verify: `"OTP verified success"` → resolves
- MSG91 verify: `"OTP not match"` → `invalid_otp`
- MSG91 verify: `"OTP expired"` → `otp_expired`
- MSG91 verify: 401 invalid authkey → provider error
- Timeout / network failure → provider error
- Resolver: allowlisted phone beats `OTP_PROVIDER=d7`
- Resolver: allowlist inert when `MSG91_AUTH_KEY` unset
- Resolver: `OTP_PROVIDER=mock` ignores the allowlist entirely

The existing `test/auth-d7.provider.test.ts` must pass unchanged. That is the primary
regression gate — the refactor is only safe if D7 behaviour is provably identical. Note
it is quarantined from CI in `vitest.config.ts`, so it has to be run locally and
deliberately; passing CI is not sufficient evidence for this change.

## Go-live prerequisites (account-side, not code)

These block real delivery regardless of the code being correct.

1. **Complete KYC.** The account is in DEMO status, which delivers SMS but replaces the
   body with a fixed testing string — the OTP never reaches the user. e-KYC via Aadhaar
   is the fast path.
2. **DLT — full registration, from scratch.** India requires a registered entity (PE), a
   six-alphabetic-character header, and an approved content template. This applies to OTP
   as well as promotional traffic; OTP is categorised as Service Implicit, which is a
   different category, not an exemption. MSG91's DLT FAQ states PE-TM binding is mandatory
   for "all types of messages, including Transactional, Promotional, and OTP."

   We have **no DLT registration today**. D7 delivers to Indian numbers over an
   international long-distance route, which bypasses DLT scrubbing — which is why OTP
   works today with no PE, header, or template. MSG91 is a domestic provider connecting
   through Indian operators, so no such bypass exists for it.

   Budget roughly ₹5,000 + GST for entity registration, 2–3 days for entity approval, and
   24h–3 days for header sync. Template approval time is not published. Cribliv is a
   registered entity, so the documents needed (PAN, registration certificate, authorised
   signatory) are available.

   Independent of MSG91, this is worth doing: the current international route is exactly
   the traffic TRAI has been progressively restricting, so the entire login flow presently
   rests on a path that can degrade without notice.
3. **Register the template in MSG91** and record the returned `template_id`.

Template content, matching the current D7 copy:

```
Greetings from CribLiv, your mobile verification code is: ##OTP##
```

The same content on the DLT portal uses `{#var#}` rather than `##OTP##`. Divergence
between the two is the most common cause of error 211 (invalid DLT template) and silent
non-delivery.

## Risks

| Risk                                        | Mitigation                                                     |
| ------------------------------------------- | -------------------------------------------------------------- |
| Wallet runs dry, sends start failing        | Env flip back to D7. Wallet is ~200 OTPs at current rates.       |
| DLT not yet approved when code merges       | Ships flag-off behind `OTP_PROVIDER=d7`; inert until configured.  |
| D7's international route degrades (TRAI)    | The reason to complete DLT regardless of whether MSG91 ships.     |
| DLT template mismatch → silent non-delivery | Allowlist testing on production catches it before any user does. |
| Refactor changes D7 behaviour               | Existing D7 tests must pass untouched.                           |
| MSG91 error-in-200 shape parsed wrongly     | Explicit unit tests per documented error string.                 |
