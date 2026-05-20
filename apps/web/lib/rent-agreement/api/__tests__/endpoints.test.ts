import { describe, expect, it } from "vitest";
import { RentAgreementApi } from "../endpoints";

describe("RentAgreementApi paths", () => {
  it("plans", () => expect(RentAgreementApi.plans().path).toBe("/rent-agreement/plans"));
  it("states", () => expect(RentAgreementApi.states().path).toBe("/rent-agreement/states"));
  it("stampDuty encodes state + numeric params", () => {
    const r = RentAgreementApi.stampDuty({ state: "KA", rent: 25e5, tenure: 11, deposit: 5e6 });
    expect(r.path).toBe(
      "/rent-agreement/stamp-duty?state=KA&rent=2500000&tenure=11&deposit=5000000"
    );
  });
  it("stampDuty omits deposit when not supplied", () => {
    const r = RentAgreementApi.stampDuty({ state: "DL", rent: 100, tenure: 6 });
    expect(r.path).toBe("/rent-agreement/stamp-duty?state=DL&rent=100&tenure=6");
  });
  it("createDraft sets idempotencyKey + body", () => {
    const r = RentAgreementApi.createDraft({ plan_id: "basic", locale: "en" }, "idem-1");
    expect(r.method).toBe("POST");
    expect(r.path).toBe("/rent-agreement/draft");
    expect(r.body).toEqual({ plan_id: "basic", locale: "en" });
    expect(r.idempotencyKey).toBe("idem-1");
  });
  it("getDraft / advanceStep / patchStep / backStep / status / download", () => {
    expect(RentAgreementApi.getDraft("abc").path).toBe("/rent-agreement/abc");
    expect(RentAgreementApi.advanceStep("abc", 3, { x: 1 }).path).toBe(
      "/rent-agreement/abc/step/3/advance"
    );
    expect(RentAgreementApi.patchStep("abc", 2, { x: 1 }).method).toBe("PATCH");
    expect(RentAgreementApi.backStep("abc", 1).path).toBe("/rent-agreement/abc/step/1/back");
    expect(RentAgreementApi.status("abc").path).toBe("/rent-agreement/abc/status");
    expect(RentAgreementApi.download("abc").path).toBe("/rent-agreement/abc/download");
  });
  it("checkout sets idempotencyKey", () => {
    const r = RentAgreementApi.checkout("abc", { provider: "razorpay" }, "idem-co");
    expect(r.idempotencyKey).toBe("idem-co");
  });
  it("e-stamp + e-sign endpoints", () => {
    expect(RentAgreementApi.eStampIssue("abc").path).toBe("/rent-agreement/abc/e-stamp/issue");
    expect(RentAgreementApi.eStampStatus("abc").path).toBe("/rent-agreement/abc/e-stamp/status");
    const init = RentAgreementApi.eSignInitiate("abc", "owner");
    expect(init.body).toEqual({ party: "owner" });
    const ver = RentAgreementApi.eSignVerify("abc", "123456");
    expect(ver.body).toEqual({ otp: "123456" });
  });
  it("devBootstrap", () => {
    expect(RentAgreementApi.devBootstrap().path).toBe("/rent-agreement/_dev/bootstrap");
  });
});
