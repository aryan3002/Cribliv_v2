import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadsService } from "../../downloads/downloads.service";
import { InMemorySasIssuer } from "../../downloads/in-memory-sas-issuer";
import type { AgreementDownloadView, AgreementStatus } from "../../downloads/downloads.service";

function generatedAgreement(over: Partial<AgreementDownloadView> = {}): AgreementDownloadView {
  return {
    id: "aaaa-bbbb-cccc",
    user_id: "user-1",
    status: "generated",
    pdf_blob_path: "2026/05/aaaa-bbbb-cccc.pdf",
    download_count: 0,
    max_downloads: 5,
    expires_at: new Date("2027-05-19T10:00:00.000Z"),
    ...over
  };
}

interface FakeDeps {
  load: ReturnType<typeof vi.fn>;
  inc: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
  clock: () => Date;
  ipSalt: string;
  sasTtlSeconds: number;
}

function makeService(over: Partial<FakeDeps> = {}) {
  const now = new Date("2026-05-19T10:00:00.000Z");
  const load = over.load ?? vi.fn().mockResolvedValue(generatedAgreement());
  const inc = over.inc ?? vi.fn().mockResolvedValue(undefined);
  const audit = over.audit ?? vi.fn().mockResolvedValue(undefined);
  const service = new DownloadsService({
    sasIssuer: new InMemorySasIssuer(),
    loadAgreementForDownload: load,
    incrementDownloadCount: inc,
    recordDownloadAudit: audit,
    clock: over.clock ?? (() => now),
    ipSalt: over.ipSalt ?? "test-salt",
    sasTtlSeconds: over.sasTtlSeconds ?? 3600
  });
  return { service, load, inc, audit, now };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DownloadsService.claim — happy path", () => {
  it("returns sas_url, expires_at, and remaining when agreement is generated and under quota", async () => {
    const { service } = makeService();
    const result = await service.claim({
      agreementId: "aaaa-bbbb-cccc",
      userId: "user-1",
      ip: "203.0.113.42",
      userAgent: "vitest"
    });

    expect(result.sasUrl).toMatch(/^stub:\/\/blob\/2026\/05\/aaaa-bbbb-cccc\.pdf\?token=/);
    expect(result.expiresAt.toISOString()).toBe("2026-05-19T11:00:00.000Z");
    expect(result.remaining).toBe(4); // max=5, count=0 before claim, +1 after = 4 left
  });
});

