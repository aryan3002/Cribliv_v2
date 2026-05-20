import { describe, expect, it, vi } from "vitest";

import { CheckoutService } from "../../checkout/checkout.service";

const USER_ID = "user-1";
const DRAFT_ID = "draft-1";

function makeDeps(overrides: Partial<ConstructorParameters<typeof CheckoutService>[0]> = {}) {
  const draftRow = {
    id: DRAFT_ID,
    user_id: USER_ID,
    plan_id: "premium",
    state_code: "KA",
    locale: "en",
    current_step: 7,
    status: "draft",
    stamp_duty_paise: 30000
  };
  const draftsService = { getOne: vi.fn(async () => draftRow) };
  const signaturesService = { hasBothSignatures: vi.fn(() => true) };
  const planLookup = vi.fn(() => ({ amount_paise: 49900 }));
  let counter = 0;
  return {
    draftsService: draftsService as never,
    signaturesService: signaturesService as never,
    planLookup,
    uuid: () => `uuid-${++counter}`,
    clock: () => new Date("2026-05-18T13:00:00Z"),
    providerOrderIdGenerator: () => "order_razorpay_1",
    ...overrides
  };
}

const validReq = {
  userId: USER_ID,
  draftId: DRAFT_ID,
  idempotencyKey: "idem-1",
  provider: "razorpay" as const
};

describe("CheckoutService.createOrder: happy path", () => {
  it("returns provider_order_id, amount_paise, currency, notes", async () => {
    const svc = new CheckoutService(makeDeps());
    const r = await svc.createOrder(validReq);
    expect(r.provider_order_id).toBe("order_razorpay_1");
    expect(r.amount_paise).toBe(79900);
    expect(r.currency).toBe("INR");
    expect(r.notes.purpose).toBe("rent_agreement");
  });

  it("persists an order findable by provider_order_id with status='pending_payment'", async () => {
    const svc = new CheckoutService(makeDeps());
    await svc.createOrder(validReq);
    const order = svc.findByProviderOrderId("order_razorpay_1");
    expect(order?.status).toBe("pending_payment");
    expect(order?.user_id).toBe(USER_ID);
  });

  it("calls planLookup with the draft's plan_id", async () => {
    const deps = makeDeps();
    const svc = new CheckoutService(deps);
    await svc.createOrder(validReq);
    expect(deps.planLookup).toHaveBeenCalledWith("premium");
  });

  it("accepts provider='upi'", async () => {
    const svc = new CheckoutService(makeDeps());
    await expect(svc.createOrder({ ...validReq, provider: "upi" })).resolves.toBeDefined();
  });

  it("treats null stamp_duty_paise as 0", async () => {
    const draftsService = {
      getOne: vi.fn(async () => ({
        id: DRAFT_ID,
        user_id: USER_ID,
        plan_id: "premium",
        state_code: "KA",
        locale: "en",
        current_step: 7,
        status: "draft",
        stamp_duty_paise: null
      }))
    };
    const svc = new CheckoutService(makeDeps({ draftsService: draftsService as never }));
    const r = await svc.createOrder(validReq);
    expect(r.amount_paise).toBe(49900);
  });
});

describe("CheckoutService.createOrder: idempotency", () => {
  it("returns the same provider_order_id on replay with same (user, idemKey)", async () => {
    const svc = new CheckoutService(makeDeps());
    const a = await svc.createOrder(validReq);
    const b = await svc.createOrder(validReq);
    expect(b.provider_order_id).toBe(a.provider_order_id);
  });

  it("does not call planLookup a second time on replay", async () => {
    const deps = makeDeps();
    const svc = new CheckoutService(deps);
    await svc.createOrder(validReq);
    await svc.createOrder(validReq);
    expect(deps.planLookup).toHaveBeenCalledTimes(1);
  });

  it("idempotency is scoped per user (different users may share an idem key)", async () => {
    const draftsService = {
      getOne: vi.fn(async (userId: string, draftId: string) => ({
        id: draftId,
        user_id: userId,
        plan_id: "premium",
        state_code: "KA",
        locale: "en",
        current_step: 7,
        status: "draft",
        stamp_duty_paise: 30000
      }))
    };
    let n = 0;
    const svc = new CheckoutService(
      makeDeps({
        draftsService: draftsService as never,
        providerOrderIdGenerator: () => `order_${++n}`
      })
    );
    const a = await svc.createOrder({ ...validReq, userId: "user-a", draftId: "draft-a" });
    const b = await svc.createOrder({ ...validReq, userId: "user-b", draftId: "draft-b" });
    expect(b.provider_order_id).not.toBe(a.provider_order_id);
  });
});

