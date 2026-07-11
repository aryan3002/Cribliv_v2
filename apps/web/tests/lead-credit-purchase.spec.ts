// apps/web/tests/lead-credit-purchase.spec.ts
//
// Owner/PG lead-credit purchase E2E: locked lead -> insufficient_credits ->
// mocked Razorpay checkout -> simulated payment.captured webhook -> the
// dialog's own poll auto-retries the original unlock (no second click).
//
// Requires a DB-backed API (owner leads are DB-only — apps/api/src/modules/leads
// has no in-memory fallback) with:
//   FF_CALLBACK_LEADS=true FF_LEAD_MANAGEMENT_ENABLED=true FF_CREDIT_PURCHASE_ENABLED=true
//   RAZORPAY_ORDERS_MODE=mock RAZORPAY_CHECKOUT_SECRET=e2e_checkout_secret
//   PAYMENT_WEBHOOK_SECRET=e2e_webhook_secret
//   NEXT_PUBLIC_FF_CALLBACK_LEADS=true NEXT_PUBLIC_FF_CREDIT_PURCHASE_ENABLED=true
// and DATABASE_URL pointed at a migrated (0053+), seeded Postgres (see
// docs/superpowers/specs/2026-07-10-lead-monetization-design.md, "Rollout" —
// pnpm db:seed provides the owner/tenant/admin test phones and city data
// these tests create listings/leads against).
//
// Self-skips otherwise, mirroring callback-leads.spec.ts / welcome-credits.spec.ts.
import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { loginWithOtp, setSessionOnPage } from "./utils/auth";

