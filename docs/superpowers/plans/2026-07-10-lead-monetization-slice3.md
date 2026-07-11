# Lead Monetization Slice 3 (Purchase Polish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the lead-monetization purchase experience with real Razorpay Orders API integration, secure Checkout confirmation, role-correct credit packs, shared Razorpay/UPI purchase UI, and reachable owner/PG-operator upsells on the default lead boards.

**Architecture:** Keep the existing wallet ledger and signed webhook as the only credit-grant authority. A narrow payment-provider client creates real Razorpay orders while a wallet purchase service owns plan authorization, idempotency, DB/in-memory persistence, Checkout signature confirmation, and status reads. The web uses one reusable credit-purchase dialog for tenant and owner-side packs; owner and PG lead cards reuse the same monetization controls so board and list views cannot diverge.

**Tech Stack:** NestJS 10, Next.js 14 App Router, React 18, native `fetch`, Razorpay Standard Checkout, Postgres/raw SQL repositories, Vitest, Testing Library, Playwright, pnpm/Turborepo.

## Global Constraints

- Continue in the existing linked worktree `.claude/worktrees/lead-monetization`, branch `feat/lead-monetization`; starting revision `76736ebdfd391b4df2ffbc07c246c634bd4f424a`.
- Preserve all completed Slice 1 and Slice 2 behavior and feature-flag kill switches.
- Use the existing `ff_credit_purchase_enabled` API flag and add web env/PostHog support for the same name; default **OFF**. Do not add a Slice 3-specific feature flag.
- Launch prices are final for this slice: tenant `starter_10` = 9900 paise / 10 credits, tenant `growth_20` = 19900 paise / 20 credits, owner `leads_5` = 29900 paise / 5 credits, owner `leads_15` = 69900 paise / 15 credits.
- Role-plan enforcement is mandatory because the wallet is shared: tenants may buy only tenant packs; owners and `pg_operator` users may buy only lead packs; admins may not buy packs.
- Razorpay is the primary checkout. UPI deep-link remains a fallback and must keep working.
- A Razorpay order ID must come from the server-side Razorpay Orders API in live mode. Never pass the current locally generated `order_<uuid>` value to live Checkout.
- The browser receives only the Razorpay key ID. `RAZORPAY_KEY_SECRET` and webhook secrets never leave the API.
- Signed `payment.captured` webhooks remain the only path that adds wallet credits. Checkout success and signature confirmation may mark an order `authorized`, but must not credit the wallet.
- The API must verify Checkout signatures against the persisted provider order and authenticated user. Do not trust client amount, currency, plan, credits, or success state.
- Validate webhook amount/currency when Razorpay supplies them; reject a mismatch before updating the order or wallet.
- Preserve existing webhook and wallet-ledger idempotency. Same idempotency key replay with a different plan or provider returns `409 purchase_intent_conflict`.
- Keep full DB dual-mode behavior. Tests and local E2E use `RAZORPAY_ORDERS_MODE=mock`; production defaults to live and fails closed when credentials are absent.
- Provider calls use a bounded timeout of **8000 ms**. A remote order created before a process crash but never persisted is accepted as an inaccessible orphan; retries may create another remote order, but only the persisted/returned order can be paid.
- Checkout status polling: every **1000 ms**, maximum **15 attempts**. Timeout leaves the order pending and offers a manual retry; it never reports success.
- DTO fields remain snake_case and controller responses use `ok()`.
- All new UI copy must exist in English and Hindi in `apps/web/lib/i18n.ts`.
- Add `lead_pack_purchased` to `packages/shared-types/src/events.ts`; emit it only after status becomes `captured`.
- TDD is mandatory: add a failing focused test, run it and observe the expected failure, implement the minimum behavior, then rerun.
- API integration tests that bind Supertest ports may require running outside the sandbox. Web E2E uses `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64`.
- Commits use conventional prefixes. Do not push or deploy unless the user separately authorizes it.

---

### Task 1: Server-Owned Credit Catalog, Feature Flag, and Role Enforcement

**Files:**

- Modify: `apps/api/src/modules/payments/payments.util.ts`
- Modify: `apps/api/src/modules/wallet/wallet.controller.ts`
- Modify: `apps/api/src/config/feature-flags.ts`
- Modify: `apps/web/lib/feature-flags.ts`
- Modify: `packages/shared-types/src/types.ts`
- Test: `apps/api/test/wallet-credit-plans.integration.test.ts`
- Test: `apps/api/test/lead-plans.test.ts`

