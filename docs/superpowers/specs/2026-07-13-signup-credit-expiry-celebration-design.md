# Signup Credit Expiry + Celebration — Design Spec

- **Date:** 2026-07-13
- **Status:** Approved visual and reward direction; ready for implementation planning
- **Branch:** `codex/signup-credit-celebration`
- **Base:** latest `origin/master` at `39b82ef`
- **Primary modules:** `apps/api/src/modules/auth`, `apps/api/src/modules/wallet`, `apps/api/src/worker`, `apps/web/components/welcome-credits-modal.tsx`

## 1. Summary

New Cribliv accounts receive **10 promotional credits**. Unused signup credits expire exactly
**90 days after signup**. Purchased credits and refunded credits do not expire.

The existing one-time signup modal becomes a production-homepage-matched reward reveal:

- a blue circular credit token that counts from `0` to `10`;
- the token contains only the number;
- the label **“Free credits added”** sits beneath it in sentence case;
- restrained blue, green, coral, and amber particles burst around the card edges;
- the exact expiry date is visible;
- the coral primary action reads **“Start finding homes”**.

This replaces the current mismatch where the body promises 10 credits while the animation,
in-memory signup path, wallet fallback response, and end-to-end test still hardcode 2.

## 2. Goals

1. Grant every newly created OTP account 10 usable credits in both database and no-database modes.
2. Expire only the unused portion of the signup grant after 90 days.
3. Spend promotional credits before permanent credits.
4. Keep purchased and refunded credits permanent.
5. Make the reward amount and expiry date come from backend data rather than frontend literals.
6. Deliver a memorable but fast, accessible, production-homepage-matched signup celebration.
7. Preserve one-time display behavior and existing auth redirect reliability.

## 3. Non-goals

- Separate callback credits from owner lead credits.
- Add a global campaign end date. The grant remains controllable through
  `SIGNUP_FREE_CREDITS`; each individual grant has a 90-day lifetime.
- Retroactively expire credits already granted before this migration.
- Change credit-pack pricing, Razorpay behavior, or refund eligibility.
- Add email, SMS, or WhatsApp expiry reminders in this slice.
- Redesign the OTP form or production homepage.

## 4. Confirmed product rules

### 4.1 Grant

- A user created by the first successful OTP verification receives the configured signup amount.
- The default amount remains **10**.
- `SIGNUP_FREE_CREDITS=0` disables the grant.
- The expiry timestamp is the user creation/signup timestamp plus exactly 90 days.
- A zero-credit grant has no promotional expiry timestamp.

### 4.2 Spending order

Wallet balance remains one user-visible number:

```text
total balance = unexpired promotional credits + permanent credits
```

Every credit debit consumes the promotional bucket first. This applies to both current paid-credit
uses:

- tenant contact/callback unlocks;
- owner or PG-operator lead unlocks after a role upgrade.
- negative admin wallet adjustments.

The debit transaction records whether it consumed a promotional credit in transaction metadata.

### 4.3 Refunds and purchases

- Purchased credits increase only the permanent portion.
- Callback refunds and dispute refunds increase only the permanent portion.
- A refund does not restore promotional expiry, even if the original debit consumed a promotional
  credit. This implements the approved rule that refunded credits do not expire.

### 4.4 Expiry

When the 90-day timestamp passes:

- only `promotional_credits_remaining` is removed from the total balance;
- permanent credits remain untouched;
- one `expire_signup` wallet transaction records the negative adjustment;
- expiry is idempotent and cannot run twice.

Correctness must not depend on the worker being online. Expiry is enforced:

1. lazily before balance reads and credit debits; and
2. proactively by a periodic background sweep.

### 4.5 Existing users

Existing wallets are grandfathered with:

```text
promotional_credits_remaining = 0
promotional_credits_expires_at = null
```

The migration does not guess how much of an existing balance came from signup, purchase, refund,
or admin adjustment.