function flagOn(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

const FLAG_ON =
  flagOn("NEXT_PUBLIC_FF_CALLBACK_LEADS") && flagOn("NEXT_PUBLIC_FF_CREDIT_PURCHASE_ENABLED");

const CHECKOUT_SECRET = process.env.RAZORPAY_CHECKOUT_SECRET || "e2e_checkout_secret";
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "e2e_webhook_secret";

function getApiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function randPhone(): string {
  return `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

interface OwnerLeadRow {
  id: string;
  listing_id: string;
  access_state: string;
}

async function createActiveListing(
  request: APIRequestContext,
  ownerToken: string,
  adminToken: string,
  title: string
): Promise<string> {
  const api = getApiBaseUrl();
  const create = await request.post(`${api}/owner/listings`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { title, listing_type: "flat_house", rent: 15000, location: { city: "delhi" } }
  });
  expect(create.ok(), `create listing failed: ${await create.text()}`).toBeTruthy();
  const listingId = (await create.json()).data.listing_id as string;

  const submit = await request.post(`${api}/owner/listings/${listingId}/submit`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { agree_terms: true }
  });
  expect(submit.ok(), `submit listing failed: ${await submit.text()}`).toBeTruthy();

  const decision = await request.post(`${api}/admin/review/listings/${listingId}/decision`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { decision: "approve" }
  });
  expect(decision.ok(), `admin approve failed: ${await decision.text()}`).toBeTruthy();

  return listingId;
}

async function requestCallback(
  request: APIRequestContext,
  listingId: string,
  idempotencyKey: string
): Promise<void> {
  const tenant = await loginWithOtp(request, randPhone());
  const res = await request.post(`${getApiBaseUrl()}/tenant/contact-unlocks`, {
    headers: { Authorization: `Bearer ${tenant.access_token}`, "Idempotency-Key": idempotencyKey },
    data: { listing_id: listingId }
  });
  expect(res.ok(), `contact-unlock failed: ${await res.text()}`).toBeTruthy();
  // Lead creation is fire-and-forget server-side (contacts.service.ts) — give
  // it a beat, mirroring apps/api/test/lead-unlock.integration.test.ts.
  await new Promise((resolve) => setTimeout(resolve, 400));
}

async function fetchOwnerLeads(
  request: APIRequestContext,
  ownerToken: string
): Promise<OwnerLeadRow[]> {
  const res = await request.get(`${getApiBaseUrl()}/owner/leads?page_size=200`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data.items as OwnerLeadRow[];
}

async function getOwnerWalletBalance(
  request: APIRequestContext,
  ownerToken: string
): Promise<number> {
  const res = await request.get(`${getApiBaseUrl()}/wallet`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data.balance_credits as number;
}

async function unlockLeadViaApi(
  request: APIRequestContext,
  ownerToken: string,
  leadId: string,
  idempotencyKey: string
): Promise<void> {
  const res = await request.post(`${getApiBaseUrl()}/owner/leads/${leadId}/unlock`, {
    headers: { Authorization: `Bearer ${ownerToken}`, "Idempotency-Key": idempotencyKey }
  });
  expect(res.ok(), `unlock failed: ${await res.text()}`).toBeTruthy();
}

/**
 * Guarantees a fresh locked lead for the owner whose unlock will 402 with
 * insufficient_credits — regardless of the owner's accumulated lead/wallet
 * history from earlier tests in this file (the seeded owner phone is shared
 * across every owner-role E2E spec, so wallet balance and lifetime lead count
 * both persist across tests). Reads the current balance, creates fresh
 * listings + tenant callbacks until at least `balance + 1` NEW locked leads
 * exist, then drains all but one via the real unlock endpoint — leaving
 * exactly one locked lead behind a zero-credit wallet.
 */
async function ensureLockedLeadWithZeroBalance(
  request: APIRequestContext,
  ownerToken: string,
  adminToken: string,
  runId: string,
  seq: string
): Promise<{ listingId: string; title: string }> {
  const balance = await getOwnerWalletBalance(request, ownerToken);
  const needed = balance + 1;

  const created: Array<{ listingId: string; title: string }> = [];
  let locked: OwnerLeadRow[] = [];
  let i = 0;
  while (locked.length < needed) {
    const title = `E2E ${seq}-${i} ${runId}`;
    const listingId = await createActiveListing(request, ownerToken, adminToken, title);
    await requestCallback(request, listingId, `e2e-${seq}-${i}-${runId}`);
    created.push({ listingId, title });
    i += 1;

    const leads = await fetchOwnerLeads(request, ownerToken);
    const ids = new Set(created.map((c) => c.listingId));
    locked = leads.filter((l) => ids.has(l.listing_id) && l.access_state === "locked");
  }

  // Burn every locked lead but the last one so the wallet is exactly 0 again.
  for (let j = 0; j < locked.length - 1; j += 1) {
    await unlockLeadViaApi(request, ownerToken, locked[j].id, `drain-${seq}-${j}-${runId}`);
  }

  const target = locked[locked.length - 1];
  const meta = created.find((c) => c.listingId === target.listing_id)!;
  return meta;
}

async function installMockRazorpay(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { Razorpay: unknown }).Razorpay = class {
      options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
      open() {
        (window as unknown as { __criblivRazorpayOptions: unknown }).__criblivRazorpayOptions =
          this.options;
      }
    };
  });
}

async function signInAsOwner(page: Page, owner: Awaited<ReturnType<typeof loginWithOtp>>) {
  await page.goto("/en");
  await setSessionOnPage(page, owner);
  await page.goto("/en/owner/dashboard?tab=leads");
}

test.describe("lead credit purchase (flag on)", () => {
  test.skip(
    !FLAG_ON,
    "NEXT_PUBLIC_FF_CALLBACK_LEADS / NEXT_PUBLIC_FF_CREDIT_PURCHASE_ENABLED not set for this run"
  );

  test("locked lead: insufficient credits opens the purchase dialog; mocked Razorpay + the payment.captured webhook auto-unlock without a second click", async ({
    page,
    request
  }) => {
    const runId = Date.now().toString(36);
    const owner = await loginWithOtp(request, "+919999999901");
    const admin = await loginWithOtp(request, "+919999999903");

    const target = await ensureLockedLeadWithZeroBalance(
      request,
      owner.access_token,
      admin.access_token,
      runId,
      "main"
    );

    await installMockRazorpay(page);
    await signInAsOwner(page, owner);

    const card = page.locator("article", { hasText: target.title });
    await expect(card).toBeVisible();
    await card.locator("button", { hasText: "Unlock for 1 credit" }).click();

    // Owner wallet is at 0 by construction — the unlock 402s and the shared
    // buy-credits panel appears inline on the card.
    await expect(card.getByTestId("lead-credits-panel")).toBeVisible();
    await card.getByTestId("lead-credits-buy-button").click();

    const dialog = page.getByTestId("credit-purchase-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("cp-plan-leads_5").click();
    await dialog.getByTestId("cp-pay-razorpay").click();

    await page.waitForFunction(() =>
      Boolean(
        (window as unknown as { __criblivRazorpayOptions?: unknown }).__criblivRazorpayOptions
      )
    );
    const orderId = await page.evaluate(
      () =>
        (window as unknown as { __criblivRazorpayOptions: { order_id: string } })
          .__criblivRazorpayOptions.order_id
    );

    const paymentId = "pay_e2e_lead_pack";
    const checkoutSignature = createHmac("sha256", CHECKOUT_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");

    // Invoke the Checkout success handler exactly like the real widget would
    // after a completed payment — this hits confirm (signature-verified,
    // status -> authorized) then starts the dialog's own status poll.
    await page.evaluate(
      ({ orderId, paymentId, signature }) => {
        (
          window as unknown as {
            __criblivRazorpayOptions: {
              handler: (r: {
                razorpay_order_id: string;
                razorpay_payment_id: string;
                razorpay_signature: string;
              }) => void;
            };
          }
        ).__criblivRazorpayOptions.handler({
          razorpay_order_id: orderId,
          razorpay_payment_id: paymentId,
          razorpay_signature: signature
        });
      },
      { orderId, paymentId, signature: checkoutSignature }
    );

    // Crediting is webhook-only — simulate Razorpay's payment.captured event.
    const amountPaise = 29900; // leads_5 pack (payments.util.ts CREDIT_PLANS)
    const webhookPayload = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: { id: paymentId, order_id: orderId, amount: amountPaise, currency: "INR" }
        }
      }
    };
    const rawBody = JSON.stringify(webhookPayload);
    const webhookSignature = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");

    const webhookRes = await request.post(`${getApiBaseUrl()}/webhooks/razorpay`, {
      data: rawBody,
      headers: { "Content-Type": "application/json", "x-razorpay-signature": webhookSignature }
    });
    expect(webhookRes.ok(), `webhook failed: ${await webhookRes.text()}`).toBeTruthy();
    const webhookJson = await webhookRes.json();
    expect(webhookJson.data.payment_status).toBe("captured");

    // The dialog's own poll observes `captured`, closes, and LeadCreditsPanel's
    // onPurchased auto-retries the ORIGINAL unlock — no second click here.
    await expect(dialog).not.toBeVisible({ timeout: 20_000 });
    await expect(card.locator("button", { hasText: "Call now" })).toBeVisible({ timeout: 5_000 });
    await expect(card).not.toContainText("Unlock for 1 credit");
  });

  test("checkout dismissal does not change the wallet balance", async ({ page, request }) => {
    const runId = Date.now().toString(36);
    const owner = await loginWithOtp(request, "+919999999901");
    const admin = await loginWithOtp(request, "+919999999903");

    const target = await ensureLockedLeadWithZeroBalance(
      request,
      owner.access_token,
      admin.access_token,
      runId,
      "dismiss"
    );
    const balanceBefore = await getOwnerWalletBalance(request, owner.access_token);
    expect(balanceBefore).toBe(0);

    await installMockRazorpay(page);
    await signInAsOwner(page, owner);

    const card = page.locator("article", { hasText: target.title });
    await card.locator("button", { hasText: "Unlock for 1 credit" }).click();
    await card.getByTestId("lead-credits-buy-button").click();

    const dialog = page.getByTestId("credit-purchase-dialog");
    await dialog.getByTestId("cp-pay-razorpay").click();
    await page.waitForFunction(() =>
      Boolean(
        (window as unknown as { __criblivRazorpayOptions?: unknown }).__criblivRazorpayOptions
      )
    );

    // Simulate the user closing the Checkout modal instead of paying.
    await page.evaluate(() => {
      (
        window as unknown as {
          __criblivRazorpayOptions: { modal?: { ondismiss?: () => void } };
        }
      ).__criblivRazorpayOptions.modal?.ondismiss?.();
    });

    await expect(dialog.getByTestId("cp-status")).toHaveText(/cancel|try again/i);

    const balanceAfter = await getOwnerWalletBalance(request, owner.access_token);
    expect(balanceAfter).toBe(balanceBefore);
    // The dismissed attempt must not have unlocked the lead either.
    const leads = await fetchOwnerLeads(request, owner.access_token);
    const lead = leads.find((l) => l.listing_id === target.listingId)!;
    expect(lead.access_state).toBe("locked");
  });

  test("UPI fallback produces a upi:// deep link when Razorpay checkout is unavailable", async ({
    page,
    request
  }) => {
    const owner = await loginWithOtp(request, "+919999999901");

    // Do NOT install the mocked Razorpay global — instead block the real SDK
    // request so loadRazorpayScript() fails fast and deterministically
    // without depending on outbound network access to checkout.razorpay.com.
    await page.route("**/checkout.razorpay.com/**", (route) => route.abort());
    await signInAsOwner(page, owner);

    // The persistent balance bar's own purchase dialog is enough to exercise
    // the fallback — no locked lead required for this scenario.
    await page.getByTestId("lead-credit-buy-button").click();
    const dialog = page.getByTestId("credit-purchase-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("cp-pay-razorpay").click();

    const upiButton = dialog.getByTestId("cp-pay-upi");
    await expect(upiButton).toBeVisible({ timeout: 15_000 });
    await upiButton.click();

    const deepLink = dialog.getByTestId("cp-upi-deep-link");
    await expect(deepLink).toBeVisible();
    const href = await deepLink.getAttribute("href");
    expect(href).toMatch(/^upi:\/\//);
  });
});

test.describe("lead credit purchase (flag off guard)", () => {
  test.skip(FLAG_ON, "guard only applies to flag-off runs");

  test("flag off: no purchase polish on the owner leads board, legacy behavior preserved", async ({
    page,
    request
  }) => {
    const owner = await loginWithOtp(request, "+919999999901");
    await signInAsOwner(page, owner);

    await expect(page.getByTestId("lead-credit-balance-bar")).toHaveCount(0);
    await expect(page.getByTestId("lead-monetization")).toHaveCount(0);
  });
});
