import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeadCreditsPanel } from "../lead-credits-panel";

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
    respond: () => jsonOk({ balance_credits: balance, free_credits_granted: 2 })
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

describe("LeadCreditsPanel", () => {
  it("does not hardcode a UPI-only leads_5 purchase-intent request on mount", () => {
    const fetchMock = routeFetch([plansRoute(OWNER_PLANS), walletRoute(0)]);
    vi.stubGlobal("fetch", fetchMock);

    render(<LeadCreditsPanel accessToken="tok" locale="en" onPurchased={vi.fn()} />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("credit-purchase-dialog")).not.toBeInTheDocument();
  });

  it("opens the shared owner dialog with the real catalog instead of a hardcoded leads_5/UPI request", async () => {
    vi.stubGlobal("fetch", routeFetch([plansRoute(OWNER_PLANS), walletRoute(0)]));

    render(<LeadCreditsPanel accessToken="tok" locale="en" onPurchased={vi.fn()} />);
    fireEvent.click(screen.getByTestId("lead-credits-buy-button"));

    expect(await screen.findByTestId("credit-purchase-dialog")).toBeInTheDocument();
    expect(await screen.findByTestId("cp-plan-leads_5")).toBeInTheDocument();
    expect(screen.getByTestId("cp-plan-leads_15")).toBeInTheDocument();
    expect(screen.queryByTestId("cp-pay-upi")).not.toBeInTheDocument();
  });

  it("invokes onPurchased exactly once when the owner completes a captured purchase", async () => {
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;

    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(OWNER_PLANS),
        walletRoute(0),
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: () =>
            jsonOk({
              order_id: "order_lcp_1",
              amount_paise: 29900,
              credits_to_grant: 5,
              provider_payload: {
                provider: "razorpay",
                order_id: "order_lcp_1",
                amount_paise: 29900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            })
        },
        {
          match: (url, init) => url.includes("/confirm") && init?.method === "POST",
          respond: () =>
            jsonOk({ order_id: "order_lcp_1", status: "authorized", credits_to_grant: 5 })
        },
        {
          match: (url, init) =>
            url.includes("/wallet/purchase-intents/order_lcp_1") &&
            !url.includes("/confirm") &&
            (!init?.method || init.method === "GET"),
          respond: () =>
            jsonOk({
              order_id: "order_lcp_1",
              status: "captured",
              plan_id: "leads_5",
              amount_paise: 29900,
              credits_to_grant: 5,
              provider: "razorpay"
            })
        }
      ])
    );

    const onPurchased = vi.fn();
    render(<LeadCreditsPanel accessToken="tok" locale="en" onPurchased={onPurchased} />);
    fireEvent.click(screen.getByTestId("lead-credits-buy-button"));
    await screen.findByTestId("cp-plan-leads_5");
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    await act(async () => {
      FakeRazorpay.instances[0].options.handler({
        razorpay_payment_id: "pay_lcp_1",
        razorpay_order_id: "order_lcp_1",
        razorpay_signature: "sig_lcp_1"
      });
    });

    await waitFor(() => expect(onPurchased).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("credit-purchase-dialog")).not.toBeInTheDocument();
  });

  it("renders all visible copy via t(locale, key) in Hindi", () => {
    vi.stubGlobal("fetch", routeFetch([plansRoute(OWNER_PLANS), walletRoute(0)]));

    render(<LeadCreditsPanel accessToken="tok" locale="hi" onPurchased={vi.fn()} />);

    expect(screen.getByTestId("lead-credits-panel")).toHaveTextContent("लीड क्रेडिट कम हैं");
    expect(screen.getByTestId("lead-credits-buy-button")).toHaveTextContent("क्रेडिट खरीदें");
  });
});
