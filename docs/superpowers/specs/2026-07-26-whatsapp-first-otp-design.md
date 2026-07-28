# WhatsApp-first OTP with D7 SMS fallback

**Date:** 2026-07-26
**Status:** Approved, pending implementation plan
**Supersedes:** `2026-07-25-msg91-otp-provider-design.md`

## Problem

Login OTP goes out over D7's international route at **₹4.93/SMS** — roughly 19× the
domestic rate. The cheap domestic lane requires TRAI DLT registration (~₹5,000, 2–6
weeks), which we are choosing not to do right now.

WhatsApp authentication templates cost **₹0.115** via Meta's Cloud API, need no DLT, and
Meta bills only on delivery — so failed WhatsApp attempts are free. Making WhatsApp the
primary channel and keeping D7 SMS as a rarely-used fallback cuts cost per login by
roughly 73% with no registration paperwork.

Secondary prize: a WABA also activates `NotificationService`, which is already written,
WhatsApp-first, and dormant for want of credentials.

## Cost model

| Channel | Per message |
| --- | --- |
| WhatsApp authentication (India domestic, Meta Cloud API direct) | ₹0.115 |
| D7 SMS (international route, current) | ₹4.93 |

At an assumed 75/25 WhatsApp/SMS split, blended cost is **~₹1.32 per successful login**,
down from ₹4.93. The SMS leg is ~93% of the remaining spend, so it is the obvious next
target — either an Indian no-DLT OTP vendor (₹0.15–0.30) or DLT itself (₹0.26). Both are
explicitly out of scope here; the design keeps the SMS leg swappable so either can land
later without touching the WhatsApp path.

## Non-goals

- **MSG91.** Its domestic rate (₹0.25 + GST) is no better than D7's own domestic rate, so
  the migration buys nothing. The prior spec and plan are superseded.
- **DLT registration.** Deliberately deferred.
- **Replacing the SMS fallback vendor.** D7 stays as-is.
- **Transactional notification SMS.** `notifications/sms.client.ts` is untouched.
- **WhatsApp for notifications.** The WABA unlocks it, but wiring `NotificationService`
  to live credentials is separate work.

## Architecture

### Provider abstraction

Same shape as the superseded MSG91 spec — that part of the design survives intact, since
the need for a provider abstraction was never MSG91-specific.

```
apps/api/src/modules/auth/otp/
  otp-provider.interface.ts    // OtpProvider: send / verify
  mock-otp.provider.ts         // local + E2E; unchanged behaviour
  whatsapp-otp.provider.ts     // new; primary channel
  d7-otp.provider.ts           // wraps the existing D7OtpClient
  otp-provider.resolver.ts     // channel selection + marker routing
```

`AuthService` keeps rate limiting, the `otp_challenges` lifecycle, attempt counting and
session minting. Providers own only code delivery and code checking.

### WhatsApp is a self-managed provider

D7 generates and verifies the code itself (we persist `d7:<otp_id>` and call back to
verify). Meta does neither — the Cloud API only delivers a message. So
`WhatsAppOtpProvider` generates the code, we store it, and we verify locally. It is
structurally the *mock* provider with a real delivery call, not a D7-shaped one.

**The stored value is a SHA-256 hash, not the code.** Marker format `wa:<sha256hex>`.
This differs from the mock provider, which stores the raw digits — acceptable for a dev
path, not for the primary production channel. Verification hashes the submitted code and
compares digests with `timingSafeEqual`.

### Marker routing

`otp_challenges.otp_hash` continues to discriminate, so a verify always routes to
whichever channel issued that code:

| Value | Channel | Verify |
| --- | --- | --- |
| `123456` (bare digits) | mock | timing-safe compare against stored value |
| `wa:<sha256hex>` | whatsapp | hash submitted code, timing-safe compare |
| `d7:<otp_id>` | d7 | call D7's verify endpoint |

### Channel selection and the fallback gate

`POST /auth/otp/send` gains an optional `channel` field:

```ts
{ phone_e164: string; purpose: string; channel?: "whatsapp" | "sms" }
```

- Omitted → WhatsApp (the default; the client never asks the user to choose).
- `"sms"` → D7, but **only if the fallback gate is open**. A request for `"sms"` with the
  gate closed is served over WhatsApp instead, silently. The gate is server-side so the
  client cannot cheapen or bypass it.