describe("DownloadsService.claim — error paths per [[API-Contract]] §B3", () => {
  it("throws RENT_AGREEMENT_NOT_FOUND when load returns null", async () => {
    const { service } = makeService({ load: vi.fn().mockResolvedValue(null) });
    try {
      await service.claim({
        agreementId: "missing",
        userId: "user-1",
        ip: "1.1.1.1",
        userAgent: null
      });
      throw new Error("should not reach");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_NOT_FOUND");
    }
  });

  it("throws RENT_AGREEMENT_PDF_NOT_READY when status is not 'generated'", async () => {
    const cases: AgreementStatus[] = ["draft", "pending_payment", "paid", "queued", "generating"];
    for (const status of cases) {
      const { service } = makeService({
        load: vi.fn().mockResolvedValue(generatedAgreement({ status, pdf_blob_path: null }))
      });
      try {
        await service.claim({ agreementId: "x", userId: "user-1", ip: "1.1.1.1", userAgent: null });
        throw new Error(`should not reach for status=${status}`);
      } catch (err) {
        expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_PDF_NOT_READY");
      }
    }
  });

  it("throws RENT_AGREEMENT_PDF_NOT_READY when status is 'generated' but pdf_blob_path is null", async () => {
    const { service } = makeService({
      load: vi
        .fn()
        .mockResolvedValue(generatedAgreement({ status: "generated", pdf_blob_path: null }))
    });
    try {
      await service.claim({ agreementId: "x", userId: "user-1", ip: "1.1.1.1", userAgent: null });
      throw new Error("should not reach");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_PDF_NOT_READY");
    }
  });

  it("throws RENT_AGREEMENT_REFUNDED when status is 'refunded'", async () => {
    const { service } = makeService({
      load: vi.fn().mockResolvedValue(generatedAgreement({ status: "refunded" }))
    });
    try {
      await service.claim({ agreementId: "x", userId: "user-1", ip: "1.1.1.1", userAgent: null });
      throw new Error("should not reach");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_REFUNDED");
    }
  });

  it("throws RENT_AGREEMENT_EXPIRED when expires_at <= now", async () => {
    const now = new Date("2026-05-19T10:00:00.000Z");
    const { service } = makeService({
      clock: () => now,
      load: vi
        .fn()
        .mockResolvedValue(generatedAgreement({ expires_at: new Date("2026-05-19T09:59:59.000Z") }))
    });
    try {
      await service.claim({ agreementId: "x", userId: "user-1", ip: "1.1.1.1", userAgent: null });
      throw new Error("should not reach");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_EXPIRED");
    }
  });

  it("throws RENT_AGREEMENT_EXPIRED when status is 'expired' (even if expires_at is null)", async () => {
    const { service } = makeService({
      load: vi.fn().mockResolvedValue(generatedAgreement({ status: "expired", expires_at: null }))
    });
    try {
      await service.claim({ agreementId: "x", userId: "user-1", ip: "1.1.1.1", userAgent: null });
      throw new Error("should not reach");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_EXPIRED");
    }
  });

  it("throws RENT_AGREEMENT_DOWNLOAD_LIMIT_REACHED when download_count >= max_downloads", async () => {
    const { service } = makeService({
      load: vi.fn().mockResolvedValue(generatedAgreement({ download_count: 5, max_downloads: 5 }))
    });
    try {
      await service.claim({ agreementId: "x", userId: "user-1", ip: "1.1.1.1", userAgent: null });
      throw new Error("should not reach");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_DOWNLOAD_LIMIT_REACHED");
    }
  });

  it("does NOT call inc/audit/sasIssuer when any precondition fails", async () => {
    const sasIssuer = { issue: vi.fn() };
    const inc = vi.fn();
    const audit = vi.fn();
    const service = new DownloadsService({
      sasIssuer,
      loadAgreementForDownload: vi
        .fn()
        .mockResolvedValue(generatedAgreement({ download_count: 5, max_downloads: 5 })),
      incrementDownloadCount: inc,
      recordDownloadAudit: audit,
      ipSalt: "test-salt"
    });
    await expect(
      service.claim({ agreementId: "x", userId: "user-1", ip: "1.1.1.1", userAgent: null })
    ).rejects.toThrow();
    expect(sasIssuer.issue).not.toHaveBeenCalled();
    expect(inc).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("DownloadsService.claim — audit + counter contracts", () => {
  it("calls incrementDownloadCount exactly once with the agreement id", async () => {
    const inc = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService({ inc });
    await service.claim({
      agreementId: "aaaa-bbbb-cccc",
      userId: "user-1",
      ip: "203.0.113.42",
      userAgent: "vitest"
    });
    expect(inc).toHaveBeenCalledTimes(1);
    expect(inc).toHaveBeenCalledWith("aaaa-bbbb-cccc");
  });

  it("calls recordDownloadAudit with hashed IP (never the raw IP)", async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService({ audit, ipSalt: "salt-X" });
    await service.claim({
      agreementId: "aaaa-bbbb-cccc",
      userId: "user-1",
      ip: "203.0.113.42",
      userAgent: "vitest"
    });
    expect(audit).toHaveBeenCalledTimes(1);
    const record = audit.mock.calls[0][0];
    expect(record.ip_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.ip_hash).not.toContain("203.0.113.42");
    expect(record.agreement_id).toBe("aaaa-bbbb-cccc");
    expect(record.user_agent).toBe("vitest");
  });

  it("audit.sas_expires_at matches the issuer's expiresAt", async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService({ audit, sasTtlSeconds: 1800 });
    const result = await service.claim({
      agreementId: "aaaa-bbbb-cccc",
      userId: "user-1",
      ip: "1.1.1.1",
      userAgent: null
    });
    const record = audit.mock.calls[0][0];
    expect(record.sas_expires_at.toISOString()).toBe(result.expiresAt.toISOString());
  });

  it("propagates audit failure to caller — partial state (counter incremented, audit lost) is acceptable for in-memory phase", async () => {
    // Phase 13 will wrap inc + audit in a single DB transaction. For now, document the
    // exposed gap as a passing test on the current behavior so the Phase 13 wrap is
    // an explicit improvement.
    const inc = vi.fn().mockResolvedValue(undefined);
    const audit = vi.fn().mockRejectedValue(new Error("db down"));
    const { service } = makeService({ inc, audit });
    await expect(
      service.claim({
        agreementId: "aaaa-bbbb-cccc",
        userId: "user-1",
        ip: "1.1.1.1",
        userAgent: null
      })
    ).rejects.toThrow("db down");
    expect(inc).toHaveBeenCalledTimes(1);
  });

  it("remaining reflects the post-increment count", async () => {
    const { service } = makeService({
      load: vi.fn().mockResolvedValue(generatedAgreement({ download_count: 3, max_downloads: 5 }))
    });
    const result = await service.claim({
      agreementId: "x",
      userId: "user-1",
      ip: "1.1.1.1",
      userAgent: null
    });
    expect(result.remaining).toBe(1); // 5 - (3 + 1) = 1
  });

  it("never logs or returns the raw IP", async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const { service } = makeService({ audit });
    const result = await service.claim({
      agreementId: "x",
      userId: "user-1",
      ip: "203.0.113.42",
      userAgent: "vitest"
    });
    expect(JSON.stringify(result)).not.toContain("203.0.113.42");
    expect(JSON.stringify(audit.mock.calls)).not.toContain("203.0.113.42");
  });
});