**Interfaces:**

- Produces `CreditPlanAudience = "tenant" | "owner"`.
- Produces `CreditPlanDto` with `plan_id`, `audience`, `amount_paise`, `credits`, `label`, `unit_price_paise`, and `recommended`.
- Produces `GET /v1/wallet/plans`, authenticated and flag-gated.
- `parseCreditPlanForRole(planId, role)` throws `403 plan_not_available_for_role` for cross-role purchases.
- `GET /wallet/plans` and `POST /wallet/purchase-intents` throw `403 feature_disabled` when `FF_CREDIT_PURCHASE_ENABLED` is false.

- [ ] **Step 1: Write failing catalog/role/flag tests**

Create `apps/api/test/wallet-credit-plans.integration.test.ts` using the in-memory `createApp()` and OTP helpers from `phase1.integration.test.ts`. The tests must:

```ts
it("returns only tenant plans to a tenant", async () => {
  const app = await createApp({ FF_CREDIT_PURCHASE_ENABLED: "true" });
  const tenant = await loginWithOtp(app, "+919999999902");
  const response = await http(app)
    .get("/v1/wallet/plans")
    .set("Authorization", `Bearer ${tenant.access_token}`)
    .expect(200);
  expect(response.body.data.items.map((item: { plan_id: string }) => item.plan_id)).toEqual([
    "starter_10",
    "growth_20"
  ]);
  await app.close();
});

it("returns only lead packs to owner-side roles", async () => {
  const app = await createApp({ FF_CREDIT_PURCHASE_ENABLED: "true" });
  const owner = await loginWithOtp(app, "+919999999901");
  const response = await http(app)
    .get("/v1/wallet/plans")
    .set("Authorization", `Bearer ${owner.access_token}`)
    .expect(200);
  expect(response.body.data.items.map((item: { plan_id: string }) => item.plan_id)).toEqual([
    "leads_5",
    "leads_15"
  ]);
  expect(response.body.data.items[1]).toMatchObject({
    amount_paise: 69900,
    credits: 15,
    recommended: true
  });
  await app.close();
});

it("rejects a cheap tenant pack for an owner", async () => {
  const app = await createApp({ FF_CREDIT_PURCHASE_ENABLED: "true" });
  const owner = await loginWithOtp(app, "+919999999901");
  const response = await http(app)
    .post("/v1/wallet/purchase-intents")
    .set("Authorization", `Bearer ${owner.access_token}`)
    .set("Idempotency-Key", "owner-cross-plan")
    .send({ plan_id: "starter_10", provider: "upi" })
    .expect(403);
  expect(getErrorCode(response.body)).toBe("plan_not_available_for_role");
  await app.close();
});

it("keeps plan listing and purchase creation disabled by default", async () => {
  const app = await createApp({ FF_CREDIT_PURCHASE_ENABLED: undefined });
  const tenant = await loginWithOtp(app, "+919999999902");
  await http(app)
    .get("/v1/wallet/plans")
    .set("Authorization", `Bearer ${tenant.access_token}`)
    .expect(403);
  await http(app)
    .post("/v1/wallet/purchase-intents")
    .set("Authorization", `Bearer ${tenant.access_token}`)
    .set("Idempotency-Key", "flag-off")
    .send({ plan_id: "starter_10", provider: "upi" })
    .expect(403);
  await app.close();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @cribliv/api test -- wallet-credit-plans lead-plans
```

Expected: failure because `/wallet/plans`, role-aware catalog metadata, and flag enforcement do not exist.

- [ ] **Step 3: Implement typed catalog and role filtering**

Change `CREDIT_PLANS` entries to:

```ts
export type CreditPlanAudience = "tenant" | "owner";

export const CREDIT_PLANS = {
  starter_10: {
    audience: "tenant",
    amountPaise: 9900,
    credits: 10,
    label: "10 callback credits",
    recommended: false
  },
  growth_20: {
    audience: "tenant",
    amountPaise: 19900,
    credits: 20,
    label: "20 callback credits",
    recommended: true
  },
  leads_5: {
    audience: "owner",
    amountPaise: 29900,
    credits: 5,
    label: "5 lead credits",
    recommended: false
  },
  leads_15: {
    audience: "owner",
    amountPaise: 69900,
    credits: 15,
    label: "15 lead credits",
    recommended: true
  }
} as const;
```

