import "reflect-metadata";
import { describe, expect, it } from "vitest";

import { DraftsService } from "../../drafts/drafts.service";
import { ESignService } from "../../e-sign/e-sign.service";
import { MockESignProvider } from "../../e-sign/mock-e-sign.provider";

const USER_A = "11111111-1111-1111-1111-111111111111";

function makeServices() {
  let counter = 0;
  const drafts = new DraftsService({
    clock: () => new Date("2026-05-17T12:00:00Z"),
    uuid: () => `dft-${(++counter).toString().padStart(4, "0")}`,
    panEncryptor: (s) => Buffer.from(`MOCK:${s}`)
  });
  const provider = new MockESignProvider();
  const svc = new ESignService({ drafts, provider });
  return { drafts, provider, svc };
}

async function withParties(drafts: DraftsService, userId: string, id: string) {
  await drafts.advance(userId, id, 1, {
    owner: {
      full_name: "John Doe",
      father_name: "Sam Doe",
      age: 35,
      phone: "+919876543210",
      permanent_address: "123 MG Road, Bangalore",
      aadhaar_last4: "1234"
    },
    tenant: {
      full_name: "Jane Smith",
      father_name: "Bob Smith",
      age: 28,
      phone: "+919876543211",
      permanent_address: "456 Park St, Mumbai",
      aadhaar_last4: "5678"
    }
  });
}

describe("ESignService.initiate", () => {
  it("throws NOT_FOUND when agreement doesn't belong to user", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.initiate("OTHER", d.id, "owner")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_NOT_FOUND"
    });
  });

  it("throws ESIGN_NOT_READY when party has no aadhaar_last4 yet", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.initiate(USER_A, d.id, "owner")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_ESIGN_NOT_READY"
    });
  });

  it("returns a session and persists e_sign_session_id on success", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await withParties(drafts, USER_A, d.id);
    const session = await svc.initiate(USER_A, d.id, "owner");
    expect(session.sessionId).toMatch(/^MOCK-ESIGN-SESS-/);
    expect(session.status).toBe("initiated");
    const got = await drafts.getOne(USER_A, d.id);
    expect(got?.e_sign_session_id).toBe(session.sessionId);
  });
});

describe("ESignService.verify", () => {
  it("throws ESIGN_NOT_INITIATED when initiate hasn't been called", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.verify(USER_A, d.id, "123456")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_ESIGN_NOT_INITIATED"
    });
  });

  it("throws ESIGN_OTP_INVALID when OTP fails (must start with '1')", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await withParties(drafts, USER_A, d.id);
    await svc.initiate(USER_A, d.id, "owner");
    await expect(svc.verify(USER_A, d.id, "999999")).rejects.toMatchObject({
      code: "RENT_AGREEMENT_ESIGN_OTP_INVALID"
    });
  });

  it("returns verified result + marks completed when OTP valid (1xxxxx)", async () => {
    const { drafts, svc } = makeServices();
    const d = await drafts.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await withParties(drafts, USER_A, d.id);
    await svc.initiate(USER_A, d.id, "owner");
    const r = await svc.verify(USER_A, d.id, "123456");
    expect(r.status).toBe("verified");
    const got = await drafts.getOne(USER_A, d.id);
    expect(got?.e_sign_completed_at).toBeTruthy();
  });
});
