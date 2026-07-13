import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeadMonetizationControls } from "../lead-monetization-controls";
import type { LeadVm } from "../../../lib/owner-api";

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

const { flagState } = vi.hoisted(() => ({
  flagState: { ff_callback_leads: true } as Record<string, boolean>
}));

vi.mock("../../../lib/feature-flags", () => ({
  useFlag: (flag: string) => Boolean(flagState[flag])
}));

function baseLead(overrides: Partial<LeadVm> = {}): LeadVm {
  return {
    id: "lead-1",
    listingId: "listing-1",
    listingTitle: "Cosy 2BHK",
    tenantName: "Asha",
    tenantPhoneMasked: "+9198XXXXX34",
    status: "new",
    statusChangedAt: "2026-07-01T00:00:00.000Z",
    ownerNotes: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    accessState: "locked",
    callDeadlineAt: "2026-07-02T00:00:00.000Z",
    calledAt: null,
    tenantPhone: null,
    ...overrides
  };
}

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
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Razorpay?: unknown }).Razorpay;
});

describe("LeadMonetizationControls", () => {
  it("renders nothing when ff_callback_leads is off", () => {
    flagState.ff_callback_leads = false;
    vi.stubGlobal("fetch", routeFetch([]));
    render(<LeadMonetizationControls lead={baseLead()} accessToken="tok" locale="en" />);
    expect(screen.queryByTestId("lead-monetization")).not.toBeInTheDocument();
  });

  it("locked: shows blurred masked contact and an Unlock for 1 credit button", () => {
    vi.stubGlobal("fetch", routeFetch([]));
    render(
      <LeadMonetizationControls
        lead={baseLead({ accessState: "locked" })}
        accessToken="tok"
        locale="en"
      />
    );
    expect(screen.getByText(/Asha/)).toBeInTheDocument();
    expect(screen.getByText(/\+9198XXXXX34/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unlock for 1 credit/i })).toBeInTheDocument();
    // No phone-call affordance while locked.
    expect(screen.queryByRole("button", { name: /call now/i })).not.toBeInTheDocument();
  });

  it("unlocking a locked lead reveals the phone, flips to unlocked, and patches the parent lead", async () => {
    const onLeadPatch = vi.fn();
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: (url, init) =>
            url.includes("/owner/leads/lead-1/unlock") && init?.method === "POST",
          respond: () =>
            jsonOk({
              lead_id: "lead-1",
              access_state: "unlocked",
              tenant_phone: "+919812345678",
              tenant_name: "Asha",
              credits_remaining: 4
            })
        }
      ])
    );
    render(
      <LeadMonetizationControls
        lead={baseLead({ accessState: "locked" })}
        accessToken="tok"
        locale="en"
        onLeadPatch={onLeadPatch}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unlock for 1 credit/i }));
    await screen.findByText("+919812345678");
    expect(screen.getByRole("button", { name: /call now/i })).toBeInTheDocument();
    expect(onLeadPatch).toHaveBeenCalledWith({
      accessState: "unlocked",
      tenantPhone: "+919812345678"
    });
  });

  it("free/unlocked: shows the phone and a Call now button; call-click patches the parent lead", async () => {
    const onLeadPatch = vi.fn();
    vi.stubGlobal(
      "fetch",
      routeFetch([
        {
          match: (url, init) =>
            url.includes("/owner/leads/lead-1/call-click") && init?.method === "POST",
          respond: () =>
            jsonOk({
              lead_id: "lead-1",
              called_at: "2026-07-01T01:00:00.000Z",
              tel: "tel:+919812345678"
            })
        }
      ])
    );
    // jsdom doesn't implement navigation; guard the assignment.
    const originalHref = window.location.href;
    try {
      render(
        <LeadMonetizationControls
          lead={baseLead({
            accessState: "free",
            tenantPhone: "+919812345678",
            callDeadlineAt: null
          })}
          accessToken="tok"
          locale="en"
          onLeadPatch={onLeadPatch}
        />
      );
      expect(screen.getByText(/Free Lead/i)).toBeInTheDocument();
      expect(screen.getByText("+919812345678")).toBeInTheDocument();
      const callBtn = screen.getByRole("button", { name: /call now/i });
      fireEvent.click(callBtn);
      await waitFor(() =>
        expect(onLeadPatch).toHaveBeenCalledWith({ calledAt: "2026-07-01T01:00:00.000Z" })
      );
    } finally {
      window.location.href = originalHref;
    }
  });

  it("expired: shows the expiry message and never renders an unlock button or purchase dialog", () => {
    vi.stubGlobal("fetch", routeFetch([]));
    render(
      <LeadMonetizationControls
        lead={baseLead({ accessState: "expired", callDeadlineAt: "2026-06-01T00:00:00.000Z" })}
        accessToken="tok"
        locale="en"
      />
    );
    expect(screen.getByText(/expired/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /unlock for 1 credit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /call now/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("credit-purchase-dialog")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lead-credits-panel")).not.toBeInTheDocument();
  });

  it("insufficient credits on unlock opens the buy-credits panel; completing the purchase auto-retries the unlock without a second click", async () => {
    (window as unknown as { Razorpay: unknown }).Razorpay = FakeRazorpay;
    const onLeadPatch = vi.fn();
    const unlockCalls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      routeFetch([
        plansRoute(OWNER_PLANS),
        walletRoute(0),
        {
          match: (url, init) =>
            url.includes("/owner/leads/lead-1/unlock") && init?.method === "POST",
          respond: (init) => {
            unlockCalls.push(init!);
            if (unlockCalls.length === 1) {
              return jsonErr(402, "insufficient_credits", "Not enough credits");
            }
            return jsonOk({
              lead_id: "lead-1",
              access_state: "unlocked",
              tenant_phone: "+919812345678",
              tenant_name: "Asha",
              credits_remaining: 4
            });
          }
        },
        purchaseIntentRoute("order_lead_1", 29900, 5),
        confirmRoute("order_lead_1", 5),
        statusRoute("order_lead_1", "leads_5", 29900, 5)
      ])
    );

    render(
      <LeadMonetizationControls
        lead={baseLead({ accessState: "locked" })}
        accessToken="tok"
        locale="en"
        onLeadPatch={onLeadPatch}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /unlock for 1 credit/i }));

    await screen.findByTestId("lead-credits-panel");
    fireEvent.click(screen.getByTestId("lead-credits-buy-button"));

    await screen.findByTestId("cp-plan-leads_5");
    fireEvent.click(screen.getByTestId("cp-pay-razorpay"));
    await waitFor(() => expect(FakeRazorpay.instances).toHaveLength(1));

    await act(async () => {
      FakeRazorpay.instances[0].options.handler({
        razorpay_payment_id: "pay_lead_1",
        razorpay_order_id: "order_lead_1",
        razorpay_signature: "sig_lead_1"
      });
    });

    // Auto-retry: the unlock endpoint was hit twice, but the user only ever
    // clicked "Unlock" once.
    await waitFor(() => expect(unlockCalls).toHaveLength(2));
    await screen.findByText("+919812345678");
    expect(onLeadPatch).toHaveBeenCalledWith({
      accessState: "unlocked",
      tenantPhone: "+919812345678"
    });
  });
});
