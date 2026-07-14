import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeadCreditBalanceBar } from "../lead-credit-balance-bar";

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

const OWNER_PLANS = [
  {
    plan_id: "leads_5",
    audience: "owner",
    amount_paise: 29900,
    credits: 5,
    label: "5 lead credits",
    unit_price_paise: 5980,
    recommended: false
  },
  {
    plan_id: "leads_15",
    audience: "owner",
    amount_paise: 69900,
    credits: 15,
    label: "15 lead credits",
    unit_price_paise: 4660,
    recommended: true
  }
];

function jsonOk(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => ({ data }) });
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

function walletRoute(balance: number) {
  return {
    match: (url: string, init?: RequestInit) =>
      url.includes("/wallet") &&
      !url.includes("/wallet/plans") &&
      !url.includes("/wallet/purchase-intents") &&
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

beforeEach(() => {
  FakeRazorpay.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Razorpay?: unknown }).Razorpay;
  document.getElementById("razorpay-sdk")?.remove();
});

describe("LeadCreditBalanceBar", () => {
  it("shows wallet balance, locked-lead count, and both pack economics", async () => {
    vi.stubGlobal("fetch", routeFetch([plansRoute(OWNER_PLANS), walletRoute(4)]));

    render(
      <LeadCreditBalanceBar
        accessToken="tok"
        locale="en"
        lockedLeadCount={3}
        onCreditsChanged={vi.fn()}
      />
    );

    expect(await screen.findByTestId("lead-credit-balance-value")).toHaveTextContent("4");
    expect(screen.getByTestId("lead-credit-locked")).toHaveTextContent("3 locked leads waiting");
    expect(await screen.findByTestId("lead-credit-pack-leads_5")).toHaveTextContent("59.80");
    expect(screen.getByTestId("lead-credit-pack-leads_15")).toHaveTextContent("46.60");
  });

  it("hides the locked-lead callout when there are no locked leads", async () => {
    vi.stubGlobal("fetch", routeFetch([plansRoute(OWNER_PLANS), walletRoute(0)]));

    render(
      <LeadCreditBalanceBar
        accessToken="tok"
        locale="en"
        lockedLeadCount={0}
        onCreditsChanged={vi.fn()}
      />
    );

    await screen.findByTestId("lead-credit-balance-value");
    expect(screen.queryByTestId("lead-credit-locked")).not.toBeInTheDocument();
  });

  it("opens the shared owner credit purchase dialog when Buy Credits is clicked", async () => {
    vi.stubGlobal("fetch", routeFetch([plansRoute(OWNER_PLANS), walletRoute(2)]));

    render(
      <LeadCreditBalanceBar
        accessToken="tok"
        locale="en"
        lockedLeadCount={1}
        onCreditsChanged={vi.fn()}
      />
    );

    await screen.findByTestId("lead-credit-buy-button");
    fireEvent.click(screen.getByTestId("lead-credit-buy-button"));

    expect(await screen.findByTestId("credit-purchase-dialog")).toBeInTheDocument();
    expect(await screen.findByTestId("cp-plan-leads_5")).toBeInTheDocument();
    expect(screen.getByTestId("cp-plan-leads_15")).toBeInTheDocument();
  });

  it("refreshes the balance and calls onCreditsChanged once when a purchase is captured", async () => {
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
    let walletCalls = 0;

    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(OWNER_PLANS),
        {
          match: (url, init) =>
            url.includes("/wallet") &&
            !url.includes("/wallet/plans") &&
            !url.includes("/wallet/purchase-intents") &&
            (!init?.method || init.method === "GET"),
          respond: () => {
            walletCalls += 1;
            return jsonOk({
              balance_credits: walletCalls === 1 ? 2 : 17,
              free_credits_granted: 10,
              promotional_credits_remaining: 2,
              promotional_credits_expires_at: "2099-01-01T00:00:00.000Z"
            });
          }
        },
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: () =>
            jsonOk({
              order_id: "order_bar_1",
              amount_paise: 69900,
              credits_to_grant: 15,
              provider_payload: {
                provider: "razorpay",
                order_id: "order_bar_1",
                amount_paise: 69900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            })
        },
        {
          match: (url, init) => url.includes("/confirm") && init?.method === "POST",
          respond: () =>
            jsonOk({ order_id: "order_bar_1", status: "authorized", credits_to_grant: 15 })
        },
        {
          match: (url, init) =>
            url.includes("/wallet/purchase-intents/order_bar_1") &&
            !url.includes("/confirm") &&
            (!init?.method || init.method === "GET"),
          respond: () =>
            jsonOk({
              order_id: "order_bar_1",
              status: "captured",
              plan_id: "leads_15",
              amount_paise: 69900,
              credits_to_grant: 15,
              provider: "razorpay"
            })
        }
      ])
    );

    const onCreditsChanged = vi.fn();
    render(
      <LeadCreditBalanceBar
        accessToken="tok"
        locale="en"
        lockedLeadCount={2}
        onCreditsChanged={onCreditsChanged}
      />
    );

    await screen.findByTestId("lead-credit-buy-button");
    fireEvent.click(screen.getByTestId("lead-credit-buy-button"));
    await screen.findByTestId("cp-plan-leads_15");
    fireEvent.click(screen.getByTestId("cp-plan-leads_15"));
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    await act(async () => {
      FakeRazorpay.instances[0].options.handler({
        razorpay_payment_id: "pay_bar_1",
        razorpay_order_id: "order_bar_1",
        razorpay_signature: "sig_bar_1"
      });
    });

    await waitFor(() => expect(onCreditsChanged).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("lead-credit-balance-value")).toHaveTextContent("17")
    );
    expect(walletCalls).toBeGreaterThanOrEqual(3);
  });

  it("renders all visible copy via t(locale, key) in Hindi", async () => {
    vi.stubGlobal("fetch", routeFetch([plansRoute(OWNER_PLANS), walletRoute(1)]));

    render(
      <LeadCreditBalanceBar
        accessToken="tok"
        locale="hi"
        lockedLeadCount={2}
        onCreditsChanged={vi.fn()}
      />
    );

    await screen.findByTestId("lead-credit-balance-value");
    expect(screen.getByTestId("lead-credit-buy-button")).toHaveTextContent("क्रेडिट खरीदें");
    expect(screen.getByTestId("lead-credit-locked")).toHaveTextContent(/लॉक्ड/);
  });
});