## 5. Root cause of the current `2` display

The latest `master` has four inconsistent sources:

1. The database signup path correctly calls `signupFreeCredits()` and defaults to 10.
2. The in-memory signup path still writes a `grant_signup` transaction with `creditsDelta: 2`.
3. The no-database `GET /wallet` response still returns `free_credits_granted: 2`.
4. `WelcomeCreditsModal` animates only `0 → 1 → 2`, and Playwright asserts `2`.

The body copy was already updated to 10, producing the visible contradiction in the supplied
screenshots.

The implementation must remove these independent literals. The API-provided signup reward becomes
the canonical source for the celebration.

## 6. Data model

Add migration `0056_signup_credit_expiry.sql` and a matching rollback:

```sql
ALTER TYPE wallet_txn_type ADD VALUE IF NOT EXISTS 'expire_signup';

ALTER TABLE wallets
  ADD COLUMN IF NOT EXISTS promotional_credits_remaining int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promotional_credits_expires_at timestamptz;

ALTER TABLE wallets
  ADD CONSTRAINT wallets_promotional_credits_nonnegative
  CHECK (promotional_credits_remaining >= 0);

CREATE INDEX IF NOT EXISTS idx_wallets_signup_promo_expiry
  ON wallets(promotional_credits_expires_at)
  WHERE promotional_credits_remaining > 0
    AND promotional_credits_expires_at IS NOT NULL;
```

`free_credits_granted` remains the historical amount originally granted. The new remaining field
tracks only the unspent, unexpired portion.

Rollback removes the index, constraint, and two columns. PostgreSQL enum values remain because
removing an enum value is unsafe and does not match existing rollback conventions.

## 7. Backend design

### 7.1 Signup reward helper

Extend the existing auth helper to return a reward object:

```ts
interface SignupReward {
  credits: number;
  expiresAt: Date | null;
}

signupReward(now: Date = new Date()): SignupReward
```

It continues to validate `SIGNUP_FREE_CREDITS` exactly as today. When credits are greater than zero,
`expiresAt` is `now + 90 days`.

### 7.2 Database signup path

During new-user creation, use one captured `now` value for:

- user creation;
- wallet grant;
- reward expiry;
- response payload.

The wallet insert initializes:

```text
balance_credits = reward.credits
free_credits_granted = reward.credits
promotional_credits_remaining = reward.credits
promotional_credits_expires_at = reward.expiresAt
```

The existing `grant_signup` transaction remains the audit record.

### 7.3 In-memory parity

`AppStateService` keeps the existing total-balance map to minimize blast radius and adds a
per-user promotional record:

```ts
{
  granted: number;
  remaining: number;
  expiresAt: number | null;
}
```

Provide focused methods for:

- granting the signup reward;
- expiring a stale reward;
- consuming a credit with promotional-first allocation;
- returning wallet details.

The in-memory auth path calls the same `signupReward()` helper as the database path. No value of 2
remains in auth or wallet fallback behavior.

### 7.4 Shared debit helper

Add a plain wallet helper used inside the existing contact and lead transactions:

```ts
debitWalletCredits(client, {
  userId,
  credits,
  txnType,
  referenceType,
  referenceId,
  idempotencyKey
});
```

The helper:

1. locks the wallet row;
2. lazily expires a stale promotional bucket;
3. rejects insufficient total balance for the requested positive `credits` amount;
4. inserts the idempotent debit transaction;
5. only when inserted, decrements total balance;
6. decrements `promotional_credits_remaining` by the promotional portion consumed;
7. writes `metadata.promotional_credits_used` as an integer;
8. returns the debit transaction id, whether it was newly inserted, and the remaining balance.

Existing domain behavior around contact unlock creation and lead visibility remains in the caller.

### 7.5 Expiry helper and sweep

Add a plain, transaction-aware helper:

```ts
expireSignupCredits(client, userId): Promise<number>
```