Add:

```ts
export function planAudienceForRole(role: string): CreditPlanAudience | null {
  if (role === "tenant") return "tenant";
  if (role === "owner" || role === "pg_operator") return "owner";
  return null;
}

export function parseCreditPlanForRole(planId: string, role: string) {
  const plan = parseCreditPlan(planId);
  const audience = planAudienceForRole(role);
  if (!audience || plan.audience !== audience) {
    throw new ForbiddenException({
      code: "plan_not_available_for_role",
      message: "This credit plan is not available for the current role"
    });
  }
  return plan;
}

export function listCreditPlansForRole(role: string) {
  const audience = planAudienceForRole(role);
  if (!audience) return [];
  return Object.entries(CREDIT_PLANS)
    .filter(([, plan]) => plan.audience === audience)
    .map(([planId, plan]) => ({
      plan_id: planId,
      audience: plan.audience,
      amount_paise: plan.amountPaise,
      credits: plan.credits,
      label: plan.label,
      unit_price_paise: Math.round(plan.amountPaise / plan.credits),
      recommended: plan.recommended
    }));
}
```

Add `CreditPlanAudience` and `CreditPlanDto` to shared types. Add `ff_credit_purchase_enabled` to the web `ENV_FLAG_MAP`.

In `WalletController`, include `role` in `req.user`, add a private flag assertion using `readFeatureFlags()`, add `GET plans`, and replace `parseCreditPlan()` with `parseCreditPlanForRole()`.

- [ ] **Step 4: Update old payment tests for the explicit flag**

In payment tests that intentionally exercise purchase creation, set:

```ts
process.env.FF_CREDIT_PURCHASE_ENABLED = "true";
```

Delete it in test teardown. Do not globally enable the production default.

- [ ] **Step 5: Run GREEN checks**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api test -- wallet-credit-plans lead-plans phase1
pnpm --filter @cribliv/web typecheck
```

Expected: all selected tests pass and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared-types/src/types.ts apps/api/src/modules/payments/payments.util.ts apps/api/src/modules/wallet/wallet.controller.ts apps/api/src/config/feature-flags.ts apps/web/lib/feature-flags.ts apps/api/test/wallet-credit-plans.integration.test.ts apps/api/test/lead-plans.test.ts apps/api/test/phase1.integration.test.ts
git commit -m "feat(payments): add role-aware credit catalog and purchase guard"
```

---

### Task 2: Real Razorpay Orders Client and Idempotent Purchase Service

**Files:**

- Create: `apps/api/src/modules/payments/razorpay-orders.service.ts`
- Create: `apps/api/src/modules/wallet/wallet-purchase.service.ts`
- Modify: `apps/api/src/modules/payments/payments.module.ts`
- Modify: `apps/api/src/modules/wallet/wallet.module.ts`
- Modify: `apps/api/src/modules/wallet/wallet.controller.ts`
- Modify: `apps/api/src/common/app-state.service.ts`
- Modify: `.env.example`
- Test: `apps/api/src/modules/payments/__tests__/razorpay-orders.service.test.ts`
- Test: `apps/api/test/wallet-purchase-intent.integration.test.ts`

**Interfaces:**

- `RazorpayOrdersService.createOrder(input): Promise<{ id: string; amount: number; currency: "INR" }>`
- `RazorpayOrdersService.keyId(): string`
- `WalletPurchaseService.createIntent(input)` owns DB/in-memory idempotency and returns the existing response shape with a real `provider_payload.order_id`.
- `RAZORPAY_ORDERS_MODE=mock|live`; default `mock` outside production and `live` in production.
- Live credentials: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`; request timeout `RAZORPAY_API_TIMEOUT_MS` default 8000.

- [ ] **Step 1: Write failing provider-client tests**

Cover:

```ts
it("creates a live Razorpay order with Basic auth and server-owned amount", async () => {
  process.env.RAZORPAY_ORDERS_MODE = "live";
  process.env.RAZORPAY_KEY_ID = "rzp_test_key";
  process.env.RAZORPAY_KEY_SECRET = "secret";
  const fetchFn = vi.fn(
    async () =>
      new Response(JSON.stringify({ id: "order_live_123", amount: 29900, currency: "INR" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
  );
  const service = new RazorpayOrdersService(fetchFn as typeof fetch);
  const order = await service.createOrder({
    amountPaise: 29900,
    receipt: "wallet_123",
    planId: "leads_5",
    credits: 5
  });
  expect(order.id).toBe("order_live_123");
  expect(fetchFn).toHaveBeenCalledWith(
    "https://api.razorpay.com/v1/orders",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: `Basic ${Buffer.from("rzp_test_key:secret").toString("base64")}`
      })
    })
  );
});