**The gate opens when at least 2 WhatsApp attempts already exist for this phone in the
last 10 minutes.** This is the product requirement: users must exhaust WhatsApp retries
before SMS is offered, so WhatsApp share stays high.

**Separately, a hard undeliverable error auto-falls-back within the same request.** When
Meta reports that the number has no WhatsApp account (e.g. error 131026), `AuthService`
sends via D7 immediately and returns `channel: "sms"`. Forcing two more doomed attempts
would add ~40s of dead waiting before an SMS that was always inevitable.

Handling it in-request rather than as a second gate condition avoids persisting any
"this number is undeliverable" state: the failure is known synchronously, so it is acted
on synchronously. The 2-attempt gate then governs only the genuinely *ambiguous* case —
Meta accepted the message but the user says nothing arrived.

**Counting needs no migration.** WhatsApp attempts are already recorded: count rows in
`otp_challenges` for this phone with `otp_hash LIKE 'wa:%'` created in the last 10
minutes. Next free migration number stays `0069` for whoever needs it.

`OTP_PROVIDER=mock` overrides everything, unconditionally. Local dev and Playwright must
never reach a real provider.

### Response contract

`sendOtp` returns two new fields, both additive:

```ts
{
  challenge_id: string;
  expires_in_sec: number;
  retry_after_sec: number;
  channel: "whatsapp" | "sms" | "mock";   // what was actually used
  sms_fallback_available: boolean;         // whether to show the SMS button
  dev_otp?: string;                        // mock only, unchanged
}
```

`channel` lets the UI say "sent to your WhatsApp" versus "sent by SMS".
`sms_fallback_available` is the server telling the client whether to render the escape
hatch — the client never computes this itself.

## Web changes

Three call sites send OTPs and all need the same treatment:

- `apps/web/app/[locale]/auth/login/page.tsx`
- `apps/web/app/auth/login/page.tsx`
- `apps/web/components/unlock-contact-panel.tsx`

Behaviour:

1. No channel picker. Send, then show "Sent to your WhatsApp".
2. A "Resend on WhatsApp" control after `retry_after_sec`.
3. "Didn't get it? Send by SMS instead" renders **only** when
   `sms_fallback_available` is true — i.e. after the second WhatsApp attempt, or
   immediately if Meta reported the number undeliverable.

The shared logic should live in one hook rather than being written three times.

## Update 2026-07-28 — the WABA already exists, via D7

The prerequisites below were largely satisfied before this spec was written. A
CribLiv WABA is live and delivering authentication-template OTPs
(*"234569 is your verification code. This code has expired."*), created through
**D7's Meta embedded-signup**. Business verification and template approval are
therefore already done, which removes the 2–4 week blocker this spec assumed.

Two consequences:

1. **D7 is the BSP and holds the Meta credentials.** It proxies sends through
   `POST https://api.d7networks.com/whatsapp/v2/send` with a D7 bearer token; we
   never see a `phone_number_id` or Meta token. The Meta Cloud API path in
   `WhatsAppClient` is consequently unusable as-is, so `WHATSAPP_PROVIDER` gains
   a third value, `d7`. Meta-direct is retained because it remains the cheaper
   long-run route if we ever hold our own credentials.
2. **D7's authentication-template payload carries the code only in the button's
   `action_payload`** — there is no separate body parameter as there is with
   Meta, which fills the visible body from the same code server-side.

Unresolved: D7's per-message WhatsApp rate. D7 publishes no WhatsApp price list
and bills per Meta's conversation categories; Meta's India authentication rate
is ₹0.115, but D7's markup over it is unknown and must be confirmed in writing
before treating the blended-cost figures above as accurate.

## WhatsApp account setup (mostly complete — see update above)

1. **Meta Business Portfolio registered under the Indian entity.** Critical: Meta's
   "authentication-international" rate (₹2.58) applies when the business is based in a
   different country from the recipient. Registering under a non-Indian entity would make
   every OTP 22× more expensive.
2. **Business verification.** CoI or GST certificate, website, phone. 2–5 business days
   typical. Until it clears, sends are capped at 250 business-initiated conversations per
   24h.
3. **Cloud API direct, no BSP.** Meta charges no platform fee. BSPs add markup — Twilio
   adds ₹0.425/message, 3.7× Meta's entire rate.
