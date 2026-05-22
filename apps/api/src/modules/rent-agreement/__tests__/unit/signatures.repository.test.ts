import { describe, expect, it } from "vitest";

import {
  InMemorySignaturesRepository,
  type SignatureRow
} from "../../signatures/signatures.repository";

function makeRow(overrides: Partial<SignatureRow> = {}): SignatureRow {
  return {
    id: overrides.id ?? "sig-1",
    agreement_id: overrides.agreement_id ?? "agr-1",
    party: overrides.party ?? "owner",
    method: overrides.method ?? "canvas",
    content_type: overrides.content_type ?? "image/png",
    image_bytes: overrides.image_bytes ?? Buffer.from([1, 2, 3]),
    sha256: overrides.sha256 ?? "hash-1",
    created_at: overrides.created_at ?? "2026-05-21T09:00:00.000Z"
  };
}

describe("InMemorySignaturesRepository", () => {
  it("upsert then getByAgreementAndParty returns the row", async () => {
    const repo = new InMemorySignaturesRepository();
    await repo.upsert(makeRow({ party: "owner" }));
    const found = await repo.getByAgreementAndParty("agr-1", "owner");
    expect(found?.sha256).toBe("hash-1");
  });

  it("getByAgreementAndParty returns null when absent", async () => {
    const repo = new InMemorySignaturesRepository();
    expect(await repo.getByAgreementAndParty("agr-1", "tenant")).toBeNull();
  });

  it("upsert on the same (agreement, party) replaces the row", async () => {
    const repo = new InMemorySignaturesRepository();
    await repo.upsert(makeRow({ party: "owner", sha256: "first" }));
    await repo.upsert(makeRow({ party: "owner", sha256: "second" }));
    const found = await repo.getByAgreementAndParty("agr-1", "owner");
    expect(found?.sha256).toBe("second");
  });

  it("listForAgreement returns all rows for the agreement", async () => {
    const repo = new InMemorySignaturesRepository();
    await repo.upsert(makeRow({ id: "s1", party: "owner" }));
    await repo.upsert(makeRow({ id: "s2", party: "tenant" }));
    await repo.upsert(makeRow({ id: "s3", agreement_id: "agr-2", party: "owner" }));
    const rows = await repo.listForAgreement("agr-1");
    expect(rows.map((r) => r.party).sort()).toEqual(["owner", "tenant"]);
  });

  it("returns distinct objects (no shared reference with stored state)", async () => {
    const repo = new InMemorySignaturesRepository();
    await repo.upsert(makeRow());
    const a = await repo.getByAgreementAndParty("agr-1", "owner");
    const b = await repo.getByAgreementAndParty("agr-1", "owner");
    expect(a).not.toBe(b);
  });
});
