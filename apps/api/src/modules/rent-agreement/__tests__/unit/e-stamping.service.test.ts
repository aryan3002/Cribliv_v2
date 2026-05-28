import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { DraftsService } from "../../drafts/drafts.service";
import { EStampingService } from "../../e-stamping/e-stamping.service";
import { MockEStampingProvider } from "../../e-stamping/mock-e-stamping.provider";

const USER_A = "11111111-1111-1111-1111-111111111111";

const STEP3 = {
  agreement_type: "new",
  agreement_date: "2026-05-01",
  commencement_date: "2026-06-01",
  tenure_months: 11,
  lock_in_months: 6,
  notice_period_months: 2,
  rent_amount_paise: 2_500_000,
  security_deposit_paise: 5_000_000,
  annual_increment_pct: 5,
  state_code: "KA",
  city: "Bangalore"
};

function makeServices() {
  let counter = 0;
  const drafts = new DraftsService({
    clock: () => new Date("2026-05-17T12:00:00Z"),
    uuid: () => `dft-${(++counter).toString().padStart(4, "0")}`,
    panEncryptor: (s) => Buffer.from(`MOCK:${s}`)
  });
  const provider = new MockEStampingProvider();
  const svc = new EStampingService({ drafts, provider });
  return { drafts, provider, svc };
}

async function advanceToStep4WithStampDuty(drafts: DraftsService, userId: string, id: string) {
  await drafts.advance(userId, id, 1, {
    owner: {
      full_name: "John Doe",
      father_name: "Sam Doe",
      age: 35,
      phone: "+919876543210",
      permanent_address: "123 MG Road, Bangalore"
    },
    tenant: {
      full_name: "Jane Smith",
      father_name: "Bob Smith",
      age: 28,
      phone: "+919876543211",
      permanent_address: "456 Park St, Mumbai"
    }
  });
  await drafts.advance(userId, id, 2, {
    full_address: "Plot 12, MG Road, Bangalore, KA 560001",
    type: "flat",
    area_sqft: 850,
    furnishing: "unfurnished",
    purpose: "residential"
  });
  await drafts.advance(userId, id, 3, STEP3);
  // simulate stamp duty being computed and persisted
  await drafts.setStampDuty(id, 30000);
}

describe("EStampingService.issue", () => {
  it("throws RENT_AGREEMENT_NOT_FOUND when agreement doesn't belong to user", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.issue("OTHER-USER", d.id)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_NOT_FOUND"
    });
  });

  it("throws RENT_AGREEMENT_ESTAMP_NOT_READY when step 3 not yet validated", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.issue(USER_A, d.id)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_ESTAMP_NOT_READY"
    });
  });

  it("returns a receipt and persists e_stamp_reference on success", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await advanceToStep4WithStampDuty(drafts, USER_A, d.id);
    const receipt = await svc.issue(USER_A, d.id);
    expect(receipt.referenceId).toMatch(/^MOCK-ESTAMP-/);
    expect(receipt.status).toBe("issued");
    const got = await drafts.getOne(USER_A, d.id);
    expect(got?.e_stamp_reference).toBe(receipt.referenceId);
  });
});

describe("EStampingService.status", () => {
  it("returns the provider status after issue", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await advanceToStep4WithStampDuty(drafts, USER_A, d.id);
    await svc.issue(USER_A, d.id);
    const s = await svc.status(USER_A, d.id);
    expect(s.status).toBe("issued");
  });

  it("throws RENT_AGREEMENT_ESTAMP_NOT_ISSUED before issue is called", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.status(USER_A, d.id)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_ESTAMP_NOT_ISSUED"
    });
  });
});
