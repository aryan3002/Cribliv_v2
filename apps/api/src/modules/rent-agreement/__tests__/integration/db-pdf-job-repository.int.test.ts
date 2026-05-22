import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../../common/database.service";
import { DbDraftsRepository } from "../../drafts/drafts.repository";
import { DbPdfJobRepository } from "../../pdf/pdf-job.repository";
import { blankRow } from "../../drafts/step-row.mapper";

config({ path: resolve(__dirname, "../../../../../../../.env") });

const HAS_DB = Boolean(process.env.DATABASE_URL);
const MAX = 5;

describe.skipIf(!HAS_DB)("DbPdfJobRepository (integration)", () => {
  let db: DatabaseService;
  let repo: DbPdfJobRepository;
  let testUserId: string;
  let agreementId: string;
  const TEST_PHONE = "+919000000068";

  beforeAll(async () => {
    db = new DatabaseService();
    repo = new DbPdfJobRepository(db);
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
        planId: "basic",
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

  it("enqueue + dequeue + markDone round-trips a job", async () => {
    const now = new Date();
    const enq = await repo.enqueue({ agreementId, now, maxAttempts: MAX });
    expect(enq.alreadyEnqueued).toBe(false);

    const dup = await repo.enqueue({ agreementId, now, maxAttempts: MAX });
    expect(dup.alreadyEnqueued).toBe(true);
    expect(dup.jobId).toBe(enq.jobId);

    const claimed = await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    expect(claimed?.id).toBe(enq.jobId);
    expect(claimed?.status).toBe("processing");
    expect(claimed?.attempts).toBe(1);

    // Locked — a second dequeue at the same instant finds nothing.
    expect(await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 })).toBeNull();

    await repo.markDone(enq.jobId, new Date());
    const done = await repo.getById(enq.jobId);
    expect(done?.status).toBe("done");
  });

  it("markFailed sets status + last_error", async () => {
    const now = new Date();
    const enq = await repo.enqueue({ agreementId, now, maxAttempts: MAX });
    await repo.dequeue({ now, maxAttempts: MAX, lockMs: 120000 });
    await repo.markFailed(enq.jobId, "render boom", new Date(now.getTime() + 60000));
    const job = await repo.getById(enq.jobId);
    expect(job?.status).toBe("failed");
    expect(job?.last_error).toBe("render boom");
  });
});
