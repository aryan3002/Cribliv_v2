import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UnlockContactPanel } from "../unlock-contact-panel";
import { t } from "../../lib/i18n";

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  order_id?: string;
  handler: (response: {
    razorpay_payment_id: string;
    razorpay_order_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
}

class FakeRazorpay {
  static instances: FakeRazorpay[] = [];
  options: RazorpayOptions;
  constructor(options: RazorpayOptions) {
    this.options = options;
    FakeRazorpay.instances.push(this);
  }
  open() {
    /* handled by tests invoking options.handler directly */
  }
}

const TENANT_PLANS = [
  {
    plan_id: "starter_10",
    audience: "tenant",
    amount_paise: 9900,
    credits: 10,
    label: "10 callback credits",
    unit_price_paise: 990,
    recommended: false
  },
  {
    plan_id: "growth_20",
    audience: "tenant",
    amount_paise: 19900,
    credits: 20,
    label: "20 callback credits",
    unit_price_paise: 995,
    recommended: true
  }
];

const { flagState } = vi.hoisted(() => ({
  flagState: { ff_callback_leads: true } as Record<string, boolean>
}));

vi.mock("../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { accessToken: "session-tok", user: { name: "Tenant" } },
    status: "authenticated"
  })
}));

const requireName = vi.fn();
vi.mock("../name-capture/name-prompt-provider", () => ({
  useNamePrompt: () => ({ requireName })
}));

function jsonOk(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => ({ data }) });
}

function jsonErr(status: number, code: string, message: string) {
  return Promise.resolve({ ok: false, status, json: async () => ({ error: { code, message } }) });
}

function routeFetch(
  routes: Array<{
    match: (url: string, init?: RequestInit) => boolean;
    respond: (init?: RequestInit) => Promise<unknown>;
  }>
) {
  return vi.fn((url: string, init?: RequestInit) => {
    const route = routes.find((r) => r.match(String(url), init));
    if (!route) {
      throw new Error(`Unmocked fetch call: ${init?.method ?? "GET"} ${url}`);
    }
    return route.respond(init);
  });
}

function shortlistRoute() {
  return {
    match: (url: string, init?: RequestInit) =>
      url.includes("/shortlist") && (!init?.method || init.method === "GET"),
    respond: () => jsonOk({ items: [], total: 0 })
  };
}

function walletTxnsRoute() {
  return {
    match: (url: string) => url.includes("/wallet/transactions"),
    respond: () => jsonOk({ items: [], total: 0 })
  };
}

function walletRoute(balance: number) {
  return {
    match: (url: string, init?: RequestInit) =>
      url.includes("/wallet") &&
      !url.includes("/wallet/plans") &&
      !url.includes("/wallet/purchase-intents") &&
      !url.includes("/wallet/transactions") &&
      (!init?.method || init.method === "GET"),
    respond: () =>
      jsonOk({
        balance_credits: balance,
        free_credits_granted: 10,
        promotional_credits_remaining: 0,
        promotional_credits_expires_at: null
      })
  };
}

function plansRoute(items: unknown[]) {
  return {
    match: (url: string) => url.includes("/wallet/plans"),
    respond: () => jsonOk({ items })
  };
}

function purchaseIntentRoute(orderId: string, amountPaise: number, credits: number) {
  return {
    match: (url: string, init?: RequestInit) =>
      url.includes("/wallet/purchase-intents") && init?.method === "POST",
    respond: () =>
      jsonOk({
        order_id: orderId,
        amount_paise: amountPaise,
        credits_to_grant: credits,
        provider_payload: {
          provider: "razorpay",
          order_id: orderId,
          amount_paise: amountPaise,
          currency: "INR",
          key_id: "rzp_test_xyz"
        }
      })
  };
}

function confirmRoute(orderId: string, credits: number) {
  return {
    match: (url: string, init?: RequestInit) =>
      url.includes(`/wallet/purchase-intents/${orderId}/confirm`) && init?.method === "POST",
    respond: () => jsonOk({ order_id: orderId, status: "authorized", credits_to_grant: credits })
  };
}

function statusRoute(orderId: string, planId: string, amountPaise: number, credits: number) {
  return {
    match: (url: string, init?: RequestInit) =>
      url.includes(`/wallet/purchase-intents/${orderId}`) &&
      !url.includes("/confirm") &&
      (!init?.method || init.method === "GET"),
    respond: () =>
      jsonOk({
        order_id: orderId,
        status: "captured",
        plan_id: planId,
        amount_paise: amountPaise,
        credits_to_grant: credits,
        provider: "razorpay"
      })
  };
}

beforeEach(() => {
  FakeRazorpay.instances = [];
  flagState.ff_callback_leads = true;
  requireName.mockReset();
  requireName.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Razorpay?: unknown }).Razorpay;
  document.getElementById("razorpay-sdk")?.remove();
});

