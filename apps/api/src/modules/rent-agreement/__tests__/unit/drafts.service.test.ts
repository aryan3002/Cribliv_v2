import "reflect-metadata";
import { beforeEach, describe, expect, it } from "vitest";

import { DraftsService, DraftError } from "../../drafts/drafts.service";

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

const VALID_STEP1 = {
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
};

const VALID_STEP2 = {
  full_address: "Plot 12, MG Road, Bangalore, KA 560001",
  type: "flat",
  area_sqft: 850,
  furnishing: "unfurnished",
  purpose: "residential"
};

const VALID_STEP3 = {
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

const VALID_STEP4 = {
  rent_due_day: 5,
  rent_payment_method: "upi",
  maintenance_included: true,
  electricity_paid_by: "tenant",
  water_paid_by: "tenant",
  gas_paid_by: "tenant",
  society_charges_paid_by: "shared",
  late_payment_penalty_pct: 2.5
};

const VALID_STEP5 = {
  pets_allowed: true,
  subletting_allowed: false,
  renovation_allowed: false,
  commercial_use_allowed: false,
  max_occupants: 4,
  witness_1: {
    name: "Witness One",
    father_name: "Father One",
    address: "789 Main Road, Bangalore"
  },
  witness_2: {
    name: "Witness Two",
    father_name: "Father Two",
    address: "101 Cross Road, Bangalore"
  }
};

const VALID_STEP7 = { agree_to_terms: true };

let svc: DraftsService;
let now: Date;

beforeEach(() => {
  now = new Date("2026-05-17T12:00:00Z");
  let counter = 0;
  svc = new DraftsService({
    clock: () => now,
    uuid: () => `dft-${(++counter).toString().padStart(4, "0")}`,
    panEncryptor: (plaintext: string) => Buffer.from(`MOCK:${plaintext}`)
  });
});

async function advanceTo(
  userId: string,
  id: string,
  targetStep: number,
  plan: "basic" | "standard" | "premium" = "basic"
) {
  const sequence: { step: number; payload: unknown }[] = [
    { step: 1, payload: VALID_STEP1 },
    { step: 2, payload: VALID_STEP2 },
    { step: 3, payload: VALID_STEP3 },
    { step: 4, payload: VALID_STEP4 },
    { step: 5, payload: VALID_STEP5 }
  ];
  if (plan === "premium") {
    sequence.push({ step: 6, payload: { confirm: true } });
  }
  for (const { step, payload } of sequence) {
    if (step >= targetStep) break;
    await svc.advance(userId, id, step, payload);
  }
}

describe("DraftsService.create", () => {
  it("creates a draft with current_step=1, status=draft", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    expect(draft.id).toBe("dft-0001");
    expect(draft.plan_id).toBe("basic");
    expect(draft.current_step).toBe(1);
    expect(draft.status).toBe("draft");
    expect(draft.locale).toBe("en");
    expect(draft.idempotency_key).toBe("idem-1");
  });

  it("idempotency replay: same key + same user returns the original draft", async () => {
    const first = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    const second = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    expect(second.id).toBe(first.id);
  });

  it("idempotency key is scoped to user (same key, different users → different drafts)", async () => {
    const a = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-shared");
    const b = await svc.create(USER_B, { plan_id: "basic", locale: "en" }, "idem-shared");
    expect(a.id).not.toBe(b.id);
  });

  it("rejects unknown plan_id", async () => {
    await expect(
      svc.create(USER_A, { plan_id: "platinum" as unknown as "basic", locale: "en" }, "idem-x")
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_INVALID_PLAN" });
  });
});

describe("DraftsService.getOne", () => {
  it("returns the draft when the requesting user owns it", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    const fetched = await svc.getOne(USER_A, draft.id);
    expect(fetched?.id).toBe(draft.id);
  });

  it("returns null when draft does not exist", async () => {
    const fetched = await svc.getOne(USER_A, "nope");
    expect(fetched).toBeNull();
  });

  it("returns null on cross-user access (does NOT leak existence as 403)", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    const fetched = await svc.getOne(USER_B, draft.id);
    expect(fetched).toBeNull();
  });

  it("never includes PAN ciphertext in returned shape", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    const fetched = await svc.getOne(USER_A, draft.id);
    expect(Object.keys(fetched ?? {})).not.toContain("owner_pan_ct");
    expect(Object.keys(fetched ?? {})).not.toContain("tenant_pan_ct");
  });
});

