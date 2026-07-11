import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RazorpayOrdersService } from "../razorpay-orders.service";

describe("RazorpayOrdersService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.RAZORPAY_ORDERS_MODE;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.RAZORPAY_API_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

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

  it("does not include PII in the order notes", async () => {
    process.env.RAZORPAY_ORDERS_MODE = "live";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    const fetchFn = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "order_live_123", amount: 29900, currency: "INR" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
    );
    const service = new RazorpayOrdersService(fetchFn as unknown as typeof fetch);
    await service.createOrder({
      amountPaise: 29900,
      receipt: "wallet_123",
      planId: "leads_5",
      credits: 5
    });

    const [, init] = fetchFn.mock.calls[0];
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      amount: 29900,
      currency: "INR",
      receipt: "wallet_123",
      notes: {
        plan_id: "leads_5",
        credits_to_grant: "5"
      }
    });
  });

  it("maps a non-2xx provider response to a 502 payment_provider_error", async () => {
    process.env.RAZORPAY_ORDERS_MODE = "live";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { description: "bad request" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        })
    );
    const service = new RazorpayOrdersService(fetchFn as typeof fetch);
    await expect(
      service.createOrder({
        amountPaise: 29900,
        receipt: "wallet_123",
        planId: "leads_5",
        credits: 5
      })
    ).rejects.toMatchObject({
      response: { code: "payment_provider_error" },
      status: 502
    });
  });

  it("maps a malformed provider response to a 502 payment_provider_error", async () => {
    process.env.RAZORPAY_ORDERS_MODE = "live";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "order_live_1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
    );
    const service = new RazorpayOrdersService(fetchFn as typeof fetch);
    await expect(
      service.createOrder({
        amountPaise: 29900,
        receipt: "wallet_123",
        planId: "leads_5",
        credits: 5
      })
    ).rejects.toMatchObject({
      response: { code: "payment_provider_error" },
      status: 502
    });
  });

  it("maps a request timeout to a 502 payment_provider_error", async () => {
    process.env.RAZORPAY_ORDERS_MODE = "live";
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    process.env.RAZORPAY_API_TIMEOUT_MS = "5";
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    const service = new RazorpayOrdersService(fetchFn as typeof fetch);
    await expect(
      service.createOrder({
        amountPaise: 29900,
        receipt: "wallet_123",
        planId: "leads_5",
        credits: 5
      })
    ).rejects.toMatchObject({
      response: { code: "payment_provider_error" },
      status: 502
    });
  });

  it("keyId returns the configured Razorpay key id", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_key";
    const service = new RazorpayOrdersService(vi.fn() as typeof fetch);
    expect(service.keyId()).toBe("rzp_test_key");
  });
});
