import { describe, expect, it } from "vitest";

import {
  CheckoutMapperError,
  buildRentAgreementProviderPayload
} from "../../checkout/checkout.mapper";

const baseRow = {
  id: "11111111-1111-1111-1111-111111111111",
  user_id: "22222222-2222-2222-2222-222222222222",
  plan_id: "premium",
  state_code: "KA",
  locale: "en"
} as Parameters<typeof buildRentAgreementProviderPayload>[0]["row"];

describe("buildRentAgreementProviderPayload: happy path", () => {
  it("sums planAmountPaise + stampDutyPaise into amount_paise", () => {
    const payload = buildRentAgreementProviderPayload({
      row: baseRow,
      planAmountPaise: 49900,
      stampDutyPaise: 30000,
      idempotencyKey: "idem-1"
    });
    expect(payload.amount_paise).toBe(79900);
  });

  it("returns currency='INR'", () => {
    const p = buildRentAgreementProviderPayload({
      row: baseRow,
      planAmountPaise: 1,
      stampDutyPaise: 0,
      idempotencyKey: "k"
    });
    expect(p.currency).toBe("INR");
  });

  it("returns notes with purpose='rent_agreement' and identifying fields", () => {
    const p = buildRentAgreementProviderPayload({
      row: baseRow,
      planAmountPaise: 49900,
      stampDutyPaise: 30000,
      idempotencyKey: "k"
    });
    expect(p.notes).toMatchObject({
      purpose: "rent_agreement",
      agreement_id: baseRow.id,
      plan_id: "premium",
      user_id: baseRow.user_id,
      state_code: "KA",
      locale: "en"
    });
  });

  it("receipt is <= 40 chars (Razorpay limit) and includes a stable agreement-derived prefix", () => {
    const p = buildRentAgreementProviderPayload({
      row: baseRow,
      planAmountPaise: 1,
      stampDutyPaise: 0,
      idempotencyKey: "k"
    });
    expect(p.receipt.length).toBeLessThanOrEqual(40);
    expect(p.receipt).toContain(baseRow.id.slice(0, 12));
  });
});

describe("buildRentAgreementProviderPayload: error paths", () => {
  it("throws INVALID_AMOUNT when total <= 0", () => {
    expect(() =>
      buildRentAgreementProviderPayload({
        row: baseRow,
        planAmountPaise: 0,
        stampDutyPaise: 0,
        idempotencyKey: "k"
      })
    ).toThrow(expect.objectContaining({ code: "RENT_AGREEMENT_CHECKOUT_INVALID_AMOUNT" }));
  });

  it("throws INVALID_AMOUNT for negative amounts", () => {
    expect(() =>
      buildRentAgreementProviderPayload({
        row: baseRow,
        planAmountPaise: -1,
        stampDutyPaise: 0,
        idempotencyKey: "k"
      })
    ).toThrow(expect.objectContaining({ code: "RENT_AGREEMENT_CHECKOUT_INVALID_AMOUNT" }));
  });

  it("throws INCOMPLETE_DRAFT when row.state_code is missing", () => {
    const row = { ...baseRow, state_code: null } as unknown as typeof baseRow;
    expect(() =>
      buildRentAgreementProviderPayload({
        row,
        planAmountPaise: 1,
        stampDutyPaise: 0,
        idempotencyKey: "k"
      })
    ).toThrow(expect.objectContaining({ code: "RENT_AGREEMENT_CHECKOUT_INCOMPLETE_DRAFT" }));
  });

  it("CheckoutMapperError is an Error subclass with name + code", () => {
    try {
      buildRentAgreementProviderPayload({
        row: baseRow,
        planAmountPaise: 0,
        stampDutyPaise: 0,
        idempotencyKey: "k"
      });
    } catch (err) {
      expect(err).toBeInstanceOf(CheckoutMapperError);
      expect((err as CheckoutMapperError).name).toBe("CheckoutMapperError");
      expect(typeof (err as CheckoutMapperError).code).toBe("string");
      return;
    }
    throw new Error("expected throw");
  });
});
