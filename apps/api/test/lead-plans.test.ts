import { describe, it, expect } from "vitest";
import { CREDIT_PLANS, parseCreditPlan } from "../src/modules/payments/payments.util";

describe("owner lead-credit plans", () => {
  it("defines leads_5 at ₹299 for 5 credits", () => {
    expect(CREDIT_PLANS.leads_5).toEqual({
      audience: "owner",
      amountPaise: 29900,
      credits: 5,
      label: "5 lead credits",
      recommended: false
    });
    expect(parseCreditPlan("leads_5").credits).toBe(5);
  });

  it("defines leads_15 at ₹699 for 15 credits", () => {
    expect(CREDIT_PLANS.leads_15).toEqual({
      audience: "owner",
      amountPaise: 69900,
      credits: 15,
      label: "15 lead credits",
      recommended: true
    });
  });

  it("still rejects unknown plans", () => {
    expect(() => parseCreditPlan("leads_999")).toThrow();
  });
});
