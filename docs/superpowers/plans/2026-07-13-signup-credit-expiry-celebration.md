# Signup Credit Expiry + Celebration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each new OTP account 10 promotional credits that expire after 90 days, preserve purchased/refunded credits permanently, and replace the broken `2`-credit modal with the approved production-homepage-matched reward reveal.

**Architecture:** Extend `wallets` with an explicit promotional remainder and expiry timestamp, centralize database expiry/debit behavior in focused plain helpers, and mirror the same rules in `AppStateService`. Carry the server-issued signup reward through NextAuth so the celebration renders canonical amount/date data, while wallet APIs expose persistent promotional expiry information.

**Tech Stack:** NestJS, PostgreSQL, raw SQL migrations, Vitest, Next.js 14, NextAuth v5, React 18, Framer Motion, Playwright.

## Global Constraints

- New OTP users receive `SIGNUP_FREE_CREDITS`, default `10`.
- Signup promotional credits expire exactly 90 days after signup.
- Promotional credits are spent before permanent credits.
- Purchased and refunded credits never expire.
- Existing wallets are grandfathered with zero promotional remaining and no expiry.
- Database and no-database modes must have equivalent behavior.
- The celebration must render the backend-provided reward amount and expiry date; no hardcoded `10` or `2`.
- The blue reward token contains only the number; “Free credits added” is outside the token.
- Match the production homepage: white/pale-blue surfaces, blue reward token, coral CTA, sparse green/amber/coral accents.
- Respect `prefers-reduced-motion`, keep particles away from content, and preserve the `/auth/*` suppression.
- Use TDD: write each behavior test first and verify the expected failure before implementation.
- Do not modify or revert unrelated `.claude/`, `.playwright-cli/`, or `output/` changes.

---

### Task 1: Schema and Signup Reward Calculation

**Files:**

- Create: `infra/migrations/0057_signup_credit_expiry.sql`
- Create: `infra/migrations/0057_signup_credit_expiry.rollback.sql`
- Modify: `apps/api/src/modules/auth/signup-credits.ts`
- Modify: `apps/api/src/modules/auth/__tests__/signup-credits.test.ts`
- Modify: `packages/shared-types/src/types.ts`

**Interfaces:**

- Produces:

```ts
export interface SignupReward {
  credits: number;
  expiresAt: Date | null;
}

export function signupReward(now?: Date): SignupReward;
export function signupFreeCredits(): number;
```

- `signupFreeCredits()` remains as a compatibility wrapper returning `signupReward().credits`.
- Adds wallet transaction type `"expire_signup"`.

- [ ] **Step 1: Extend the failing reward tests**

Add frozen-time tests:

```ts
it("returns a 10-credit reward expiring exactly 90 days later", () => {
  delete process.env[KEY];
  const now = new Date("2026-07-13T08:30:00.000Z");
  expect(signupReward(now)).toEqual({
    credits: 10,
    expiresAt: new Date("2026-10-11T08:30:00.000Z")
  });
});

it("returns no expiry when the grant is disabled", () => {
  process.env[KEY] = "0";
  expect(signupReward(new Date("2026-07-13T08:30:00.000Z"))).toEqual({
    credits: 0,
    expiresAt: null
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/auth/__tests__/signup-credits.test.ts
```

Expected: FAIL because `signupReward` is not exported.

- [ ] **Step 3: Implement the reward helper**

Use integer-day arithmetic:

```ts
const SIGNUP_REWARD_DAYS = 90;

export function signupReward(now = new Date()): SignupReward {
  const credits = readSignupCreditAmount();
  return {
    credits,
    expiresAt:
      credits > 0 ? new Date(now.getTime() + SIGNUP_REWARD_DAYS * 24 * 60 * 60 * 1000) : null
  };
}

export function signupFreeCredits(): number {
  return signupReward().credits;
}
```

- [ ] **Step 4: Add migration and shared type**

Migration:

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

Rollback drops the index, constraint, and columns. Extend `WalletTxnType` with `"expire_signup"`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/auth/__tests__/signup-credits.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: reward tests PASS and API typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add infra/migrations/0057_signup_credit_expiry* \
  apps/api/src/modules/auth/signup-credits.ts \
  apps/api/src/modules/auth/__tests__/signup-credits.test.ts \
  packages/shared-types/src/types.ts