describe("UnlockContactPanel purchase integration", () => {
  it("opens tenant plans on insufficient credits and retries the callback request exactly once, reusing the original idempotency key", async () => {
    flagState.ff_callback_leads = true;
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
    const contactCalls: RequestInit[] = [];

    vi.stubGlobal(
      "fetch",
      routeFetch([
        shortlistRoute(),
        plansRoute(TENANT_PLANS),
        walletTxnsRoute(),
        walletRoute(0),
        {
          match: (url, init) => url.includes("/tenant/contact-unlocks") && init?.method === "POST",
          respond: (init) => {
            contactCalls.push(init!);
            if (contactCalls.length === 1) {
              return jsonErr(402, "insufficient_credits", "Not enough credits");
            }
            return jsonOk({
              unlock_id: "unlock_cb_1",
              callback: { status: "awaiting_call", call_deadline_at: "2026-07-12T00:00:00.000Z" },
              credits_remaining: 9,
              response_deadline_at: "2026-07-12T00:00:00.000Z"
            });
          }
        },
        purchaseIntentRoute("order_cb_1", 9900, 10),
        confirmRoute("order_cb_1", 10),
        statusRoute("order_cb_1", "starter_10", 9900, 10)
      ])
    );

    render(<UnlockContactPanel listingId="listing_cb_1" locale="en" />);

    const requestBtn = await screen.findByRole("button", { name: /request callback/i });
    fireEvent.click(requestBtn);

    await screen.findByTestId("buy-credits-panel");
    fireEvent.click(screen.getByTestId("tenant-buy-credits-button"));

    await screen.findByTestId("cp-plan-starter_10");
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    await act(async () => {
      FakeRazorpay.instances[0].options.handler({
        razorpay_payment_id: "pay_cb_1",
        razorpay_order_id: "order_cb_1",
        razorpay_signature: "sig_cb_1"
      });
    });

    await screen.findByTestId("callback-requested");
    expect(contactCalls).toHaveLength(2);
    const firstKey = new Headers(contactCalls[0].headers).get("Idempotency-Key");
    const secondKey = new Headers(contactCalls[1].headers).get("Idempotency-Key");
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });

  it("preserves the legacy tenant unlock/reveal behavior when ff_callback_leads is off, while still delegating purchase to the shared dialog", async () => {
    flagState.ff_callback_leads = false;
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
    const contactCalls: RequestInit[] = [];

    vi.stubGlobal(
      "fetch",
      routeFetch([
        shortlistRoute(),
        plansRoute(TENANT_PLANS),
        walletTxnsRoute(),
        walletRoute(0),
        {
          match: (url, init) => url.includes("/tenant/contact-unlocks") && init?.method === "POST",
          respond: (init) => {
            contactCalls.push(init!);
            if (contactCalls.length === 1) {
              return jsonErr(402, "insufficient_credits", "Not enough credits");
            }
            return jsonOk({
              unlock_id: "unlock_legacy_1",
              owner_contact: { phone_e164: "+919812345678", whatsapp_available: true },
              credits_remaining: 9,
              response_deadline_at: "2026-07-12T00:00:00.000Z"
            });
          }
        },
        purchaseIntentRoute("order_legacy_1", 9900, 10),
        confirmRoute("order_legacy_1", 10),
        statusRoute("order_legacy_1", "starter_10", 9900, 10)
      ])
    );

    render(<UnlockContactPanel listingId="listing_legacy_1" locale="en" />);

    // Flag off: legacy copy and button label, no callback guarantee framing.
    expect(
      await screen.findByText(
        /Unlock contact for 1 credit\. Auto-refund if no response in 12 hours\./
      )
    ).toBeInTheDocument();
    const unlockBtn = screen.getByRole("button", { name: /unlock number/i });
    fireEvent.click(unlockBtn);

    await screen.findByTestId("buy-credits-panel");
    fireEvent.click(screen.getByTestId("tenant-buy-credits-button"));
    await screen.findByTestId("cp-plan-starter_10");
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    await act(async () => {
      FakeRazorpay.instances[0].options.handler({
        razorpay_payment_id: "pay_legacy_1",
        razorpay_order_id: "order_legacy_1",
        razorpay_signature: "sig_legacy_1"
      });
    });

    await waitFor(() => expect(screen.getByText(/Owner Contact:/)).toBeInTheDocument());
    expect(screen.queryByTestId("callback-requested")).not.toBeInTheDocument();
    expect(contactCalls).toHaveLength(2);
    const firstKey = new Headers(contactCalls[0].headers).get("Idempotency-Key");
    const secondKey = new Headers(contactCalls[1].headers).get("Idempotency-Key");
    expect(secondKey).toBe(firstKey);
  });

  it("renders the insufficient-credit purchase copy via t(locale, key) in Hindi", async () => {
    flagState.ff_callback_leads = true;

    vi.stubGlobal(
      "fetch",
      routeFetch([
        shortlistRoute(),
        plansRoute(TENANT_PLANS),
        walletTxnsRoute(),
        walletRoute(0),
        {
          match: (url, init) => url.includes("/tenant/contact-unlocks") && init?.method === "POST",
          respond: () => jsonErr(402, "insufficient_credits", "Not enough credits")
        }
      ])
    );

    render(<UnlockContactPanel listingId="listing_hi_1" locale="hi" />);

    const requestBtn = await screen.findByRole("button", { name: t("hi", "cbRequestButton") });
    fireEvent.click(requestBtn);

    const panel = await screen.findByTestId("buy-credits-panel");
    expect(panel).toHaveTextContent(t("hi", "cbNoCredits"));
    expect(panel).toHaveTextContent(t("hi", "cbBuyCreditsSub"));
    expect(screen.getByTestId("tenant-buy-credits-button")).toHaveTextContent(t("hi", "cpTitle"));
    expect(screen.getByTestId("tenant-wallet-balance")).toHaveTextContent(
      t("hi", "cpWalletBalance")
    );
  });
});

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
            unlock_id: "unlock_cb_1",
            callback: { status: "awaiting_call", call_deadline_at: "2026-07-12T00:00:00.000Z" },
            credits_remaining: 9,
            response_deadline_at: "2026-07-12T00:00:00.000Z"
          })
      },
      walletTxnsRoute(),
      walletRoute(0)
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(<UnlockContactPanel listingId="listing-1" locale="en" />);
    fireEvent.click(screen.getByTestId("unlock-cta"));

    await waitFor(() => expect(unlockCalls(fetchMock)).toHaveLength(1));
  });
});
