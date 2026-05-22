import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignatureGuardError } from "../../signatures/image.guard";
import { SignaturesService } from "../../signatures/signatures.service";

const AGREEMENT_ID = "00000000-0000-0000-0000-000000000001";

function makeService(overrides: Partial<ConstructorParameters<typeof SignaturesService>[0]> = {}) {
  const guardOk = vi.fn(async () => ({
    bytes: Buffer.from("clean-bytes"),
    contentType: "image/png" as const,
    sha256: "a".repeat(64)
  }));
  return new SignaturesService({
    guard: guardOk,
    clock: () => new Date("2026-05-18T12:00:00Z"),
    uuid: () => "sig-uuid-stable",
    ...overrides
  });
}

const validSaveInput = {
  agreementId: AGREEMENT_ID,
  party: "owner" as const,
  method: "canvas" as const,
  plan: "premium",
  raw: Buffer.from("ignored-by-fake-guard"),
  declaredContentType: "image/png"
};

beforeEach(() => {
  vi.clearAllMocks();
});

/* ─── Happy path ──────────────────────────────────────────────────────── */

describe("SignaturesService.save: happy path", () => {
  it("saves a premium owner signature and returns { saved, sha256 }", async () => {
    const svc = makeService();
    const result = await svc.save(validSaveInput);
    expect(result).toEqual({ saved: true, sha256: "a".repeat(64) });
  });

  it("hasSignature() returns true after save", async () => {
    const svc = makeService();
    await svc.save(validSaveInput);
    expect(await svc.hasSignature(AGREEMENT_ID, "owner")).toBe(true);
  });

  it("hasBothSignatures() is false after only owner saves", async () => {
    const svc = makeService();
    await svc.save(validSaveInput);
    expect(await svc.hasBothSignatures(AGREEMENT_ID)).toBe(false);
  });

  it("hasBothSignatures() is true after both owner + tenant save", async () => {
    const svc = makeService();
    await svc.save(validSaveInput);
    await svc.save({ ...validSaveInput, party: "tenant" });
    expect(await svc.hasBothSignatures(AGREEMENT_ID)).toBe(true);
  });

  it("count() reflects number of saved parties per agreement", async () => {
    const svc = makeService();
    expect(await svc.count(AGREEMENT_ID)).toBe(0);
    await svc.save(validSaveInput);
    expect(await svc.count(AGREEMENT_ID)).toBe(1);
    await svc.save({ ...validSaveInput, party: "tenant" });
    expect(await svc.count(AGREEMENT_ID)).toBe(2);
  });

  it("isolates signatures per agreement_id", async () => {
    const svc = makeService();
    await svc.save(validSaveInput);
    expect(await svc.hasSignature("other-agreement", "owner")).toBe(false);
    expect(await svc.count("other-agreement")).toBe(0);
  });
});

/* ─── Upsert semantics ─────────────────────────────────────────────────── */

describe("SignaturesService.save: upsert per (agreement, party)", () => {
  it("second save for same (agreement, party) replaces the first (still count=1)", async () => {
    const svc = makeService();
    await svc.save(validSaveInput);
    await svc.save({ ...validSaveInput, method: "upload" });
    expect(await svc.count(AGREEMENT_ID)).toBe(1);
  });

  it("second save updates sha256 to the new guard result", async () => {
    let call = 0;
    const guard = vi.fn(async () => ({
      bytes: Buffer.from("x"),
      contentType: "image/png" as const,
      sha256: call++ === 0 ? "a".repeat(64) : "b".repeat(64)
    }));
    const svc = makeService({ guard });
    const first = await svc.save(validSaveInput);
    const second = await svc.save(validSaveInput);
    expect(first.sha256).toBe("a".repeat(64));
    expect(second.sha256).toBe("b".repeat(64));
  });
});

/* ─── Party + method validation ────────────────────────────────────────── */

