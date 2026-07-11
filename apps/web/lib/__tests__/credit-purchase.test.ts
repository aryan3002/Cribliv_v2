import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmRazorpayPurchase,
  createCreditPurchaseIntent,
  createIdempotencyKey,
  fetchCreditPlans,
  fetchCreditPurchaseStatus,
  pollCreditPurchaseStatus,
  type CreditPurchaseStatus
} from "../credit-purchase";

describe("credit-purchase client — response mapping", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches role-scoped credit plans and returns the raw catalog items", async () => {
    const items = [
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
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { items } })
    });

    const result = await fetchCreditPlans("tok");

    expect(result).toEqual(items);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/wallet/plans");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
  });

  it("creates a purchase intent with the idempotency key header and returns the provider payload as-is", async () => {
    const intent = {
      order_id: "order_abc",
      amount_paise: 69900,
      credits_to_grant: 15,
      provider_payload: {
        provider: "razorpay",
        order_id: "order_abc",
        amount_paise: 69900,
        currency: "INR",
        key_id: "rzp_test_123"
      }
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: intent })
    });

    const result = await createCreditPurchaseIntent("tok", "leads_15", "razorpay", "idem-1");

    expect(result).toEqual(intent);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/wallet/purchase-intents");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer tok");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("idem-1");
    expect(JSON.parse(init.body)).toEqual({ plan_id: "leads_15", provider: "razorpay" });
  });

  it("confirms a Razorpay checkout handler response against the order", async () => {
    const confirmed = { order_id: "order_abc", status: "authorized", credits_to_grant: 15 };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: confirmed })
    });

    const result = await confirmRazorpayPurchase("tok", "order_abc", {
      razorpay_order_id: "order_abc",
      razorpay_payment_id: "pay_1",
      razorpay_signature: "sig_1"
    });

    expect(result).toEqual(confirmed);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/wallet/purchase-intents/order_abc/confirm");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      razorpay_order_id: "order_abc",
      razorpay_payment_id: "pay_1",
      razorpay_signature: "sig_1"
    });
  });

  it("fetches purchase intent status by order id", async () => {
    const status = {
      order_id: "order_abc",
      status: "captured",
      plan_id: "leads_15",
      amount_paise: 69900,
      credits_to_grant: 15,
      provider: "razorpay"
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: status })
    });

    const result = await fetchCreditPurchaseStatus("tok", "order_abc");

    expect(result).toEqual(status);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/wallet/purchase-intents/order_abc");
    expect(String(url)).not.toContain("/confirm");
  });
});

describe("createIdempotencyKey", () => {
  it("returns a fresh key on every call so retries and provider switches never reuse one", () => {
    const first = createIdempotencyKey();
    const second = createIdempotencyKey();
    expect(first).toEqual(expect.any(String));
    expect(first.length).toBeGreaterThan(0);
    expect(second).not.toBe(first);
  });
});

describe("pollCreditPurchaseStatus", () => {
  function statusResult(status: CreditPurchaseStatus["status"]): CreditPurchaseStatus {
    return {
      order_id: "order_abc",
      status,
      plan_id: "leads_15",
      amount_paise: 69900,
      credits_to_grant: 15,
      provider: "razorpay"
    };
  }

  it("returns immediately once the order is captured, without sleeping", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(statusResult("captured"));
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await pollCreditPurchaseStatus({
      accessToken: "tok",
      orderId: "order_abc",
      fetchStatus,
      delay
    });

    expect(result).toEqual(statusResult("captured"));
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("returns immediately once the order fails, without further attempts", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(statusResult("failed"));
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await pollCreditPurchaseStatus({
      accessToken: "tok",
      orderId: "order_abc",
      fetchStatus,
      delay
    });

    expect(result).toEqual(statusResult("failed"));
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("keeps polling through non-terminal statuses until captured", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(statusResult("created"))
      .mockResolvedValueOnce(statusResult("authorized"))
      .mockResolvedValueOnce(statusResult("captured"));
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await pollCreditPurchaseStatus({
      accessToken: "tok",
      orderId: "order_abc",
      fetchStatus,
      delay
    });

    expect(result).toEqual(statusResult("captured"));
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(1000);
  });

  it("defaults to a 1000ms interval and 15 attempts, timing out to pending (not success)", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(statusResult("authorized"));
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await pollCreditPurchaseStatus({
      accessToken: "tok",
      orderId: "order_abc",
      fetchStatus,
      delay
    });

    expect(result).toEqual({ status: "pending", timedOut: true });
    expect(fetchStatus).toHaveBeenCalledTimes(15);
    expect(delay).toHaveBeenCalledTimes(14);
    expect(delay).toHaveBeenCalledWith(1000);
  });

  it("honors an overridden interval and attempt count", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(statusResult("created"));
    const delay = vi.fn().mockResolvedValue(undefined);

    const result = await pollCreditPurchaseStatus({
      accessToken: "tok",
      orderId: "order_abc",
      intervalMs: 50,
      maxAttempts: 3,
      fetchStatus,
      delay
    });

    expect(result).toEqual({ status: "pending", timedOut: true });
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    expect(delay).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(50);
  });

  it("uses the real HTTP status fetcher and a real timer-based delay by default", async () => {
    // No fetchStatus/delay override: exercises the production wiring (fetchCreditPurchaseStatus
    // over fetchApi, and a genuine setTimeout-based delay) with fake timers standing in for time.
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: statusResult("captured") })
    });
    vi.stubGlobal("fetch", fetchMock);

    const pollPromise = pollCreditPurchaseStatus({ accessToken: "tok", orderId: "order_abc" });
    await vi.runAllTimersAsync();
    const result = await pollPromise;

    expect(result).toEqual(statusResult("captured"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
