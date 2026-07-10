import { describe, it, expect } from "vitest";
import { CREDIT_PLANS, parseCreditPlan } from "../src/modules/payments/payments.util";

describe("owner lead-credit plans", () => {
  it("defines leads_5 at ₹299 for 5 credits", () => {
    expect(CREDIT_PLANS.leads_5).toEqual({ amountPaise: 29900, credits: 5 });
    expect(parseCreditPlan("leads_5").credits).toBe(5);
  });

  it("defines leads_15 at ₹699 for 15 credits", () => {
    expect(CREDIT_PLANS.leads_15).toEqual({ amountPaise: 69900, credits: 15 });
  });

  it("still rejects unknown plans", () => {
    expect(() => parseCreditPlan("leads_999")).toThrow();
  });
});