It atomically sets the remaining promotional balance to zero, subtracts that amount from total
balance, and inserts one `expire_signup` transaction with metadata containing the expiry timestamp.
A guarded update makes repeated calls return zero.

The worker runs an hourly sweep over due wallets using `FOR UPDATE SKIP LOCKED`. Lazy expiry in
wallet reads and debit paths remains the source of correctness.

### 7.6 API contracts

`POST /auth/otp/verify` adds this only for newly created users:

```ts
signup_reward?: {
  credits_granted: number;
  expires_at: string | null;
}
```

`GET /wallet` adds:

```ts
promotional_credits_remaining: number;
promotional_credits_expires_at: string | null;
```

`GET /auth/me` adds equivalent promotional fields so session refreshes and wallet surfaces stay
accurate.

All balance endpoints lazily expire stale promotional credits before responding.

## 8. Web session and data flow

NextAuth stores the signup reward from OTP verification in the JWT and exposes:

```ts
session.signupReward?: {
  creditsGranted: number;
  expiresAt: string | null;
}
```

The celebration opens only when all are true:

- session is authenticated;
- `session.isNewUser` is true;
- `session.signupReward.creditsGranted > 0`;
- the current route is outside `/auth/*`;
- the per-user localStorage marker is absent.

The modal renders the exact reward payload. It does not infer the grant from current wallet balance
and does not contain a hardcoded `10`.

## 9. Celebration experience

### 9.1 Visual system

Match the production homepage:

- white and pale-blue surfaces;
- subtle street-grid texture;
- Cribliv blue for the reward token and verification state;
- coral for the primary action;
- small green and amber accents;
- restrained shadows and 20–22px card radius;
- Manrope headings and the existing body font.

Do not use the dark CriblMap visual direction.

### 9.2 Composition

Card sizing:

```css
width: min(520px, calc(100vw - 24px));
```

Content order:

1. verification badge: **“Account verified · Reward unlocked”**;
2. heading: **“Welcome to Cribliv”**;
3. supporting line: **“Your home search starts with a little more freedom.”**;
4. animated blue token containing only the number;
5. label below the token: **“Free credits added”**;
6. facts:
   - **“10 credits added to your wallet”**;
   - **“Use by {localized date}”**;
7. coral CTA: **“Start finding homes”**;
8. footnote: **“Promotional credits are used first. Purchased and refunded credits do not
   expire.”**

Hindi copy is added alongside English in `lib/i18n.ts`.

### 9.3 Motion sequence

Total sequence should settle in roughly 1.4 seconds:

1. card enters with a short spring and fade;
2. verification check draws in;
3. rings expand behind the token;
4. integer count animates from 0 to the API-provided amount;
5. sparse particles burst outward around card edges;
6. expiry facts and coral CTA settle into focus.

Particles must not fall through or obscure the number, text, or CTA.

With `prefers-reduced-motion: reduce`, render the final state immediately, disable particle motion,
and keep only a short opacity transition.

### 9.4 Interaction and accessibility

- Use an accessible modal dialog with focus trap.
- Move focus to the heading on open.
- Support Escape, a visible icon close button, overlay dismissal, and the CTA.
- Restore focus on close.
- Keep all controls at least 44px high.
- Announce the final credit amount and expiry through one concise live-region message.
- Mark particles, rings, and decorative grid as `aria-hidden`.
- Preserve the existing `/auth/*` suppression that prevents the one-time modal from being consumed
  during redirect.

The localStorage marker remains per user. Mark the celebration shown only after the dialog has
mounted successfully.

## 10. Persistent wallet visibility

The modal is one-time, but expiry information is not.

Where the app already shows wallet balance, add a secondary line when promotional credits remain:

```text
{n} promotional credits expire {localized date}
```

Required surfaces:

- tenant dashboard credit summary;
- settings credit balance;
- any shared wallet balance component touched by this implementation.