it("fails closed in live mode without credentials", async () => {
  process.env.RAZORPAY_ORDERS_MODE = "live";
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  await expect(
    new RazorpayOrdersService(vi.fn() as typeof fetch).createOrder({
      amountPaise: 29900,
      receipt: "wallet_123",
      planId: "leads_5",
      credits: 5
    })
  ).rejects.toMatchObject({ response: { code: "payment_provider_not_configured" } });
});

it("uses deterministic synthetic provider orders only in mock mode", async () => {
  process.env.RAZORPAY_ORDERS_MODE = "mock";
  const service = new RazorpayOrdersService(vi.fn() as typeof fetch);
  const order = await service.createOrder({
    amountPaise: 29900,
    receipt: "wallet_123",
    planId: "leads_5",
    credits: 5
  });
  expect(order.id).toMatch(/^order_mock_/);
});
```

- [ ] **Step 2: Run provider tests and verify RED**

```bash
pnpm --filter @cribliv/api test -- razorpay-orders
```

Expected: module missing.

- [ ] **Step 3: Implement `RazorpayOrdersService`**

Use native `fetch`, Basic auth, an `AbortController`, JSON body:

```ts
{
  amount: input.amountPaise,
  currency: "INR",
  receipt: input.receipt,
  notes: {
    plan_id: input.planId,
    credits_to_grant: String(input.credits)
  }
}
```

Do not include phone, name, email, user ID, or other PII in notes. Validate returned `id`, `amount`, and `currency`; map timeout/non-2xx/malformed responses to `502 payment_provider_error`.

- [ ] **Step 4: Write failing purchase-service integration tests**

`wallet-purchase-intent.integration.test.ts` must verify:

1. Razorpay mock mode returns `provider_payload.order_id === order_id`, `key_id`, amount, currency.
2. Duplicate same key/plan/provider returns the same order and calls provider creation once.
3. Same key with a different plan or provider returns `409 purchase_intent_conflict`.
4. UPI creation still returns a deep link and never calls `RazorpayOrdersService.createOrder`.
5. Two concurrent calls with the same key converge on one provider order in memory mode.

- [ ] **Step 5: Run purchase tests and verify RED**

```bash
pnpm --filter @cribliv/api test -- wallet-purchase-intent
```

Expected: conflict detection and provider-backed creation are missing.

- [ ] **Step 6: Implement `WalletPurchaseService`**

Move purchase creation out of the controller. The service must:

- validate the flag and role-plan pair before persistence;
- reserve/find the local order by `(user_id, idempotency_key)`;
- compare persisted `plan_id` and `provider` on replay and throw `purchase_intent_conflict` when different;
- serialize DB creation with a transaction and `SELECT ... FOR UPDATE`;
- serialize in-memory creation with a `Map<string, Promise<PurchaseIntentResult>>`;
- create a Razorpay order only when the persisted order has no provider order ID;
- keep UPI provider IDs locally generated;
- persist the provider order ID before returning;
- return the existing snake_case response plus `provider_payload.provider`.

The receipt is deterministic from the internal payment-order UUID:

```ts
const receipt = `wallet_${internalOrderId.replace(/-/g, "").slice(0, 32)}`;
```

- [ ] **Step 7: Wire modules and controller**

Export `RazorpayOrdersService` from `PaymentsModule`, import `PaymentsModule` in `WalletModule`, provide/export `WalletPurchaseService`, and delegate `POST purchase-intents` from `WalletController`.

Add to `.env.example`:

```dotenv
RAZORPAY_ORDERS_MODE=mock
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_API_TIMEOUT_MS=8000
```

- [ ] **Step 8: Run GREEN checks**

```bash
pnpm --filter @cribliv/api test -- razorpay-orders wallet-purchase-intent phase1
pnpm --filter @cribliv/api typecheck
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/payments apps/api/src/modules/wallet apps/api/src/common/app-state.service.ts apps/api/test/wallet-purchase-intent.integration.test.ts .env.example
git commit -m "feat(payments): create real Razorpay orders behind a provider client"
```

---

### Task 3: Checkout Signature Confirmation, Order Status, and Webhook Amount Validation

**Files:**

- Modify: `apps/api/src/modules/payments/payments.util.ts`
- Modify: `apps/api/src/modules/wallet/wallet-purchase.service.ts`
- Modify: `apps/api/src/modules/wallet/wallet.controller.ts`
- Modify: `apps/api/src/modules/payments/payments.controller.ts`
- Modify: `apps/api/openapi.yaml`
- Test: `apps/api/test/wallet-purchase-confirmation.integration.test.ts`
- Test: `apps/api/test/phase1.integration.test.ts`

**Interfaces:**

- `POST /v1/wallet/purchase-intents/:orderId/confirm`
- Body: `{ razorpay_order_id, razorpay_payment_id, razorpay_signature }`
- Response: `{ order_id, status: "authorized" | "captured", credits_to_grant }`
- `GET /v1/wallet/purchase-intents/:orderId`
- Response: `{ order_id, status, plan_id, amount_paise, credits_to_grant, provider }`
- `verifyRazorpayCheckoutSignature({ orderId, paymentId, signature, secret }): boolean`

- [ ] **Step 1: Write failing signature/status tests**

The integration suite must assert:

- a correct HMAC of `${persistedOrderId}|${paymentId}` marks only the authenticated user's order `authorized`;
- a wrong signature returns `401 invalid_payment_signature`;
- a body/path order mismatch returns `400 order_mismatch`;
- another user cannot confirm/read the order (`404 order_not_found`);
- confirmation never changes wallet balance;
- a captured webhook later changes status to `captured` and credits exactly once;
- `GET status` works in DB and in-memory modes.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @cribliv/api test -- wallet-purchase-confirmation
```