describe("DraftsService.listForUser", () => {
  it("returns summaries for the user's drafts only", async () => {
    await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-a1");
    await svc.create(USER_A, { plan_id: "standard", locale: "en" }, "idem-a2");
    await svc.create(USER_B, { plan_id: "premium", locale: "en" }, "idem-b1");
    const list = await svc.listForUser(USER_A);
    expect(list).toHaveLength(2);
    expect(list.every((s) => s.has_owner_pan === false)).toBe(true);
  });

  it("returns empty array when user has no drafts", async () => {
    const list = await svc.listForUser(USER_A);
    expect(list).toEqual([]);
  });
});

describe("DraftsService.patchStep", () => {
  it("writes partial fields without bumping current_step", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    const result = await svc.patchStep(USER_A, draft.id, 1, {
      owner: { full_name: "Partial Name" }
    });
    expect(result.saved).toBe(true);
    expect(result.current_step).toBe(1);
    const fetched = await svc.getOne(USER_A, draft.id);
    expect(fetched?.owner_full_name).toBe("Partial Name");
    expect(fetched?.current_step).toBe(1);
  });

  it("throws NOT_FOUND on cross-user patch", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(
      svc.patchStep(USER_B, draft.id, 1, { owner: { full_name: "X" } })
    ).rejects.toMatchObject({
      code: "RENT_AGREEMENT_NOT_FOUND"
    });
  });

  it("rejects autosave into a future step (step > current_step)", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.patchStep(USER_A, draft.id, 5, {})).rejects.toMatchObject({
      code: "RENT_AGREEMENT_STEP_MISMATCH"
    });
  });
});

describe("DraftsService.advance: happy path", () => {
  it("step 1 → 2 on valid payload", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    const result = await svc.advance(USER_A, draft.id, 1, VALID_STEP1);
    expect(result.current_step).toBe(2);
    expect(result.step_validated_at["1"]).toBeDefined();
  });

  it("basic plan: 5 → 7 (skips step 6)", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await advanceTo(USER_A, draft.id, 5, "basic");
    const result = await svc.advance(USER_A, draft.id, 5, VALID_STEP5);
    expect(result.current_step).toBe(7);
  });

  it("standard plan: 5 → 7 (skips step 6)", async () => {
    const draft = await svc.create(USER_A, { plan_id: "standard", locale: "en" }, "idem-1");
    await advanceTo(USER_A, draft.id, 5, "standard");
    const result = await svc.advance(USER_A, draft.id, 5, VALID_STEP5);
    expect(result.current_step).toBe(7);
  });

  it("premium plan: 5 → 6 → 7", async () => {
    const draft = await svc.create(USER_A, { plan_id: "premium", locale: "en" }, "idem-1");
    await advanceTo(USER_A, draft.id, 5, "premium");
    const fifth = await svc.advance(USER_A, draft.id, 5, VALID_STEP5);
    expect(fifth.current_step).toBe(6);
    const sixth = await svc.advance(USER_A, draft.id, 6, { confirm: true });
    expect(sixth.current_step).toBe(7);
  });
});

describe("DraftsService.advance: failures", () => {
  it("STEP_MISMATCH when advancing wrong step", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.advance(USER_A, draft.id, 3, VALID_STEP3)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_STEP_MISMATCH"
    });
  });

  it("STEP_VALIDATION_FAILED with errors[] when DTO invalid", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    try {
      await svc.advance(USER_A, draft.id, 1, {
        owner: { ...VALID_STEP1.owner, age: 10 },
        tenant: VALID_STEP1.tenant
      });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as DraftError;
      expect(e.code).toBe("RENT_AGREEMENT_STEP_VALIDATION_FAILED");
      expect(Array.isArray(e.errors)).toBe(true);
      expect(e.errors?.some((x) => x.field.includes("age"))).toBe(true);
    }
  });

  it("NOT_FOUND on cross-user advance", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await expect(svc.advance(USER_B, draft.id, 1, VALID_STEP1)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_NOT_FOUND"
    });
  });

  it("STEP_MISMATCH when replaying an already-completed step", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await svc.advance(USER_A, draft.id, 1, VALID_STEP1);
    await expect(svc.advance(USER_A, draft.id, 1, VALID_STEP1)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_STEP_MISMATCH"
    });
  });

  it("step 6 on basic plan rejected via STEP_MISMATCH (step not in sequence)", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await advanceTo(USER_A, draft.id, 5, "basic");
    await svc.advance(USER_A, draft.id, 5, VALID_STEP5);
    // current_step is now 7 (basic skips 6) — submitting step 6 must fail
    await expect(svc.advance(USER_A, draft.id, 6, { confirm: true })).rejects.toMatchObject({
      code: "RENT_AGREEMENT_STEP_MISMATCH"
    });
  });
});