Do not add new standalone wallet pages.

## 11. Analytics

Keep `welcome_credits_shown` and add metadata:

```text
credits_granted
days_valid = 90
experience_version = "reward_reveal_v2"
```

Add:

- `welcome_credits_cta_clicked`;
- `welcome_credits_dismissed`;
- `signup_credits_expired` from the worker with only aggregate credit count and no personal data.

## 12. Error handling and edge cases

- **Reward payload missing:** do not show a fake amount. Authentication still succeeds.
- **Zero-credit configuration:** no celebration; normal redirect continues.
- **Storage unavailable:** show at most once in the mounted page session using the existing ref
  guard; never crash.
- **Worker delayed:** lazy expiry prevents stale credits from being spent.
- **Debit and expiry race:** both lock the wallet row; only one observes and removes the promotional
  remainder.
- **Purchase at the expiry boundary:** expiry removes only the promotional remainder; purchased
  credits survive.
- **Refund after expiry:** the refund is permanent and increases total balance normally.
- **Role upgrade:** the promotional-first rule still applies because the current product uses one
  wallet pool.
- **Grant amount overridden:** animation, copy, transaction, and wallet fields all use the backend
  amount.
- **Negative admin adjustment:** consumes promotional credits first and cannot leave promotional
  remaining greater than total wallet balance.

## 13. Testing strategy

Implementation follows red-green-refactor.

### API unit tests

- reward defaults to 10 and expires exactly 90 days after a frozen timestamp;
- valid amount override and zero-credit behavior;
- invalid amount override falls back to 10;
- expiry helper is idempotent;
- promotional-first allocation;
- purchase and refund additions do not increase promotional remaining.

### API integration tests

- new database signup receives 10 total and 10 promotional credits with the correct timestamp;
- in-memory signup returns identical reward and wallet details;
- repeated login does not grant again;
- contact unlock spends promotional first;
- lead unlock spends promotional first;
- expiry removes only unused promotional credits;
- purchased and refunded credits remain after expiry;
- debit versus expiry race cannot overspend;
- `/wallet` and `/auth/me` return accurate promotional fields.

### Web unit/component tests

- modal renders the API-provided amount and localized expiry date;
- number-only token has no embedded “FREE CREDITS” text;
- missing or zero reward does not open;
- reduced-motion path renders the final amount immediately;
- close, Escape, overlay, and CTA all dismiss correctly;
- localStorage one-time gating remains per user;
- promotional expiry line appears only when a positive promo balance exists.

### Playwright

Update `welcome-credits.spec.ts` to verify:

1. a fresh OTP signup receives and displays `10`;
2. the label reads “Free credits added”;
3. the expiry date is 90 days from signup;
4. CTA closes the dialog;
5. reload does not show it again;
6. wallet API reports 10 total and 10 promotional credits;
7. reduced-motion emulation reaches the final state without waiting for animation.

## 14. Rollout

1. Apply migration `0056`.
2. Deploy API and worker before or with the web change.
3. Keep `SIGNUP_FREE_CREDITS=10`.
4. Smoke-test one fresh phone in database mode and one in no-database mode.
5. Verify the worker records an `expire_signup` transaction against a seeded due wallet.
6. Monitor signup, modal CTA, expiry, and insufficient-credit events.

The migration is additive and old web clients ignore the new API fields.

## 15. Acceptance criteria

- A fresh signup gets exactly 10 credits in database and no-database modes.
- The welcome experience never displays 2 unless the backend is deliberately configured to grant 2.
- Unused signup credits cannot be spent after 90 days.
- Purchased and refunded credits remain after promotional expiry.
- Promotional credits are consumed before permanent credits.
- The modal matches the production homepage and uses the approved number-only token treatment.
- Motion does not obscure content and respects reduced-motion settings.
- The reward is shown once per new user and never burns itself on the login route.
- All focused API, web unit, and Playwright tests pass.