- [ ] **Step 3: Implement signature confirmation and status reads**

Use:

```ts
const expected = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
```

Compare equal-length buffers with `timingSafeEqual`. Require `RAZORPAY_KEY_SECRET` in live mode; allow `RAZORPAY_CHECKOUT_SECRET` in mock tests. Store `provider_payment_id`, set status to `authorized` only when current status is `created`, and keep `captured` terminal.

- [ ] **Step 4: Add webhook amount/currency parsing and validation**

Extend `ParsedWebhookEvent` with:

```ts
amountPaise?: number;
currency?: string;
```

Read them from Razorpay `payload.payment.entity.amount` and `.currency`. Before capture:

```ts
if (
  (parsedEvent.amountPaise !== undefined &&
    parsedEvent.amountPaise !== Number(order.amount_paise)) ||
  (parsedEvent.currency !== undefined && parsedEvent.currency !== "INR")
) {
  // mark event processed with processing_note = 'amount_currency_mismatch'
  // leave order and wallet unchanged
  // return ignored: true, reason: 'amount_currency_mismatch'
}
```

Add regression tests for amount and currency mismatch. Existing payloads without these fields continue to work.

- [ ] **Step 5: Update OpenAPI**

Document plan listing, intent creation, confirmation, and status endpoints, including that credits are posted asynchronously by a captured webhook.

- [ ] **Step 6: Run GREEN checks**

```bash
pnpm --filter @cribliv/api test -- wallet-purchase-confirmation phase1
pnpm --filter @cribliv/api typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/payments apps/api/src/modules/wallet apps/api/test/wallet-purchase-confirmation.integration.test.ts apps/api/test/phase1.integration.test.ts apps/api/openapi.yaml
git commit -m "feat(payments): verify Razorpay checkout and expose purchase status"
```

---

### Task 4: Shared Razorpay/UPI Credit Purchase Dialog

**Files:**

- Create: `apps/web/lib/credit-purchase.ts`
- Create: `apps/web/components/credit-purchase-dialog.tsx`
- Create: `apps/web/components/__tests__/credit-purchase-dialog.test.tsx`
- Create: `apps/web/lib/__tests__/credit-purchase.test.ts`
- Modify: `apps/web/lib/razorpay.ts`
- Modify: `apps/web/lib/i18n.ts`
- Modify: `apps/web/lib/__tests__/i18n-monetization.test.ts`
- Modify: `apps/web/next.config.mjs`
- Modify: `packages/shared-types/src/events.ts`

**Interfaces:**