describe("SignaturesService.save: party + method validation", () => {
  it("rejects invalid party with RENT_AGREEMENT_SIGNATURE_INVALID_PARTY", async () => {
    const svc = makeService();
    await expect(
      svc.save({ ...validSaveInput, party: "witness" as unknown as "owner" })
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_SIGNATURE_INVALID_PARTY" });
  });

  it("rejects invalid method with RENT_AGREEMENT_SIGNATURE_INVALID_METHOD", async () => {
    const svc = makeService();
    await expect(
      svc.save({ ...validSaveInput, method: "fax" as unknown as "canvas" })
    ).rejects.toMatchObject({ code: "RENT_AGREEMENT_SIGNATURE_INVALID_METHOD" });
  });

  it("accepts method='upload'", async () => {
    const svc = makeService();
    await expect(svc.save({ ...validSaveInput, method: "upload" })).resolves.toBeDefined();
  });

  it("accepts party='tenant'", async () => {
    const svc = makeService();
    await expect(svc.save({ ...validSaveInput, party: "tenant" })).resolves.toBeDefined();
  });
});

/* ─── Plan-tier gate ───────────────────────────────────────────────────── */

describe("SignaturesService.save: plan gate", () => {
  it("rejects plan='basic' with RENT_AGREEMENT_SIGNATURE_NOT_PREMIUM", async () => {
    const svc = makeService();
    await expect(svc.save({ ...validSaveInput, plan: "basic" })).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_NOT_PREMIUM"
    });
  });

  it("rejects plan='standard' with RENT_AGREEMENT_SIGNATURE_NOT_PREMIUM", async () => {
    const svc = makeService();
    await expect(svc.save({ ...validSaveInput, plan: "standard" })).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_NOT_PREMIUM"
    });
  });

  it("does NOT call the image guard when plan gate fails (fast path)", async () => {
    const guard = vi.fn();
    const svc = makeService({ guard: guard as never });
    await expect(svc.save({ ...validSaveInput, plan: "basic" })).rejects.toBeDefined();
    expect(guard).not.toHaveBeenCalled();
  });
});

/* ─── Guard error pass-through ─────────────────────────────────────────── */

describe("SignaturesService.save: guard errors bubble up", () => {
  it("propagates BAD_MAGIC_BYTES from the guard with the same code", async () => {
    const guard = vi.fn(async () => {
      throw new SignatureGuardError("RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES", "magic mismatch");
    });
    const svc = makeService({ guard });
    await expect(svc.save(validSaveInput)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES"
    });
  });

  it("propagates TOO_LARGE_RAW from the guard with the same code", async () => {
    const guard = vi.fn(async () => {
      throw new SignatureGuardError("RENT_AGREEMENT_SIGNATURE_TOO_LARGE_RAW", "too big");
    });
    const svc = makeService({ guard });
    await expect(svc.save(validSaveInput)).rejects.toMatchObject({
      code: "RENT_AGREEMENT_SIGNATURE_TOO_LARGE_RAW"
    });
  });

  it("does not persist anything when the guard rejects", async () => {
    const guard = vi.fn(async () => {
      throw new SignatureGuardError("RENT_AGREEMENT_SIGNATURE_BAD_MAGIC_BYTES", "x");
    });
    const svc = makeService({ guard });
    await expect(svc.save(validSaveInput)).rejects.toBeDefined();
    expect(await svc.hasSignature(AGREEMENT_ID, "owner")).toBe(false);
    expect(await svc.count(AGREEMENT_ID)).toBe(0);
  });
});

describe("SignaturesService.listForAgreement (Phase 13: PDF renderer projection)", () => {
  it("returns empty array when no signatures saved", async () => {
    const svc = makeService();
    expect(await svc.listForAgreement("agr-none")).toEqual([]);
  });

  it("returns owner + tenant projections with party, content_type, image_bytes", async () => {
    const svc = makeService();
    await svc.save(validSaveInput);
    await svc.save({ ...validSaveInput, party: "tenant" });
    const list = await svc.listForAgreement(AGREEMENT_ID);
    expect(list).toHaveLength(2);
    const owner = list.find((s) => s.party === "owner");
    const tenant = list.find((s) => s.party === "tenant");
    expect(owner?.content_type).toBe("image/png");
    expect(tenant?.content_type).toBe("image/png");
    expect(Buffer.isBuffer(owner?.image_bytes)).toBe(true);
  });

  it("scopes by agreement_id (does not leak other agreements' sigs)", async () => {
    const svc = makeService();
    await svc.save(validSaveInput);
    expect(await svc.listForAgreement("other-agreement")).toEqual([]);
  });
});