describe("CheckoutService.createOrder: validation gates", () => {
  it("rejects unknown provider", async () => {
    const svc = new CheckoutService(makeDeps());
    await expect(
      svc.createOrder({ ...validReq, provider: "paypal" as never })
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_CHECKOUT_INVALID_PROVIDER" });
  });

  it("rejects when draft not found", async () => {
    const draftsService = { getOne: vi.fn(async () => null) };
    const svc = new CheckoutService(makeDeps({ draftsService: draftsService as never }));
    await expect(svc.createOrder(validReq)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_FOUND"
    });
  });

  it("rejects when draft.current_step !== 7", async () => {
    const draftsService = {
      getOne: vi.fn(async () => ({
        id: DRAFT_ID,
        user_id: USER_ID,
        plan_id: "premium",
        state_code: "KA",
        locale: "en",
        current_step: 5,
        status: "draft",
        stamp_duty_paise: 30000
      }))
    };
    const svc = new CheckoutService(makeDeps({ draftsService: draftsService as never }));
    await expect(svc.createOrder(validReq)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_READY"
    });
  });

  it("rejects when draft.status !== 'draft'", async () => {
    const draftsService = {
      getOne: vi.fn(async () => ({
        id: DRAFT_ID,
        user_id: USER_ID,
        plan_id: "premium",
        state_code: "KA",
        locale: "en",
        current_step: 7,
        status: "paid",
        stamp_duty_paise: 30000
      }))
    };
    const svc = new CheckoutService(makeDeps({ draftsService: draftsService as never }));
    await expect(svc.createOrder(validReq)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_READY"
    });
  });

  it("rejects premium plan when both signatures not present", async () => {
    const signaturesService = { hasBothSignatures: vi.fn(() => false) };
    const svc = new CheckoutService(makeDeps({ signaturesService: signaturesService as never }));
    await expect(svc.createOrder(validReq)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_CHECKOUT_SIGNATURES_MISSING"
    });
  });

  it("does NOT check signatures for plan='basic'", async () => {
    const draftsService = {
      getOne: vi.fn(async () => ({
        id: DRAFT_ID,
        user_id: USER_ID,
        plan_id: "basic",
        state_code: "KA",
        locale: "en",
        current_step: 7,
        status: "draft",
        stamp_duty_paise: 30000
      }))
    };
    const signaturesService = { hasBothSignatures: vi.fn(() => false) };
    const svc = new CheckoutService(
      makeDeps({
        draftsService: draftsService as never,
        signaturesService: signaturesService as never
      })
    );
    await expect(svc.createOrder(validReq)).resolves.toBeDefined();
    expect(signaturesService.hasBothSignatures).not.toHaveBeenCalled();
  });
});

describe("CheckoutService.markPaid", () => {
  it("flips status to 'paid' and records providerPaymentId", async () => {
    const svc = new CheckoutService(makeDeps());
    const r = await svc.createOrder(validReq);
    svc.markPaid(r.id, "pay_xyz");
    const order = svc.findByProviderOrderId("order_razorpay_1");
    expect(order?.status).toBe("paid");
    expect(order?.provider_payment_id).toBe("pay_xyz");
  });

  it("second markPaid call is a no-op (idempotent)", async () => {
    const svc = new CheckoutService(makeDeps());
    const r = await svc.createOrder(validReq);
    svc.markPaid(r.id, "pay_xyz");
    expect(() => svc.markPaid(r.id, "pay_xyz")).not.toThrow();
  });

  it("throws ORDER_NOT_FOUND when order id is unknown", () => {
    const svc = new CheckoutService(makeDeps());
    expect(() => svc.markPaid("missing", "pay_x")).toThrow(
      expect.objectContaining({ code: "RENT_AGREEMENT_CHECKOUT_ORDER_NOT_FOUND" })
    );
  });
});

describe("CheckoutService.findByProviderOrderId", () => {
  it("returns null for unknown provider order id", () => {
    const svc = new CheckoutService(makeDeps());
    expect(svc.findByProviderOrderId("nope")).toBeNull();
  });
});

describe("CheckoutService.createOrder: paymentProvider integration (Phase 13)", () => {
  it("uses paymentProvider.createOrder() to mint the provider_order_id when supplied", async () => {
    const paymentProvider = {
      createOrder: vi.fn(async () => ({ providerOrderId: "from_provider_xyz" }))
    };
    const svc = new CheckoutService({ ...makeDeps(), paymentProvider });
    const r = await svc.createOrder(validReq);
    expect(r.provider_order_id).toBe("from_provider_xyz");
    expect(paymentProvider.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amountPaise: 79900,
        currency: "INR",
        receipt: expect.any(String)
      })
    );
  });

  it("falls back to providerOrderIdGenerator when paymentProvider not supplied (back-compat)", async () => {
    const svc = new CheckoutService(makeDeps());
    const r = await svc.createOrder(validReq);
    expect(r.provider_order_id).toBe("order_razorpay_1");
  });
});

describe("CheckoutService.createOrder: drafts state-transition side effect (Phase 13)", () => {
  it("calls onOrderCreated callback with (draftId, providerOrderId) after persisting the order", async () => {
    const onOrderCreated = vi.fn(async () => {});
    const svc = new CheckoutService({ ...makeDeps(), onOrderCreated });
    await svc.createOrder(validReq);
    expect(onOrderCreated).toHaveBeenCalledWith(DRAFT_ID, "order_razorpay_1");
  });

  it("does not call onOrderCreated on idempotency-replay", async () => {
    const onOrderCreated = vi.fn(async () => {});
    const svc = new CheckoutService({ ...makeDeps(), onOrderCreated });
    await svc.createOrder(validReq);
    await svc.createOrder(validReq);
    expect(onOrderCreated).toHaveBeenCalledTimes(1);
  });

  it("works when no onOrderCreated callback is supplied (back-compat with Phase 11 wiring)", async () => {
    const svc = new CheckoutService(makeDeps());
    await expect(svc.createOrder(validReq)).resolves.toBeDefined();
  });
});