describe("DraftsService.advance: step 3 cross-field interaction", () => {
  it("high rent without owner PAN → CROSS_FIELD_FAILED", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await svc.advance(USER_A, draft.id, 1, VALID_STEP1); // no PAN
    await svc.advance(USER_A, draft.id, 2, VALID_STEP2);
    await expect(
      svc.advance(USER_A, draft.id, 3, { ...VALID_STEP3, rent_amount_paise: 10_000_000 })
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_CROSS_FIELD_FAILED" });
  });

  it("high rent with both PANs present → advances", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await svc.advance(USER_A, draft.id, 1, {
      owner: { ...VALID_STEP1.owner, pan: "ABCDE1234F" },
      tenant: { ...VALID_STEP1.tenant, pan: "ZYXWV9876A" }
    });
    await svc.advance(USER_A, draft.id, 2, VALID_STEP2);
    const result = await svc.advance(USER_A, draft.id, 3, {
      ...VALID_STEP3,
      rent_amount_paise: 10_000_000,
      tenure_months: 11
    });
    expect(result.current_step).toBe(4);
  });
});

describe("DraftsService.back", () => {
  it("reverts to an earlier step", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await svc.advance(USER_A, draft.id, 1, VALID_STEP1);
    await svc.advance(USER_A, draft.id, 2, VALID_STEP2);
    const result = await svc.back(USER_A, draft.id, 1);
    expect(result.current_step).toBe(1);
  });

  it("STEP_MISMATCH when target >= current_step", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await svc.advance(USER_A, draft.id, 1, VALID_STEP1);
    await expect(svc.back(USER_A, draft.id, 5)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_STEP_MISMATCH"
    });
  });

  it("STEP_MISMATCH when target not in plan sequence", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await advanceTo(USER_A, draft.id, 5, "basic");
    await svc.advance(USER_A, draft.id, 5, VALID_STEP5);
    // current_step now 7; basic excludes 6
    await expect(svc.back(USER_A, draft.id, 6)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_STEP_MISMATCH"
    });
  });

  it("NOT_FOUND on cross-user back", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await svc.advance(USER_A, draft.id, 1, VALID_STEP1);
    await expect(svc.back(USER_B, draft.id, 1)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_NOT_FOUND"
    });
  });
});

describe("DraftsService.advance: step 7 (review) uses VALID_STEP7 marker", () => {
  it("advancing past step 5 on basic plan reaches step 7 review terminal", async () => {
    const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
    await advanceTo(USER_A, draft.id, 5, "basic");
    const r5 = await svc.advance(USER_A, draft.id, 5, VALID_STEP5);
    expect(r5.current_step).toBe(7);
    const r7 = await svc.advance(USER_A, draft.id, 7, VALID_STEP7);
    expect(r7.current_step).toBe(7);
    expect(r7.terminal).toBe(true);
  });
});