git commit -m "feat(api): define expiring signup reward"
```

---

### Task 2: In-Memory Wallet Parity

**Files:**

- Modify: `apps/api/src/common/app-state.service.ts`
- Create: `apps/api/src/common/__tests__/app-state-promotional-wallet.test.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/wallet/wallet.controller.ts`

**Interfaces:**

- Consumes: `signupReward(now?: Date)`.
- Produces:

```ts
export interface PromotionalWalletState {
  granted: number;
  remaining: number;
  expiresAt: number | null;
}

grantSignupReward(userId: string, reward: SignupReward): WalletTxn;
getWalletDetails(userId: string, now?: number): {
  balanceCredits: number;
  freeCreditsGranted: number;
  promotionalCreditsRemaining: number;
  promotionalCreditsExpiresAt: number | null;
};
debitWalletCredits(input: {
  userId: string;
  credits: number;
  type: string;
  referenceId?: string;
  idempotencyKey?: string;
}, now?: number): WalletTxn;
```

- `addWalletTxn` keeps positive purchase/refund/admin additions permanent.
- Negative admin adjustments call `debitWalletCredits`.

- [ ] **Step 1: Write failing in-memory wallet tests**

Cover:

```ts
it("grants and exposes 10 promotional credits");
it("debits promotional credits before permanent credits");
it("expires only the unused promotional remainder");
it("keeps refund and purchase credits after expiry");
it("does not expire twice");
```

Use explicit timestamps and assert both total and promotional balances.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run src/common/__tests__/app-state-promotional-wallet.test.ts
```

Expected: FAIL because promotional wallet APIs do not exist.

- [ ] **Step 3: Implement `AppStateService` promotional state**

Add:

```ts
promotionalWallets = new Map<string, PromotionalWalletState>();
```

`getWalletDetails()` lazily expires when `expiresAt <= now`, subtracting exactly `remaining` from
the total and adding one `expire_signup` transaction with metadata `{ expiredCredits, expiresAt }`.

`debitWalletCredits()`:

1. calls `getWalletDetails`;
2. rejects invalid or insufficient amounts;
3. returns the existing idempotent transaction when present;
4. subtracts from total;
5. subtracts `Math.min(remaining, credits)` from promotional remaining;
6. stores `promotionalCreditsUsed` in transaction metadata.

- [ ] **Step 4: Wire in-memory signup and wallet response**

Replace the hardcoded `2` in `verifyOtpInMemory`:

```ts
const reward = signupReward();
this.appState.grantSignupReward(user.id, reward);
```

Return:

```ts
signup_reward: {
  credits_granted: reward.credits,
  expires_at: reward.expiresAt?.toISOString() ?? null
}
```

Use `getWalletDetails()` in no-database `GET /wallet`.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run \
  src/common/__tests__/app-state-promotional-wallet.test.ts \
  src/modules/auth/__tests__/signup-credits.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/app-state.service.ts \
  apps/api/src/common/__tests__/app-state-promotional-wallet.test.ts \
  apps/api/src/modules/auth/auth.service.ts \
  apps/api/src/modules/wallet/wallet.controller.ts
git commit -m "feat(api): mirror promotional wallet in memory"
```

---

### Task 3: Transactional Database Wallet Operations

**Files:**

- Create: `apps/api/src/modules/wallet/wallet-balance.ts`
- Create: `apps/api/src/modules/wallet/__tests__/wallet-balance.test.ts`
- Modify: `apps/api/src/modules/contacts/contacts.service.ts`
- Modify: `apps/api/src/modules/leads/leads.service.ts`
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Modify: `apps/api/src/modules/wallet/wallet.module.ts`

**Interfaces:**

- Produces:

```ts
export async function expireSignupCredits(client: PoolClient, userId: string): Promise<number>;