- `fetchCreditPlans(accessToken)`
- `createCreditPurchaseIntent(accessToken, planId, provider, idempotencyKey)`
- `confirmRazorpayPurchase(accessToken, orderId, response)`
- `fetchCreditPurchaseStatus(accessToken, orderId)`
- `pollCreditPurchaseStatus(input)` with 1000 ms interval / 15 attempts defaults.
- `<CreditPurchaseDialog open accessToken locale audience initialPlanId? onClose onCaptured />`

- [ ] **Step 1: Write failing pure-client and polling tests**

Cover response mapping, fresh idempotency keys per provider attempt, captured/failed/pending polling, and timeout behavior. The timeout result must be `{ status: "pending", timedOut: true }`, not success.

- [ ] **Step 2: Run pure tests and verify RED**

```bash
pnpm --filter @cribliv/web test -- credit-purchase
```

- [ ] **Step 3: Implement API client and harden Razorpay loader**

`loadRazorpayScript()` must:

- return true immediately only when `window.Razorpay` exists;
- share one in-flight promise across concurrent calls;
- remove a failed script node so retry is possible;
- resolve false on load error or when the global is still missing.

Extend the Checkout handler response:

```ts
{
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
```

- [ ] **Step 4: Write failing dialog component tests**

Testing Library tests must verify:

1. Owner audience renders both lead packs and marks `leads_15` best value.
2. Clicking Pay creates a Razorpay intent, loads Checkout, and passes the server-returned key/order/amount.
3. Handler confirmation followed by captured status calls `onCaptured`.
4. Dismissal stays non-success and permits retry.
5. Script failure exposes the UPI fallback.
6. UPI fallback creates a fresh `provider: "upi"` intent and renders its deep link.
7. Failed/timeout status never calls `onCaptured`.

- [ ] **Step 5: Implement the dialog**

Use a modal with radio plan cards, current wallet balance, exact server catalog prices, a primary Razorpay button, secondary UPI fallback, status text, and close button. Disable duplicate submissions. After handler:

1. call confirmation endpoint;
2. poll status;
3. call `onCaptured({ planId, credits, balanceCredits? })` only for `captured`;
4. emit `lead_pack_purchased` only for owner audience after capture.

- [ ] **Step 6: Add EN/HI strings and CSP**

Add keys for title, plan unit price, best value, Pay securely, Pay with UPI, loading, cancelled, pending webhook, captured, failed, retry, and close.

Allow Razorpay Checkout in CSP:

```text
script-src ... https://checkout.razorpay.com
connect-src ... https://*.razorpay.com
frame-src https://*.razorpay.com
```

Keep `frame-ancestors 'none'`.

- [ ] **Step 7: Run GREEN checks**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/web test -- credit-purchase i18n-monetization
pnpm --filter @cribliv/web typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/shared-types/src/events.ts apps/web/lib/credit-purchase.ts apps/web/lib/razorpay.ts apps/web/components/credit-purchase-dialog.tsx apps/web/components/__tests__/credit-purchase-dialog.test.tsx apps/web/lib/__tests__/credit-purchase.test.ts apps/web/lib/i18n.ts apps/web/lib/__tests__/i18n-monetization.test.ts apps/web/next.config.mjs
git commit -m "feat(web): add shared Razorpay and UPI credit purchase dialog"
```

---

### Task 5: Integrate Tenant and Owner Purchase Surfaces

**Files:**

- Create: `apps/web/components/owner/lead-credit-balance-bar.tsx`
- Create: `apps/web/components/owner/__tests__/lead-credit-balance-bar.test.tsx`
- Modify: `apps/web/components/owner/lead-credits-panel.tsx`
- Modify: `apps/web/components/owner/lead-card.tsx`
- Modify: `apps/web/components/owner/dashboard-client.tsx`
- Modify: `apps/web/components/unlock-contact-panel.tsx`
- Modify: `apps/web/lib/i18n.ts`
- Test: `apps/web/components/owner/__tests__/lead-credits-panel.test.tsx`
- Test: `apps/web/components/__tests__/unlock-contact-purchase.test.tsx`

**Interfaces:**

- `<LeadCreditBalanceBar accessToken locale lockedLeadCount onCreditsChanged />`
- Existing `<LeadCreditsPanel>` becomes a compact launcher for the shared dialog.
- Tenant insufficient-credit UI launches the same dialog with tenant plans.
- Owner capture automatically retries the original lead unlock once.

- [ ] **Step 1: Write failing integration component tests**

Tests must verify:

- the owner balance bar shows wallet balance, locked-lead count, both pack economics, and opens the dialog;
- `LeadCreditsPanel` no longer hardcodes a UPI-only `leads_5` request;
- captured owner credits invoke `onPurchased` once;
- tenant insufficient-credit flow opens tenant plans and retries the callback request only after capture;
- flag off preserves the legacy tenant purchase/reveal behavior;
- all visible purchase strings use `t(locale, key)`.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @cribliv/web test -- lead-credit-balance lead-credits-panel unlock-contact-purchase
```

