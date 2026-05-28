import { describe, expect, it } from "vitest";

import { InMemoryDraftsRepository } from "../../drafts/drafts.repository";
import { blankRow } from "../../drafts/step-row.mapper";
import type { RentAgreementRow } from "../../drafts/draft-summary.mapper";

function makeRow(overrides: Partial<RentAgreementRow> = {}): RentAgreementRow {
  const row = blankRow({
    id: overrides.id ?? "agreement-1",
    userId: overrides.user_id ?? "user-1",
    planId: "basic",
    locale: "en",
    idempotencyKey: overrides.idempotency_key ?? "idem-1",
    timestamp: "2026-05-21T09:00:00.000Z"
  });
  return { ...row, ...overrides };
}

describe("InMemoryDraftsRepository", () => {
  it("insert then findById returns the row", async () => {
    const repo = new InMemoryDraftsRepository();
    const row = makeRow();
    await repo.insert(row);
    const found = await repo.findById("agreement-1");
    expect(found).not.toBeNull();
    expect(found?.id).toBe("agreement-1");
  });

  it("findById returns a distinct object (no shared reference)", async () => {
    const repo = new InMemoryDraftsRepository();
    const row = makeRow();
    await repo.insert(row);
    const a = await repo.findById("agreement-1");
    const b = await repo.findById("agreement-1");
    expect(a).not.toBe(b);
    expect(a).not.toBe(row);
  });

  it("mutating a returned row does not affect stored state", async () => {
    const repo = new InMemoryDraftsRepository();
    await repo.insert(makeRow());
    const loaded = await repo.findById("agreement-1");
    loaded!.current_step = 5;
    loaded!.step_validated_at["1"] = "mutated";
    const reloaded = await repo.findById("agreement-1");
    expect(reloaded?.current_step).toBe(1);
    expect(reloaded?.step_validated_at).toEqual({});
  });

  it("findByIdempotency returns the row for (userId, key) and null otherwise", async () => {
    const repo = new InMemoryDraftsRepository();
    await repo.insert(makeRow({ user_id: "user-1", idempotency_key: "idem-1" }));
    expect(await repo.findByIdempotency("user-1", "idem-1")).not.toBeNull();
    expect(await repo.findByIdempotency("user-1", "other")).toBeNull();
    expect(await repo.findByIdempotency("user-2", "idem-1")).toBeNull();
  });

  it("duplicate insert with the same (userId, key) is a no-op", async () => {
    const repo = new InMemoryDraftsRepository();
    await repo.insert(makeRow({ id: "agreement-1", current_step: 1 }));
    await repo.insert(makeRow({ id: "agreement-2", current_step: 7 }));
    const found = await repo.findByIdempotency("user-1", "idem-1");
    expect(found?.id).toBe("agreement-1");
    expect(await repo.findById("agreement-2")).toBeNull();
  });

  it("findByUser filters by user_id", async () => {
    const repo = new InMemoryDraftsRepository();
    await repo.insert(makeRow({ id: "a1", user_id: "user-1", idempotency_key: "k1" }));
    await repo.insert(makeRow({ id: "a2", user_id: "user-1", idempotency_key: "k2" }));
    await repo.insert(makeRow({ id: "a3", user_id: "user-2", idempotency_key: "k3" }));
    const rows = await repo.findByUser("user-1");
    expect(rows.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });

  it("save overwrites an existing row", async () => {
    const repo = new InMemoryDraftsRepository();
    await repo.insert(makeRow());
    const row = await repo.findById("agreement-1");
    row!.current_step = 4;
    row!.status = "pending_payment";
    await repo.save(row!);
    const reloaded = await repo.findById("agreement-1");
    expect(reloaded?.current_step).toBe(4);
    expect(reloaded?.status).toBe("pending_payment");
  });

  it("findById returns null for an unknown id", async () => {
    const repo = new InMemoryDraftsRepository();
    expect(await repo.findById("nope")).toBeNull();
  });
});
