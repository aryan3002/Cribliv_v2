import { describe, expect, it } from "vitest";

import { MockEStampingProvider } from "../../e-stamping/mock-e-stamping.provider";

describe("MockEStampingProvider.issue", () => {
  it("returns a deterministic reference_id derived from agreementId + counter", async () => {
    const p = new MockEStampingProvider({
      clock: () => new Date("2026-05-19T10:00:00Z")
    });
    const r1 = await p.issue({ agreementId: "agr-1", amountPaise: 30000, stateCode: "KA" });
    const r2 = await p.issue({ agreementId: "agr-2", amountPaise: 30000, stateCode: "KA" });
    expect(r1.referenceId).toBe("MOCK-ESTAMP-1-agr-1");
    expect(r2.referenceId).toBe("MOCK-ESTAMP-2-agr-2");
    expect(r1.issuedAt.toISOString()).toBe("2026-05-19T10:00:00.000Z");
    expect(r1.status).toBe("issued");
  });

  it("subsequent issue() for same agreement returns the SAME reference (idempotent)", async () => {
    const p = new MockEStampingProvider();
    const r1 = await p.issue({ agreementId: "agr-1", amountPaise: 30000, stateCode: "KA" });
    const r2 = await p.issue({ agreementId: "agr-1", amountPaise: 30000, stateCode: "KA" });
    expect(r1.referenceId).toBe(r2.referenceId);
  });
});

describe("MockEStampingProvider.status", () => {
  it("returns 'issued' for a previously-issued reference", async () => {
    const p = new MockEStampingProvider();
    const issued = await p.issue({ agreementId: "agr-1", amountPaise: 30000, stateCode: "KA" });
    const s = await p.status(issued.referenceId);
    expect(s?.status).toBe("issued");
    expect(s?.referenceId).toBe(issued.referenceId);
  });

  it("returns null for unknown reference", async () => {
    const p = new MockEStampingProvider();
    expect(await p.status("nope")).toBeNull();
  });
});