export async function debitWalletCredits(
  client: PoolClient,
  input: {
    userId: string;
    credits: number;
    txnType: "debit_contact_unlock" | "debit_lead_unlock" | "admin_adjustment";
    referenceType: "listing" | "lead" | "admin";
    referenceId: string;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{
  transactionId: string;
  inserted: boolean;
  balanceCredits: number;
  promotionalCreditsUsed: number;
}>;
```

- Both helpers assume the caller owns the surrounding transaction.
- `debitWalletCredits` locks the wallet row and invokes expiry under that lock.

- [ ] **Step 1: Write failing helper tests**

Use a query-recording fake `PoolClient` to assert:

- due promotional credits create one `expire_signup` transaction and subtract only the remainder;
- a second expiry is a no-op;
- a one-credit debit consumes promotional remaining first;
- an idempotent replay does not debit again;
- a multi-credit negative admin adjustment consumes the promo portion first.

- [ ] **Step 2: Run helper tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/wallet/__tests__/wallet-balance.test.ts
```

Expected: FAIL because `wallet-balance.ts` does not exist.

- [ ] **Step 3: Implement guarded SQL helpers**

Use one locked wallet row:

```sql
SELECT balance_credits, promotional_credits_remaining,
       promotional_credits_expires_at::text
FROM wallets
WHERE user_id = $1::uuid
FOR UPDATE
```

Expiry writes:

```sql
UPDATE wallets
SET balance_credits = balance_credits - promotional_credits_remaining,
    promotional_credits_remaining = 0,
    updated_at = now()
WHERE user_id = $1::uuid
  AND promotional_credits_remaining > 0
  AND promotional_credits_expires_at <= now()
RETURNING promotional_credits_remaining AS impossible_after_update
```

Use a CTE or capture the pre-update amount so the `expire_signup` transaction receives the exact
negative delta and metadata.

- [ ] **Step 4: Replace tenant and lead debit blocks**

In `ContactsService` and `LeadsService`, replace duplicated wallet/debit SQL with
`debitWalletCredits`. Preserve their domain-specific duplicate-unlock healing and unlock writes.

- [ ] **Step 5: Route negative admin adjustments through the helper**

Positive admin adjustments remain permanent direct additions. Negative adjustments call
`debitWalletCredits` with `credits = Math.abs(body.credits_delta)`, then preserve the existing
`admin_actions` audit.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run \
  src/modules/wallet/__tests__/wallet-balance.test.ts \
  test/phase1.integration.test.ts \
  test/lead-unlock.integration.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: wallet tests and affected integration tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/wallet/wallet-balance.ts \
  apps/api/src/modules/wallet/__tests__/wallet-balance.test.ts \
  apps/api/src/modules/contacts/contacts.service.ts \
  apps/api/src/modules/leads/leads.service.ts \
  apps/api/src/modules/admin/admin.controller.ts \
  apps/api/src/modules/wallet/wallet.module.ts
git commit -m "feat(api): spend and expire signup credits safely"
```

---

### Task 4: Database Signup, Wallet APIs, and Worker Sweep

**Files:**

- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/wallet/wallet.controller.ts`
- Create: `apps/api/src/worker/signup-credit-sweep.ts`
- Create: `apps/api/src/worker/__tests__/signup-credit-sweep.test.ts`
- Modify: `apps/api/src/worker/worker.ts`
- Create: `apps/api/test/signup-credit-expiry.integration.test.ts`

**Interfaces:**

- Consumes: `signupReward`, `expireSignupCredits`.
- Produces:

```ts
export async function runSignupCreditExpirySweepDb(pool: Pool): Promise<{
  walletsExpired: number;
  creditsExpired: number;
}>;
```

- Auth response:

```ts
signup_reward?: {
  credits_granted: number;
  expires_at: string | null;
}
```

- Wallet/me response fields:

```ts
promotional_credits_remaining: number;
promotional_credits_expires_at: string | null;
```

- [ ] **Step 1: Write failing database integration tests**

Cover fresh signup grant, exact 90-day expiry, returning login not regranting, wallet/me response
fields, purchased/refunded permanence, and due-wallet sweep idempotency.

- [ ] **Step 2: Run integration tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run test/signup-credit-expiry.integration.test.ts
```

Expected: FAIL because the migration fields and response payloads are not wired.

- [ ] **Step 3: Wire database signup**

Capture:

```ts
const rewardNow = new Date();
const reward = signupReward(rewardNow);
```

Insert the new wallet columns and return `signup_reward` only when `isNewUser`.

- [ ] **Step 4: Lazily expire before wallet and me reads**

For database reads, open a transaction, call `expireSignupCredits(client, userId)`, then select and
return total/free/promotional fields. The in-memory path uses `getWalletDetails()`.

- [ ] **Step 5: Implement and schedule the sweep**

The sweep selects due user ids in batches with:

```sql
FOR UPDATE SKIP LOCKED
```

Schedule hourly in `worker.ts` and log `wallets_expired` plus `credits_expired`.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm --filter @cribliv/api exec vitest run \
  test/signup-credit-expiry.integration.test.ts \
  src/worker/__tests__/signup-credit-sweep.test.ts
pnpm --filter @cribliv/api typecheck
```

Expected: tests PASS and typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts \
  apps/api/src/modules/wallet/wallet.controller.ts \
  apps/api/src/worker/signup-credit-sweep.ts \
  apps/api/src/worker/__tests__/signup-credit-sweep.test.ts \
  apps/api/src/worker/worker.ts \
  apps/api/test/signup-credit-expiry.integration.test.ts
git commit -m "feat(api): expose and sweep signup credit expiry"
```

---

### Task 5: NextAuth Reward Contract and Celebration Component

**Files:**

- Modify: `apps/web/auth.ts`
- Modify: `apps/web/auth.config.ts`
- Modify: `apps/web/lib/i18n.ts`
- Modify: `apps/web/lib/welcome-credits.ts`
- Modify: `apps/web/lib/__tests__/welcome-credits.test.ts`
- Modify: `apps/web/components/welcome-credits-modal.tsx`
- Create: `apps/web/components/__tests__/welcome-credits-modal.test.tsx`
- Modify: `apps/web/app/globals.css`
- Modify: `packages/shared-types/src/events.ts`

**Interfaces:**

- Produces:

```ts
session.signupReward?: {
  creditsGranted: number;
  expiresAt: string | null;
};
```

- Welcome helper:

```ts
formatSignupRewardExpiry(expiresAt: string, locale: Locale): string;
```

- [ ] **Step 1: Write failing NextAuth/welcome tests**

Add tests that assert:

- OTP response reward maps into User, JWT, and Session;
- reward amount is not inferred from wallet balance;
- zero/missing reward blocks the modal;
- expiry date formats for English and Hindi;
- the token contains `10` but no `FREE CREDITS` text;
- reduced motion renders the final amount immediately;
- Escape, overlay, close icon, and CTA dismiss.

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/web exec vitest run \
  lib/__tests__/welcome-credits.test.ts \
  components/__tests__/welcome-credits-modal.test.tsx
```

Expected: FAIL because reward session fields and the new component behavior are absent.

- [ ] **Step 3: Carry reward through NextAuth**

Add `signup_reward` to `OtpVerifyResponse`, map to camel case in `authorize`, persist it through JWT,
and expose it on `session.signupReward`.

Add promotional wallet fields from `/auth/me` to the session:

```ts
session.promotionalCredits = {
  remaining: payload.data.promotional_credits_remaining ?? 0,
  expiresAt: payload.data.promotional_credits_expires_at ?? null
};
```

- [ ] **Step 4: Implement approved reward reveal**

Use Framer Motion and CSS classes rather than large inline style objects:

- accessible dialog with visible `X` icon button;
- production-homepage pale grid;
- account verified badge;
- number-only blue token;
- external “Free credits added” label;
- exact localized use-by date;
- coral “Start finding homes” CTA;
- sparse edge particles;
- focus trap, Escape, focus restore, and reduced-motion behavior.

Count from 0 to `session.signupReward.creditsGranted` using `requestAnimationFrame` or a bounded
timer driven by the canonical amount.

- [ ] **Step 5: Update copy and analytics events**

Add English/Hindi keys for the badge, heading, supporting line, label, fact labels, CTA, footnote,
and live-region message. Extend events with CTA and dismissal events. Keep `welcome_credits_shown`
with metadata.

- [ ] **Step 6: Verify GREEN**

Run:

```bash
pnpm --filter @cribliv/web exec vitest run \
  lib/__tests__/welcome-credits.test.ts \
  components/__tests__/welcome-credits-modal.test.tsx \
  lib/__tests__/auth-is-new-user.test.ts
pnpm --filter @cribliv/web typecheck
```

Expected: tests PASS and web typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/auth.ts apps/web/auth.config.ts \
  apps/web/lib/i18n.ts apps/web/lib/welcome-credits.ts \
  apps/web/lib/__tests__/welcome-credits.test.ts \
  apps/web/components/welcome-credits-modal.tsx \
  apps/web/components/__tests__/welcome-credits-modal.test.tsx \
  apps/web/app/globals.css packages/shared-types/src/events.ts
git commit -m "feat(web): add grand signup reward reveal"
```

---

### Task 6: Persistent Expiry Display and End-to-End Signup Verification

**Files:**

- Create: `apps/web/components/promotional-credit-expiry.tsx`
- Create: `apps/web/components/__tests__/promotional-credit-expiry.test.tsx`
- Modify: `apps/web/app/[locale]/tenant/dashboard/page.tsx`
- Modify: `apps/web/components/settings-client.tsx`
- Modify: `apps/web/components/session-banner.tsx`
- Modify: `apps/web/tests/welcome-credits.spec.ts`
- Modify: `apps/api/test/lead-unlock.integration.test.ts`
- Modify: `apps/api/test/phase1.integration.test.ts`
- Modify: affected web wallet fixture tests replacing stale `free_credits_granted: 2` assumptions

**Interfaces:**

- Consumes:

```ts
session.promotionalCredits?: {
  remaining: number;
  expiresAt: string | null;
};
```

- Produces:

```tsx
<PromotionalCreditExpiry remaining={number} expiresAt={string | null} locale={Locale} />
```

- [ ] **Step 1: Write failing display tests**

Assert the component:

- renders `{n} promotional credits expire {date}` for positive, dated credit state;
- renders nothing for zero remaining or null expiry;
- uses Hindi copy/date formatting when `locale="hi"`.

- [ ] **Step 2: Run display tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/web exec vitest run \
  components/__tests__/promotional-credit-expiry.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement and place persistent expiry text**

Use the component under existing wallet balances in tenant dashboard, settings, and session banner.
Do not add new cards or pages.

- [ ] **Step 4: Update stale fixtures and E2E**

Update tests that assumed a two-credit signup grant. In `welcome-credits.spec.ts`, assert:

```ts
await expect(page.getByTestId("welcome-credit-count")).toHaveText("10");
await expect(page.getByText("Free credits added")).toBeVisible();
await expect(page.getByText(/Use by/)).toBeVisible();
```

Query `/wallet` and assert total/promotional balances are 10. Add a reduced-motion test.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm --filter @cribliv/api test
pnpm --filter @cribliv/web test
pnpm typecheck
pnpm build
```

Expected: all commands exit 0.

- [ ] **Step 6: Run the real signup browser flow**

Start Postgres/API/web as needed, then run:

```bash
pnpm --filter @cribliv/web exec playwright test tests/welcome-credits.spec.ts
```

Expected: fresh signup shows 10, the exact expiry date, and does not reappear after reload.

- [ ] **Step 7: Visual QA**

Use Playwright at desktop and mobile widths to verify:

- modal fits without overlap;
- token text is only the number;
- particles do not cross content;
- CTA remains visible;
- reduced-motion final state is correct.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/promotional-credit-expiry.tsx \
  apps/web/components/__tests__/promotional-credit-expiry.test.tsx \
  apps/web/app/[locale]/tenant/dashboard/page.tsx \
  apps/web/components/settings-client.tsx \
  apps/web/components/session-banner.tsx \
  apps/web/tests/welcome-credits.spec.ts \
  apps/api/test/lead-unlock.integration.test.ts \
  apps/api/test/phase1.integration.test.ts \
  apps/web/components/__tests__
git commit -m "test: verify expiring signup credit experience"
```

---

### Task 7: Whole-Branch Review and Final Verification

**Files:**

- Review: all changes from `39b82ef..HEAD`
- Modify only files required by review findings.

**Interfaces:**

- Produces a branch with all Critical and Important review findings resolved.

- [ ] **Step 1: Run a whole-branch code review**

Review concurrency, idempotency, expiry math, purchase/refund permanence, session data lifetime,
accessibility, mobile layout, and test coverage against the design spec.

- [ ] **Step 2: Fix all Critical and Important findings**

For each fix, add or update a focused regression test first, verify RED, implement, and verify GREEN.

- [ ] **Step 3: Run final verification**

Run fresh:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @cribliv/web exec playwright test tests/welcome-credits.spec.ts
git diff --check origin/master...HEAD
```

Expected: every command exits 0 and Playwright reports the welcome-credit tests passing.

- [ ] **Step 4: Record final status**

Report exact test/build results, any environment-dependent checks not run, and the branch state.