4. **A dedicated phone number** not currently active in the WhatsApp consumer app.
5. **Authentication templates approved in `en` and `hi`.** Content is Meta-preset
   (*"<CODE> is your verification code"*) and cannot be customised, so the current
   "Greetings from CribLiv…" wording does not carry over. Users have a
   `preferred_language`, so both locales need approving.
6. **INR billing before 2026-12-31** — Indian WABAs that have not migrated stop
   delivering from 2027-01-01.

Auth templates carry a copy-code button. One-tap and zero-tap autofill are Android *app*
features and do not apply to a web client.

## Environment variables

The existing `WhatsAppClient` already reads these; none are new:

| Var | Notes |
| --- | --- |
| `WHATSAPP_PROVIDER` | `mock` \| `meta`. Stays `mock` until the WABA is live. |
| `WHATSAPP_PHONE_NUMBER_ID` | From Meta. |
| `WHATSAPP_API_TOKEN` | Secret. |
| `WHATSAPP_API_URL` | Defaults to the v21.0 Graph endpoint. |

New:

| Var | Notes |
| --- | --- |
| `WHATSAPP_OTP_TEMPLATE_NAME` | Approved authentication template name. |
| `OTP_CHANNEL_PRIMARY` | `whatsapp` \| `sms`. Defaults to `sms` so the change ships inert; flip to `whatsapp` to go live. |

## Client change required

`WhatsAppClient.buildMetaPayload` emits header and body components only. Authentication
templates additionally require a button component carrying the same code:

```json
{ "type": "button", "sub_type": "url", "index": "0",
  "parameters": [{ "type": "text", "text": "123456" }] }
```

This is additive — an optional `buttonParams` field on `WhatsAppTemplateMessage`, leaving
every existing notification caller untouched.

## Testing

- WhatsApp provider: send success stores `wa:<sha256>`, never the raw code
- WhatsApp provider: verify accepts the right code, rejects a wrong one as `invalid_otp`
- WhatsApp provider: payload includes the button component with the code
- Resolver: default is WhatsApp when `OTP_CHANNEL_PRIMARY=whatsapp`
- Resolver: `channel: "sms"` is ignored while the gate is closed
- Resolver: gate opens after 2 WhatsApp attempts within 10 minutes
- Resolver: `OTP_PROVIDER=mock` overrides everything
- AuthService: a Meta hard-undeliverable error auto-sends via D7 in the same request and
  reports `channel: "sms"`
- AuthService: a *soft* WhatsApp failure (timeout, 5xx) surfaces as `otp_provider_error`
  and does NOT silently burn an SMS
- Regression: `test/auth-d7.provider.test.ts` passes **unmodified**

That D7 test is quarantined from CI in `vitest.config.ts`, so it must be run locally and
deliberately. Passing CI is not sufficient evidence.

## Rollout

1. Merge with `OTP_CHANNEL_PRIMARY` unset — every send still goes to D7. Inert.
2. Once the WABA is verified and templates approved, set the WhatsApp vars and
   `WHATSAPP_PROVIDER=meta`, still with `OTP_CHANNEL_PRIMARY=sms`. Nothing changes yet.
3. Flip `OTP_CHANNEL_PRIMARY=whatsapp`. Watch the WhatsApp-vs-SMS split and the Meta
   delivery-failure rate.
4. Rollback is `OTP_CHANNEL_PRIMARY=sms`. In-flight `wa:` challenges still verify, because
   verify routes by marker.

## Risks

| Risk | Mitigation |
| --- | --- |
| WhatsApp coverage is ~75%, so a quarter of logins cost ₹4.93 | The gate keeps SMS genuinely last-resort; failed WhatsApp sends are free |
| A user's WhatsApp is on a different number than they typed | Rule 2 gate — Meta reports undeliverable, SMS offered immediately |
| Two forced retries frustrate non-WhatsApp users | Rule 2 short-circuits exactly this case; only ambiguous failures wait |
| Meta 250 conv/24h cap before verification | Do not flip `OTP_CHANNEL_PRIMARY` until verification clears |
| Template rejected or wrong language | Both `en` and `hi` approved before flipping |
| Meta accepts then fails delivery silently | Accepted for v1; webhook-driven auto-fallback is the known upgrade path |