describe("DraftsService state-transition mutations (Phase 13)", () => {
  describe("markPendingPayment", () => {
    it("flips status from draft to pending_payment and records payment_order_id", async () => {
      const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      await svc.markPendingPayment(draft.id, "order-xyz-001");
      const got = await svc.getOne(USER_A, draft.id);
      expect(got?.status).toBe("pending_payment");
      expect(got?.payment_order_id).toBe("order-xyz-001");
    });

    it("throws RENT_AGREEMENT_NOT_FOUND when agreement id unknown", async () => {
      await expect(svc.markPendingPayment("missing-id", "order-1")).rejects.toMatchObject({
        code: "RENT_AGREEMENT_NOT_FOUND"
      });
    });

    it("bumps updated_at to clock now", async () => {
      const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      now = new Date("2026-06-01T10:00:00Z");
      await svc.markPendingPayment(draft.id, "order-1");
      const got = await svc.getOne(USER_A, draft.id);
      expect(got?.updated_at).toBe("2026-06-01T10:00:00.000Z");
    });
  });

  describe("markPaid", () => {
    it("flips status from pending_payment to paid", async () => {
      const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      await svc.markPendingPayment(draft.id, "order-1");
      await svc.markPaid(draft.id);
      const got = await svc.getOne(USER_A, draft.id);
      expect(got?.status).toBe("paid");
    });

    it("is idempotent — calling markPaid twice stays at paid (no error)", async () => {
      const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      await svc.markPendingPayment(draft.id, "order-1");
      await svc.markPaid(draft.id);
      await svc.markPaid(draft.id);
      const got = await svc.getOne(USER_A, draft.id);
      expect(got?.status).toBe("paid");
    });

    it("throws RENT_AGREEMENT_NOT_FOUND when agreement id unknown", async () => {
      await expect(svc.markPaid("missing")).rejects.toMatchObject({
        code: "RENT_AGREEMENT_NOT_FOUND"
      });
    });
  });

  describe("markGenerated", () => {
    it("flips status to generated and persists blob path + expiry", async () => {
      const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      await svc.markPendingPayment(draft.id, "order-1");
      await svc.markPaid(draft.id);
      await svc.markGenerated(draft.id, {
        blobPath: "2026/05/dft-0001.pdf",
        expiresAt: "2026-08-17T12:00:00Z"
      });
      const got = await svc.getOne(USER_A, draft.id);
      expect(got?.status).toBe("generated");
      expect(got?.pdf_blob_path).toBe("2026/05/dft-0001.pdf");
      expect(got?.expires_at).toBe("2026-08-17T12:00:00Z");
      expect(got?.pdf_generated_at).toBe("2026-05-17T12:00:00.000Z");
    });

    it("throws RENT_AGREEMENT_NOT_FOUND when agreement id unknown", async () => {
      await expect(
        svc.markGenerated("missing", { blobPath: "x/y.pdf", expiresAt: "2026-06-01T00:00:00Z" })
      ).rejects.toMatchObject({
        code: "RENT_AGREEMENT_NOT_FOUND"
      });
    });
  });

  describe("incrementDownloadCount", () => {
    it("bumps the row's download_count by 1", async () => {
      const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      await svc.markPendingPayment(draft.id, "order-1");
      await svc.markPaid(draft.id);
      await svc.markGenerated(draft.id, {
        blobPath: "x/y.pdf",
        expiresAt: "2026-08-17T12:00:00Z"
      });
      await svc.incrementDownloadCount(draft.id);
      const got = await svc.getOne(USER_A, draft.id);
      expect(got?.download_count).toBe(1);
      await svc.incrementDownloadCount(draft.id);
      const got2 = await svc.getOne(USER_A, draft.id);
      expect(got2?.download_count).toBe(2);
    });

    it("throws RENT_AGREEMENT_NOT_FOUND on unknown id", async () => {
      await expect(svc.incrementDownloadCount("missing")).rejects.toMatchObject({
        code: "RENT_AGREEMENT_NOT_FOUND"
      });
    });
  });

  describe("getByIdUnscoped (for webhook/worker callbacks without user_id)", () => {
    it("returns row by id alone (no user_id check)", async () => {
      const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      const got = await svc.getByIdUnscoped(draft.id);
      expect(got?.id).toBe(draft.id);
    });

    it("returns null for unknown id", async () => {
      const got = await svc.getByIdUnscoped("missing");
      expect(got).toBeNull();
    });
  });

  describe("markEStampIssued / markESignSession / markESignCompleted (Phase 15)", () => {
    it("markEStampIssued persists e_stamp_reference on the row", async () => {
      const d = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      await svc.markEStampIssued(d.id, "MOCK-ESTAMP-1-x");
      const r = await svc.getOne(USER_A, d.id);
      expect(r?.e_stamp_reference).toBe("MOCK-ESTAMP-1-x");
    });

    it("markESignSession persists e_sign_session_id on the row", async () => {
      const d = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      await svc.markESignSession(d.id, "sess-abc");
      const r = await svc.getOne(USER_A, d.id);
      expect(r?.e_sign_session_id).toBe("sess-abc");
    });

    it("markESignCompleted persists e_sign_completed_at to clock now", async () => {
      const d = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      now = new Date("2026-07-01T15:30:00Z");
      await svc.markESignCompleted(d.id);
      const r = await svc.getOne(USER_A, d.id);
      expect(r?.e_sign_completed_at).toBe("2026-07-01T15:30:00.000Z");
    });

    it("all three throw NOT_FOUND for unknown agreement id", async () => {
      await expect(svc.markEStampIssued("missing", "x")).rejects.toMatchObject({
        code: "RENT_AGREEMENT_NOT_FOUND"
      });
      await expect(svc.markESignSession("missing", "x")).rejects.toMatchObject({
        code: "RENT_AGREEMENT_NOT_FOUND"
      });
      await expect(svc.markESignCompleted("missing")).rejects.toMatchObject({
        code: "RENT_AGREEMENT_NOT_FOUND"
      });
    });
  });

  describe("getRowByIdForRender (PAN-ct-bearing row for PDF worker)", () => {
    it("returns the raw row including user_id (which DraftFull strips)", async () => {
      const draft = await svc.create(USER_A, { plan_id: "basic", locale: "en" }, "idem-1");
      const row = await svc.getRowByIdForRender(draft.id);
      expect(row?.user_id).toBe(USER_A);
      expect(row?.id).toBe(draft.id);
    });

    it("returns null for unknown id", async () => {
      const row = await svc.getRowByIdForRender("missing");
      expect(row).toBeNull();
    });
  });
});
