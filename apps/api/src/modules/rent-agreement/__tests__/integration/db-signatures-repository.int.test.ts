import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../../common/database.service";
import { DbDraftsRepository } from "../../drafts/drafts.repository";
import { DbSignaturesRepository, type SignatureRow } from "../../signatures/signatures.repository";
import { blankRow } from "../../drafts/step-row.mapper";

config({ path: resolve(__dirname, "../../../../../../../.env") });

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("DbSignaturesRepository (integration)", () => {
  let db: DatabaseService;
  let repo: DbSignaturesRepository;
  let testUserId: string;
  let agreementId: string;
  const TEST_PHONE = "+919000000058";

  beforeAll(async () => {
    db = new DatabaseService();
    repo = new DbSignaturesRepository(db);
    const user = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'tenant', 'en')
       ON CONFLICT (phone_e164) DO UPDATE SET role = 'tenant'
       RETURNING id::text`,
      [TEST_PHONE]
    );
    testUserId = user.rows[0].id;

    agreementId = randomUUID();
    await new DbDraftsRepository(db).insert(
      blankRow({
        id: agreementId,
        userId: testUserId,
        planId: "premium",
        locale: "en",
        idempotencyKey: `idem-${agreementId}`,
        timestamp: new Date().toISOString()
      })
    );
  });

  afterAll(async () => {
    if (testUserId) {
      await db.query(`DELETE FROM rent_agreements WHERE user_id = $1`, [testUserId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    }
    await db.onModuleDestroy();
  });

  function sig(party: "owner" | "tenant", sha: string): SignatureRow {
    return {
      id: randomUUID(),
      agreement_id: agreementId,
      party,
      method: "canvas",
      content_type: "image/png",
      image_bytes: Buffer.from([10, 20, 30, 40]),
      sha256: sha,
      created_at: new Date().toISOString()
    };
  }

  it("upsert then getByAgreementAndParty round-trips bytea", async () => {
    await repo.upsert(sig("owner", "owner-hash"));
    const found = await repo.getByAgreementAndParty(agreementId, "owner");
    expect(found?.sha256).toBe("owner-hash");
    expect(Buffer.isBuffer(found?.image_bytes)).toBe(true);
    expect(Array.from(found?.image_bytes ?? [])).toEqual([10, 20, 30, 40]);
  });

  it("upsert on the same (agreement, party) replaces the row", async () => {
    await repo.upsert(sig("owner", "first"));
    await repo.upsert(sig("owner", "second"));
    const found = await repo.getByAgreementAndParty(agreementId, "owner");
    expect(found?.sha256).toBe("second");
    expect(
      (await repo.listForAgreement(agreementId)).filter((r) => r.party === "owner")
    ).toHaveLength(1);
  });

  it("listForAgreement returns owner + tenant", async () => {
    await repo.upsert(sig("owner", "o"));
    await repo.upsert(sig("tenant", "t"));
    const rows = await repo.listForAgreement(agreementId);
    expect(rows.map((r) => r.party).sort()).toEqual(["owner", "tenant"]);
  });
});
