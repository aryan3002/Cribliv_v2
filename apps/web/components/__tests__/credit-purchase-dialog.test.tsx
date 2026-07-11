import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CreditPurchaseDialog } from "../credit-purchase-dialog";

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
    // Real Checkout.js paints an iframe; the test drives success/dismiss by
    // invoking the captured handler/ondismiss directly.
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

function jsonOk(data: unknown) {
  return Promise.resolve({ ok: true, json: async () => ({ data }) });
}

/** Routes a stubbed `fetch` by method + URL substring, in registration order. */
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
  vi.useRealTimers();
  delete (window as unknown as { Razorpay?: unknown }).Razorpay;
  document.getElementById("razorpay-sdk")?.remove();
});

describe("CreditPurchaseDialog", () => {
  it("renders both owner lead packs and marks leads_15 as best value", async () => {
    vi.stubGlobal("fetch", routeFetch([plansRoute(OWNER_PLANS), walletRoute(3)]));

    render(
      <CreditPurchaseDialog
        open
        accessToken="tok"
        locale="en"
        audience="owner"
        onClose={vi.fn()}
        onCaptured={vi.fn()}
      />
    );

    await screen.findByTestId("cp-plan-leads_5");
    expect(screen.getByTestId("cp-plan-leads_15")).toBeInTheDocument();
    expect(screen.getByTestId("cp-best-value-leads_15")).toBeInTheDocument();
    expect(screen.queryByTestId("cp-best-value-leads_5")).not.toBeInTheDocument();
    expect(screen.getByTestId("cp-wallet-balance")).toHaveTextContent("3");
  });

  it("clicking Pay creates a Razorpay intent, loads Checkout, and passes the server-returned key/order/amount", async () => {
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(TENANT_PLANS),
        walletRoute(1),
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: () =>
            jsonOk({
              order_id: "order_1",
              amount_paise: 19900,
              credits_to_grant: 20,
              provider_payload: {
                provider: "razorpay",
                order_id: "order_1",
                amount_paise: 19900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            })
        }
      ])
    );

    render(
      <CreditPurchaseDialog
        open
        accessToken="tok"
        locale="en"
        audience="tenant"
        onClose={vi.fn()}
        onCaptured={vi.fn()}
      />
    );

    await screen.findByTestId("cp-plan-growth_20");
    fireEvent.click(screen.getByTestId("cp-plan-growth_20"));
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));

    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));
    expect(FakeRazorpay.instances[0].options).toMatchObject({
      key: "rzp_test_xyz",
      amount: 19900,
      currency: "INR",
      order_id: "order_1"
    });

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const intentCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes("/wallet/purchase-intents") && init?.method === "POST"
    );
    expect(intentCall).toBeTruthy();
    const [, intentInit] = intentCall!;
    expect(JSON.parse(intentInit.body)).toEqual({ plan_id: "growth_20", provider: "razorpay" });
    expect(new Headers(intentInit.headers).get("Idempotency-Key")).toEqual(expect.any(String));
  });

  it("calls onCaptured (and fires lead_pack_purchased for owner audience) once confirm + poll settle on captured", async () => {
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
    let statusCalls = 0;

    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(OWNER_PLANS),
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: () =>
            jsonOk({
              order_id: "order_9",
              amount_paise: 69900,
              credits_to_grant: 15,
              provider_payload: {
                provider: "razorpay",
                order_id: "order_9",
                amount_paise: 69900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            })
        },
        {
          match: (url, init) => url.includes("/confirm") && init?.method === "POST",
          respond: () => jsonOk({ order_id: "order_9", status: "authorized", credits_to_grant: 15 })
        },
        {
          match: (url, init) =>
            url.includes("/wallet/purchase-intents/order_9") &&
            !url.includes("/confirm") &&
            (!init?.method || init.method === "GET"),
          respond: () => {
            statusCalls += 1;
            return jsonOk({
              order_id: "order_9",
              status: "captured",
              plan_id: "leads_15",
              amount_paise: 69900,
              credits_to_grant: 15,
              provider: "razorpay"
            });
          }
        },
        {
          match: (url, init) =>
            url.includes("/wallet") &&
            !url.includes("/plans") &&
            !url.includes("/purchase-intents") &&
            (!init?.method || init.method === "GET"),
          respond: () => jsonOk({ balance_credits: 15, free_credits_granted: 2 })
        }
      ])
    );

    const onCaptured = vi.fn();
    const analyticsSpy = vi.fn();
    window.addEventListener("cribliv:analytics", analyticsSpy as EventListener);

    render(
      <CreditPurchaseDialog
        open
        accessToken="tok"
        locale="en"
        audience="owner"
        onClose={vi.fn()}
        onCaptured={onCaptured}
      />
    );

    await screen.findByTestId("cp-plan-leads_15");
    fireEvent.click(screen.getByTestId("cp-plan-leads_15"));
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    await act(async () => {
      FakeRazorpay.instances[0].options.handler({
        razorpay_payment_id: "pay_9",
        razorpay_order_id: "order_9",
        razorpay_signature: "sig_9"
      });
    });

    await waitFor(() =>
      expect(onCaptured).toHaveBeenCalledWith({
        planId: "leads_15",
        credits: 15,
        balanceCredits: 15
      })
    );
    expect(statusCalls).toBe(1);
    expect(screen.getByTestId("cp-status")).toHaveTextContent(/successful/i);

    const events = analyticsSpy.mock.calls.map((c) => (c[0] as CustomEvent).detail);
    expect(events.some((e) => e.event === "lead_pack_purchased")).toBe(true);

    window.removeEventListener("cribliv:analytics", analyticsSpy as EventListener);
  });

  it("keeps a Checkout.js dismissal as non-success and permits an immediate retry with a fresh idempotency key", async () => {
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
    const intentInits: RequestInit[] = [];

    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(TENANT_PLANS),
        walletRoute(1),
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: (init) => {
            intentInits.push(init!);
            return jsonOk({
              order_id: `order_${intentInits.length}`,
              amount_paise: 9900,
              credits_to_grant: 10,
              provider_payload: {
                provider: "razorpay",
                order_id: `order_${intentInits.length}`,
                amount_paise: 9900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            });
          }
        }
      ])
    );

    const onCaptured = vi.fn();
    render(
      <CreditPurchaseDialog
        open
        accessToken="tok"
        locale="en"
        audience="tenant"
        onClose={vi.fn()}
        onCaptured={onCaptured}
      />
    );

    await screen.findByTestId("cp-plan-starter_10");
    fireEvent.click(screen.getByTestId("cp-plan-starter_10"));
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    await act(async () => {
      FakeRazorpay.instances[0].options.modal?.ondismiss?.();
    });

    expect(onCaptured).not.toHaveBeenCalled();
    expect(screen.getByTestId("cp-status")).toHaveTextContent(/cancelled/i);
    expect(screen.getByTestId("cp-pay-razorpay")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(2));

    expect(intentInits).toHaveLength(2);
    const firstKey = new Headers(intentInits[0].headers).get("Idempotency-Key");
    const secondKey = new Headers(intentInits[1].headers).get("Idempotency-Key");
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });

  it("exposes the UPI fallback once the Razorpay script fails to load", async () => {
    delete (window as unknown as { Razorpay?: unknown }).Razorpay;

    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(TENANT_PLANS),
        walletRoute(1),
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: () =>
            jsonOk({
              order_id: "order_5",
              amount_paise: 9900,
              credits_to_grant: 10,
              provider_payload: {
                provider: "razorpay",
                order_id: "order_5",
                amount_paise: 9900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            })
        }
      ])
    );

    render(
      <CreditPurchaseDialog
        open
        accessToken="tok"
        locale="en"
        audience="tenant"
        onClose={vi.fn()}
        onCaptured={vi.fn()}
      />
    );

    await screen.findByTestId("cp-plan-starter_10");
    expect(screen.queryByTestId("cp-pay-upi")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));

    const scriptEl = await waitFor(() => {
      const el = document.getElementById("razorpay-sdk");
      if (!el) throw new Error("script not appended yet");
      return el;
    });

    await act(async () => {
      fireEvent.error(scriptEl);
    });

    expect(await screen.findByTestId("cp-pay-upi")).toBeInTheDocument();
  });

  it("UPI fallback creates a fresh provider:upi intent and renders its deep link", async () => {
    delete (window as unknown as { Razorpay?: unknown }).Razorpay;
    const intentInits: Array<{ init: RequestInit; body: unknown }> = [];

    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(TENANT_PLANS),
        walletRoute(1),
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: (init) => {
            const body = JSON.parse(init!.body as string);
            intentInits.push({ init: init!, body });
            if (body.provider === "upi") {
              return jsonOk({
                order_id: "order_upi_1",
                amount_paise: 9900,
                credits_to_grant: 10,
                provider_payload: {
                  provider: "upi",
                  order_id: "order_upi_1",
                  amount_paise: 9900,
                  currency: "INR",
                  deep_link: "upi://pay?tr=order_upi_1&am=99.00&cu=INR&tn=Cribliv Credits"
                }
              });
            }
            return jsonOk({
              order_id: "order_rzp_1",
              amount_paise: 9900,
              credits_to_grant: 10,
              provider_payload: {
                provider: "razorpay",
                order_id: "order_rzp_1",
                amount_paise: 9900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            });
          }
        }
      ])
    );

    render(
      <CreditPurchaseDialog
        open
        accessToken="tok"
        locale="en"
        audience="tenant"
        onClose={vi.fn()}
        onCaptured={vi.fn()}
      />
    );

    await screen.findByTestId("cp-plan-starter_10");
    fireEvent.click(screen.getByTestId("cp-plan-starter_10"));
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));

    const scriptEl = await waitFor(() => {
      const el = document.getElementById("razorpay-sdk");
      if (!el) throw new Error("script not appended yet");
      return el;
    });
    await act(async () => {
      fireEvent.error(scriptEl);
    });
    const upiButton = await screen.findByTestId("cp-pay-upi");

    fireEvent.click(upiButton);

    const deepLink = await screen.findByTestId("cp-upi-deep-link");
    expect(deepLink).toHaveAttribute(
      "href",
      "upi://pay?tr=order_upi_1&am=99.00&cu=INR&tn=Cribliv Credits"
    );

    expect(intentInits).toHaveLength(2);
    expect(intentInits[0].body).toEqual({ plan_id: "starter_10", provider: "razorpay" });
    expect(intentInits[1].body).toEqual({ plan_id: "starter_10", provider: "upi" });
    const razorpayKey = new Headers(intentInits[0].init.headers).get("Idempotency-Key");
    const upiKey = new Headers(intentInits[1].init.headers).get("Idempotency-Key");
    expect(upiKey).not.toBe(razorpayKey);
  });

  it("never calls onCaptured when the order status comes back failed", async () => {
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;

    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(TENANT_PLANS),
        walletRoute(1),
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: () =>
            jsonOk({
              order_id: "order_fail",
              amount_paise: 9900,
              credits_to_grant: 10,
              provider_payload: {
                provider: "razorpay",
                order_id: "order_fail",
                amount_paise: 9900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            })
        },
        {
          match: (url, init) => url.includes("/confirm") && init?.method === "POST",
          respond: () =>
            jsonOk({ order_id: "order_fail", status: "authorized", credits_to_grant: 10 })
        },
        {
          match: (url, init) =>
            url.includes("/wallet/purchase-intents/order_fail") &&
            !url.includes("/confirm") &&
            (!init?.method || init.method === "GET"),
          respond: () =>
            jsonOk({
              order_id: "order_fail",
              status: "failed",
              plan_id: "starter_10",
              amount_paise: 9900,
              credits_to_grant: 10,
              provider: "razorpay"
            })
        }
      ])
    );

    const onCaptured = vi.fn();
    render(
      <CreditPurchaseDialog
        open
        accessToken="tok"
        locale="en"
        audience="tenant"
        onClose={vi.fn()}
        onCaptured={onCaptured}
      />
    );

    await screen.findByTestId("cp-plan-starter_10");
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    await act(async () => {
      FakeRazorpay.instances[0].options.handler({
        razorpay_payment_id: "pay_fail",
        razorpay_order_id: "order_fail",
        razorpay_signature: "sig_fail"
      });
    });

    await waitFor(() => expect(screen.getByTestId("cp-status")).toHaveTextContent(/failed/i));
    expect(onCaptured).not.toHaveBeenCalled();
    expect(screen.getByTestId("cp-pay-razorpay")).not.toBeDisabled();
  });

  it("never calls onCaptured when polling exhausts its attempts (timeout)", async () => {
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
    let statusCalls = 0;

    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(TENANT_PLANS),
        walletRoute(1),
        {
          match: (url, init) => url.includes("/wallet/purchase-intents") && init?.method === "POST",
          respond: () =>
            jsonOk({
              order_id: "order_timeout",
              amount_paise: 9900,
              credits_to_grant: 10,
              provider_payload: {
                provider: "razorpay",
                order_id: "order_timeout",
                amount_paise: 9900,
                currency: "INR",
                key_id: "rzp_test_xyz"
              }
            })
        },
        {
          match: (url, init) => url.includes("/confirm") && init?.method === "POST",
          respond: () =>
            jsonOk({ order_id: "order_timeout", status: "authorized", credits_to_grant: 10 })
        },
        {
          match: (url, init) =>
            url.includes("/wallet/purchase-intents/order_timeout") &&
            !url.includes("/confirm") &&
            (!init?.method || init.method === "GET"),
          respond: () => {
            statusCalls += 1;
            return jsonOk({
              order_id: "order_timeout",
              status: "authorized",
              plan_id: "starter_10",
              amount_paise: 9900,
              credits_to_grant: 10,
              provider: "razorpay"
            });
          }
        }
      ])
    );

    const onCaptured = vi.fn();
    render(
      <CreditPurchaseDialog
        open
        accessToken="tok"
        locale="en"
        audience="tenant"
        onClose={vi.fn()}
        onCaptured={onCaptured}
      />
    );

    await screen.findByTestId("cp-plan-starter_10");
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    // Only fake timers now — the interactions above resolve through real
    // microtasks/RTL polling, and pollCreditPurchaseStatus's 14 inter-attempt
    // delays are the only thing that needs a clock we can fast-forward.
    vi.useFakeTimers();
    try {
      await act(async () => {
        FakeRazorpay.instances[0].options.handler({
          razorpay_payment_id: "pay_timeout",
          razorpay_order_id: "order_timeout",
          razorpay_signature: "sig_timeout"
        });
        await vi.runAllTimersAsync();
      });
    } finally {
      vi.useRealTimers();
    }

    expect(statusCalls).toBe(15);
    expect(onCaptured).not.toHaveBeenCalled();
    expect(screen.getByTestId("cp-status")).toHaveTextContent(/waiting for confirmation/i);
  });
});
