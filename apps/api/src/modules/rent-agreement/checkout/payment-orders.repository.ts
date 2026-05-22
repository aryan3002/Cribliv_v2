// Storage port for rent-agreement payment orders. `CheckoutService` keeps the
// order state machine + idempotency rules; row persistence flows through here.
//
// Two implementations: `InMemoryPaymentOrdersRepository` and
// `DbPaymentOrdersRepository` (table `rent_agreement_payment_orders`, migration
// 0029). The payment *provider* is dev-based for now, but orders persist with the
// exact production shape — attaching a real provider later is a provider swap only.

import type { DatabaseService } from "../../../common/database.service";
import type { PaymentOrderRow } from "./checkout.service";

export interface PaymentOrdersRepository {
  /** Insert a new order. No-op if (user_id, idempotency_key) already exists. */
  insert(row: PaymentOrderRow): Promise<void>;
  findById(id: string): Promise<PaymentOrderRow | null>;
  findByIdempotency(userId: string, idempotencyKey: string): Promise<PaymentOrderRow | null>;
  findByProviderOrderId(providerOrderId: string): Promise<PaymentOrderRow | null>;
  /** Settle an order: status -> 'paid', record the provider payment id. */
  markPaid(orderId: string, providerPaymentId: string): Promise<void>;
}

function cloneRow(row: PaymentOrderRow): PaymentOrderRow {
  return { ...row, metadata: { ...row.metadata } };
}

export class InMemoryPaymentOrdersRepository implements PaymentOrdersRepository {
  private readonly rows = new Map<string, PaymentOrderRow>();
  private readonly idemIndex = new Map<string, string>();
  private readonly providerOrderIndex = new Map<string, string>();

  private idemKey(userId: string, idempotencyKey: string): string {
    return `${userId}|${idempotencyKey}`;
  }

  async insert(row: PaymentOrderRow): Promise<void> {
    const key = this.idemKey(row.user_id, row.idempotency_key);
    if (this.idemIndex.has(key)) return;
    this.rows.set(row.id, cloneRow(row));
    this.idemIndex.set(key, row.id);
    this.providerOrderIndex.set(row.provider_order_id, row.id);
  }

  async findById(id: string): Promise<PaymentOrderRow | null> {
    const row = this.rows.get(id);
    return row ? cloneRow(row) : null;
  }

  async findByIdempotency(userId: string, idempotencyKey: string): Promise<PaymentOrderRow | null> {
    const id = this.idemIndex.get(this.idemKey(userId, idempotencyKey));
    return id ? this.findById(id) : null;
  }

  async findByProviderOrderId(providerOrderId: string): Promise<PaymentOrderRow | null> {
    const id = this.providerOrderIndex.get(providerOrderId);
    return id ? this.findById(id) : null;
  }

  async markPaid(orderId: string, providerPaymentId: string): Promise<void> {
    const row = this.rows.get(orderId);
    if (!row) return;
    row.status = "paid";
    row.provider_payment_id = providerPaymentId;
  }
}

function dbRowToOrder(row: Record<string, unknown>): PaymentOrderRow {
  const createdAt = row.created_at;
  return {
    id: String(row.id),
    user_id: String(row.user_id),
    draft_id: String(row.draft_id),
    provider: row.provider as PaymentOrderRow["provider"],
    idempotency_key: String(row.idempotency_key),
    provider_order_id: String(row.provider_order_id),
    provider_payment_id: (row.provider_payment_id as string | null) ?? null,
    amount_paise: Number(row.amount_paise),
    status: row.status as PaymentOrderRow["status"],
    metadata: (row.metadata as PaymentOrderRow["metadata"]) ?? ({} as PaymentOrderRow["metadata"]),
    created_at: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt)
  };
}

export class DbPaymentOrdersRepository implements PaymentOrdersRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(row: PaymentOrderRow): Promise<void> {
    await this.db.query(
      `INSERT INTO rent_agreement_payment_orders
         (id, user_id, draft_id, provider, idempotency_key, provider_order_id,
          provider_payment_id, amount_paise, status, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
      [
        row.id,
        row.user_id,
        row.draft_id,
        row.provider,
        row.idempotency_key,
        row.provider_order_id,
        row.provider_payment_id,
        row.amount_paise,
        row.status,
        JSON.stringify(row.metadata ?? {}),
        row.created_at
      ]
    );
  }

  async findById(id: string): Promise<PaymentOrderRow | null> {
    const result = await this.db.query(
      `SELECT * FROM rent_agreement_payment_orders WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? dbRowToOrder(result.rows[0]) : null;
  }

  async findByIdempotency(userId: string, idempotencyKey: string): Promise<PaymentOrderRow | null> {
    const result = await this.db.query(
      `SELECT * FROM rent_agreement_payment_orders
       WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, idempotencyKey]
    );
    return result.rows[0] ? dbRowToOrder(result.rows[0]) : null;
  }

  async findByProviderOrderId(providerOrderId: string): Promise<PaymentOrderRow | null> {
    const result = await this.db.query(
      `SELECT * FROM rent_agreement_payment_orders WHERE provider_order_id = $1`,
      [providerOrderId]
    );
    return result.rows[0] ? dbRowToOrder(result.rows[0]) : null;
  }

  async markPaid(orderId: string, providerPaymentId: string): Promise<void> {
    await this.db.query(
      `UPDATE rent_agreement_payment_orders
       SET status = 'paid', provider_payment_id = $2
       WHERE id = $1`,
      [orderId, providerPaymentId]
    );
  }
}