- [ ] **Step 3: Implement owner balance/upsell bar**

The bar fetches `/wallet`, derives locked lead count from props, and displays:

- current lead credits;
- `"N locked leads waiting"` when nonzero;
- Buy Credits button;
- owner purchase dialog;
- refresh after capture.

Mount it at the top of the owner dashboard leads tab, above the view/search toolbar. Do not show it when `ff_callback_leads` or `ff_credit_purchase_enabled` is off.

- [ ] **Step 4: Replace inline purchase implementations**

`LeadCreditsPanel` and `UnlockContactPanel` must delegate catalog, Razorpay, UPI, confirmation, and polling to `CreditPurchaseDialog`. Remove duplicated purchase-state machines and hardcoded pack prices. Keep wallet transaction history and callback success UI intact.

After owner capture, call the existing unlock handler once. After tenant capture, retry the original callback request once with its existing idempotency key.

- [ ] **Step 5: Run GREEN checks**

```bash
pnpm --filter @cribliv/web test -- lead-credit-balance lead-credits-panel unlock-contact-purchase
pnpm --filter @cribliv/web typecheck
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/owner apps/web/components/unlock-contact-panel.tsx apps/web/lib/i18n.ts
git commit -m "feat(web): add persistent lead-credit upsells and shared tenant checkout"
```

---

### Task 6: Default Owner/PG Board Monetization, E2E, and Rollout Documentation

**Files:**

- Create: `apps/web/components/owner/lead-monetization-controls.tsx`
- Create: `apps/web/components/owner/__tests__/lead-monetization-controls.test.tsx`
- Modify: `apps/web/components/owner/lead-card.tsx`
- Modify: `apps/web/components/owner/lead-kanban.tsx`
- Modify: `apps/web/components/owner/leads-client.tsx`
- Modify: `apps/web/components/owner/dashboard-client.tsx`
- Modify: `packages/shared-types/src/pg-operator.ts`
- Modify: `apps/api/src/modules/pg-operator/services/pg-dashboard.service.ts`
- Modify: `apps/api/src/modules/pg-operator/services/dashboard-adapters.ts`
- Modify: `apps/api/src/modules/pg-operator/__tests__/pg-dashboard.service.test.ts`
- Modify: `apps/web/components/pg-operator/dashboard/PgLeadsBoard.tsx`
- Create: `apps/web/components/pg-operator/dashboard/__tests__/PgLeadsBoard.test.tsx`
- Create: `apps/web/tests/lead-credit-purchase.spec.ts`
- Modify: `apps/web/playwright.config.ts`
- Modify: `docs/superpowers/specs/2026-07-10-lead-monetization-design.md`
- Modify: `deploymentDocs/HANDOVER.md`

**Interfaces:**

- Shared owner controls render free/locked/unlocked/expired states, countdown, unlock, call, and credit-dialog recovery.
- `PgDashboardLead` gains `access_state`, `call_deadline_at`, `called_at`, `called_by`, `tenant_name`, and optional `tenant_phone`.
- PG dashboard uses `owner/leads/:id/unlock` and `owner/leads/:id/call-click`, not the legacy `pg-operator/leads/:id/open` reveal seam when callback mode is enabled.

- [ ] **Step 1: Write failing shared-controls and PG payload tests**

Tests must verify:

- locked board cards show masked contact and Unlock for 1 credit;
- free/unlocked cards show phone and Call now;
- expired cards cannot open checkout;
- owner Kanban and list card render the same shared control component;
- PG dashboard adapter preserves access/call fields from `getOwnerLeads`;
- PG board uses the paid unlock endpoint in callback mode and opens the purchase dialog on `402 insufficient_credits`;
- callback flag off retains the existing dev reveal path.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --filter @cribliv/api test -- pg-dashboard
pnpm --filter @cribliv/web test -- lead-monetization-controls PgLeadsBoard
```

- [ ] **Step 3: Extract and reuse lead monetization controls**

Move the current monetization state machine from `LeadCard` into `lead-monetization-controls.tsx`. Add:

```ts
interface LeadMonetizationControlsProps {
  lead: LeadVm;
  accessToken: string;
  locale: Locale;
  compact?: boolean;
  onLeadPatch?: (patch: Partial<LeadVm>) => void;
}
```

Use it from both `LeadCard` and every Kanban card. Pass locale through `LeadKanban` call sites. Update parent lead arrays after unlock/call so board state stays server-consistent.

- [ ] **Step 4: Extend PG dashboard payload and UI**

Map the existing owner-lead fields instead of discarding them in `LeadsSliceAdapter`. Extend shared types and service interfaces exactly. In callback mode:

- show FREE/locked/unlocked/expired states;
- use owner unlock/call endpoints, which already permit `pg_operator`;
- reuse the shared purchase dialog for insufficient credits.

With the flag off, keep `openPgLead()` behavior.

- [ ] **Step 5: Add mocked Razorpay Playwright coverage**

Configure E2E servers with:

```text
FF_CALLBACK_LEADS=true
FF_CREDIT_PURCHASE_ENABLED=true
RAZORPAY_ORDERS_MODE=mock
RAZORPAY_CHECKOUT_SECRET=e2e_checkout_secret
NEXT_PUBLIC_FF_CALLBACK_LEADS=true
NEXT_PUBLIC_FF_CREDIT_PURCHASE_ENABLED=true
```

The Playwright test injects this shape before page code runs:

```ts
await page.addInitScript(() => {
  (window as any).Razorpay = class {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
    }
    open() {
      (window as any).__criblivRazorpayOptions = this.options;
    }
  };
});
```

After clicking Pay, read `__criblivRazorpayOptions.order_id`, compute in the Playwright Node process:

```ts
const paymentId = "pay_e2e_lead_pack";
const signature = createHmac("sha256", "e2e_checkout_secret")
  .update(`${orderId}|${paymentId}`)
  .digest("hex");
```

Invoke the captured handler with `page.evaluate()`. Then create a Razorpay `payment.captured` payload containing the same `order_id`, `payment_id`, expected amount, and `currency: "INR"`. Sign the raw `JSON.stringify(payload)` with `PAYMENT_WEBHOOK_SECRET=e2e_webhook_secret`, post it to `/v1/webhooks/razorpay`, wait for the purchase-status poll to observe `captured`, and assert the original locked lead unlocks without a second user click.

Also cover:

- Checkout dismissal does not change balance;
- UPI fallback produces a `upi://` link;
- flag off hides all purchase polish and preserves existing behavior.

- [ ] **Step 6: Update rollout docs**

Mark Slice 3 implemented in the design spec and document:

- required Razorpay key ID/secret and webhook secret;
- Orders API mode;
- subscribed events `payment.captured` and `payment.failed`;
- webhook URL `/v1/webhooks/razorpay`;
- automatic capture must be enabled in the Razorpay account;
- dark deployment order: credentials/webhook first, then API flag, then web flag;
- no deployment was performed by this implementation.

- [ ] **Step 7: Run focused and full verification**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api test
pnpm --filter @cribliv/api typecheck
pnpm --filter @cribliv/web test
pnpm --filter @cribliv/web typecheck
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test
pnpm build
```

Expected: all commands exit 0. If a repository-wide pre-existing failure appears, record the exact command/output, prove focused Slice 3 checks pass, and do not claim the full suite is clean.

- [ ] **Step 8: Commit**

```bash
git add apps packages docs/superpowers/specs/2026-07-10-lead-monetization-design.md deploymentDocs/HANDOVER.md
git commit -m "feat(leads): complete purchase polish across owner and PG boards"
```

---

## Plan Self-Review Checklist

- Every Slice 3 spec item is covered: Razorpay widget, final prices, owner upsell surfaces.
- The hidden invalid-order-ID gap is addressed by server-created Razorpay orders.
- Role-plan enforcement prevents owners from buying cheaper tenant credits.
- Credit granting remains webhook-only and idempotent.
- Checkout signature confirmation and webhook amount validation are explicit.
- UPI fallback, DB/in-memory modes, feature flags, EN/HI copy, owner, tenant, and PG-operator surfaces are covered.
- The default owner board receives monetization controls; the secondary list view is not the only working path.
- No schema migration or broad boost/subscription/rent-agreement payment refactor is introduced.
- No production deployment, provider account mutation, or secret creation is authorized.
