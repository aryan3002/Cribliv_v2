import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../../common/database.service";
import { DbDraftsRepository } from "../../drafts/drafts.repository";
import { blankRow } from "../../drafts/step-row.mapper";
import type { RentAgreementRow } from "../../drafts/draft-summary.mapper";

// Loads the repo-root .env so DATABASE_URL is available when running the suite
// directly (vitest does not load it otherwise).
config({ path: resolve(__dirname, "../../../../../../../.env") });

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("DbDraftsRepository (integration)", () => {
  let db: DatabaseService;
  let repo: DbDraftsRepository;
  let testUserId: string;
  const TEST_PHONE = "+919000000028";

  beforeAll(async () => {
    db = new DatabaseService();
    repo = new DbDraftsRepository(db);
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'tenant', 'en')
       ON CONFLICT (phone_e164) DO UPDATE SET role = 'tenant'
       RETURNING id::text`,
      [TEST_PHONE]
    );
    testUserId = user.rows[0].id;
  });

  afterAll(async () => {
    if (testUserId) {
      await db.query(`DELETE FROM rent_agreements WHERE user_id = $1`, [testUserId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    }
    await db.onModuleDestroy();
  });

  function makeRow(overrides: Partial<RentAgreementRow> = {}): RentAgreementRow {
    const id = overrides.id ?? randomUUID();
    const row = blankRow({
      id,
      userId: testUserId,
      planId: "basic",
      locale: "en",
      idempotencyKey: overrides.idempotency_key ?? `idem-${id}`,
      timestamp: new Date().toISOString()
    });
    return { ...row, ...overrides, id, user_id: testUserId };
  }

  it("insert then findById round-trips the row", async () => {
    const row = makeRow({
      owner_full_name: "Integration Owner",
      rent_amount_paise: 2500000,
      inventory_items: [{ item: "Fan", quantity: 1, condition: "good" }],
      additional_terms: ["term-a"]
    });
    await repo.insert(row);

    const found = await repo.findById(row.id);
    expect(found).not.toBeNull();
    expect(found?.owner_full_name).toBe("Integration Owner");
    expect(found?.rent_amount_paise).toBe(2500000);
    expect(found?.inventory_items).toEqual([{ item: "Fan", quantity: 1, condition: "good" }]);
    expect(found?.additional_terms).toEqual(["term-a"]);
    expect(found?.status).toBe("draft");
  });

  it("insert is idempotent on (user_id, idempotency_key)", async () => {
    const key = `idem-dup-${randomUUID()}`;
    const first = makeRow({ idempotency_key: key, current_step: 1 });
    await repo.insert(first);
    const second = makeRow({ idempotency_key: key, current_step: 5 });
    await repo.insert(second);

    const found = await repo.findByIdempotency(testUserId, key);
    expect(found?.id).toBe(first.id);
    expect(found?.current_step).toBe(1);
    expect(await repo.findById(second.id)).toBeNull();
  });

  it("save updates an existing row", async () => {
    const row = makeRow();
    await repo.insert(row);

    const loaded = await repo.findById(row.id);
    loaded!.current_step = 4;
    loaded!.status = "pending_payment";
    loaded!.step_validated_at = { "1": new Date().toISOString() };
    await repo.save(loaded!);

    const reloaded = await repo.findById(row.id);
    expect(reloaded?.current_step).toBe(4);
    expect(reloaded?.status).toBe("pending_payment");
    expect(Object.keys(reloaded?.step_validated_at ?? {})).toEqual(["1"]);
  });

  it("findByUser returns the test user's agreements", async () => {
    const rows = await repo.findByUser(testUserId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.user_id === testUserId)).toBe(true);
  });
});
