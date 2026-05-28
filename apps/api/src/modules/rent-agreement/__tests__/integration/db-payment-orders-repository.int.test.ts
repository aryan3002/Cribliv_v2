import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../../common/database.service";
import { DbDraftsRepository } from "../../drafts/drafts.repository";
import { DbPaymentOrdersRepository } from "../../checkout/payment-orders.repository";
import { blankRow } from "../../drafts/step-row.mapper";
import type { PaymentOrderRow } from "../../checkout/checkout.service";

config({ path: resolve(__dirname, "../../../../../../../.env") });

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("DbPaymentOrdersRepository (integration)", () => {
  let db: DatabaseService;
  let repo: DbPaymentOrdersRepository;
  let testUserId: string;
  let agreementId: string;
  const TEST_PHONE = "+919000000079";

  beforeAll(async () => {
    db = new DatabaseService();
    repo = new DbPaymentOrdersRepository(db);
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
      // Deleting the agreement cascades to rent_agreement_payment_orders via the
      // draft_id ON DELETE CASCADE FK.
      await db.query(`DELETE FROM rent_agreements WHERE user_id = $1`, [testUserId]);
      await db.query(`DELETE FROM users WHERE id = $1`, [testUserId]);
    }
    await db.onModuleDestroy();
  });

  function makeOrder(overrides: Partial<PaymentOrderRow> = {}): PaymentOrderRow {
    const id = overrides.id ?? randomUUID();
    return {
      id,
      user_id: testUserId,
      draft_id: agreementId,
      provider: overrides.provider ?? "razorpay",
      idempotency_key: overrides.idempotency_key ?? `idem-${id}`,
      provider_order_id: overrides.provider_order_id ?? `prov-${id}`,
      provider_payment_id: overrides.provider_payment_id ?? null,
      amount_paise: overrides.amount_paise ?? 199900,
      status: overrides.status ?? "pending_payment",
      metadata:
        overrides.metadata ?? ({ purpose: "rent_agreement" } as PaymentOrderRow["metadata"]),
      created_at: overrides.created_at ?? new Date().toISOString()
    };
  }

  it("insert then findById round-trips, including jsonb metadata", async () => {
    const order = makeOrder();
    await repo.insert(order);
    const found = await repo.findById(order.id);
    expect(found?.amount_paise).toBe(199900);
    expect(found?.status).toBe("pending_payment");
    expect(found?.metadata).toEqual({ purpose: "rent_agreement" });
  });

  it("insert is idempotent on (user_id, idempotency_key)", async () => {
    const key = `idem-dup-${randomUUID()}`;
    const first = makeOrder({ idempotency_key: key });
    await repo.insert(first);
    await repo.insert(makeOrder({ idempotency_key: key }));
    expect((await repo.findByIdempotency(testUserId, key))?.id).toBe(first.id);
  });

  it("findByProviderOrderId locates the order", async () => {
    const order = makeOrder({ provider_order_id: `prov-find-${randomUUID()}` });
    await repo.insert(order);
    const found = await repo.findByProviderOrderId(order.provider_order_id);
    expect(found?.id).toBe(order.id);
  });

  it("markPaid settles the order with a provider_payment_id", async () => {
    const order = makeOrder();
    await repo.insert(order);
    await repo.markPaid(order.id, `mock_pay_${order.id}`);
    const found = await repo.findById(order.id);
    expect(found?.status).toBe("paid");
    expect(found?.provider_payment_id).toBe(`mock_pay_${order.id}`);
  });

  it("an agreement can be linked to its payment order via payment_order_id (FK 0030)", async () => {
    const order = makeOrder();
    await repo.insert(order);
    const draftsRepo = new DbDraftsRepository(db);
    const agreement = await draftsRepo.findById(agreementId);
    expect(agreement).not.toBeNull();
    agreement!.payment_order_id = order.id;
    agreement!.status = "pending_payment";
    // Would throw a foreign-key violation if the FK still pointed at the generic
    // payment_orders table.
    await expect(draftsRepo.save(agreement!)).resolves.toBeUndefined();
    const reloaded = await draftsRepo.findById(agreementId);
    expect(reloaded?.payment_order_id).toBe(order.id);
  });
});
