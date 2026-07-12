# Tenant Signup Credits — Design + Plan

- **Date:** 2026-07-12
- **Status:** Approved — implementing
- **Context:** Free-launch gate for the v1→v2 cutover (see the cutover runbook §4 / §1-G2). With no paywall payment path live yet (Razorpay off), tenants must get enough free credits at signup to not hit a dead end.

## Goal

New accounts get **10** free credits at signup (up from 2), env-configurable and reversible.

## Scope (this slice only)

- **Backend:** signup grant `2 → 10`, overridable via `SIGNUP_FREE_CREDITS` (default 10).
- **Frontend copy:** the four tenant-facing i18n strings that hardcode "2 free credits" → "10" (en + hi).

**Deferred to a separate post-cutover spec** (do NOT do here): separating tenant callback-credits from owner lead-credits into distinct pools/types; the "₹ value" framing; role-specific grants. The owner copy (`welcomeOwnerBody` = "first 2 tenant leads are free") already reads 2 and stays.

Note: every OTP signup creates a `tenant` (role upgrades happen later at `auth.service.ts:589`), so this grant fires for all new accounts — which is exactly the intent (new users are seekers who need callback credits).

## Changes

### 1. Pure helper (DB-free, unit-tested)

`apps/api/src/modules/auth/signup-credits.ts`:

```ts
/**
 * Free credits granted to a new user's wallet at signup. Overridable via
 * SIGNUP_FREE_CREDITS so the launch grant can be dialed back once paid plans
 * go live, without a redeploy. Defaults to 10; ignores non-integer / negative.
 */
export function signupFreeCredits(): number {
  const raw = process.env.SIGNUP_FREE_CREDITS;
  if (raw === undefined || raw.trim() === "") return 10;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 10;
}
```

Test `apps/api/src/modules/auth/__tests__/signup-credits.test.ts`: default 10; env override honored; junk/negative/empty fall back to 10.

### 2. Wire into signup

`apps/api/src/modules/auth/auth.service.ts` (signup block ~241-262): compute `const credits = signupFreeCredits()` once, and parameterize the SQL so it drives all three literals — wallet `balance_credits`, `free_credits_granted`, and the `grant_signup` `wallet_transactions.credits_delta`.

### 3. Copy sync

`apps/web/lib/i18n.ts`, "2" → "10" in both en + hi for: `cbGuestHint` (373), `gateHeadline` (433), `welcomeTenantBody` (446), `loginBenefit1` (456). Leave `welcomeOwnerBody` (owner lead credits, deferred).

## Verify

- `pnpm --filter @cribliv/api exec vitest run src/modules/auth/__tests__/signup-credits.test.ts` — green.
- `pnpm --filter @cribliv/web test` — full suite green (existing tests mock `free_credits_granted: 2` as fixtures, independent of the real grant).
- Reversibility: setting `SIGNUP_FREE_CREDITS=<n>` in the API env changes the grant with no code change.
