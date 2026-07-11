import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AppStateService, PaymentOrderRecord } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { logTelemetry } from "../../common/telemetry";
import { RazorpayOrdersService } from "../payments/razorpay-orders.service";
import {
  CreditPlanId,
  PaymentProvider,
  assertCreditPurchaseEnabled,
  buildProviderPayload,
  parseCreditPlan,
  parseCreditPlanForRole,
  parsePaymentProvider
} from "../payments/payments.util";

export interface CreatePurchaseIntentInput {
  userId: string;
  role: string;
  planId: string;
  provider: string;
  idempotencyKey: string;
}

export interface PurchaseIntentResult {
  order_id: string;
  amount_paise: number;
  credits_to_grant: number;
  provider_payload: ReturnType<typeof buildProviderPayload>;
}

/** Fully-resolved order — a provider order id has already been assigned. */
interface ResolvedOrder {
  providerOrderId: string;
  amountPaise: number;
  creditsToGrant: number;
  provider: PaymentProvider;
  planId: CreditPlanId;
}

function purchaseIntentConflictException() {
  return new ConflictException({
    code: "purchase_intent_conflict",
    message: "Idempotency key was already used for a different plan or provider"
  });
}

/** Receipt is deterministic from the internal payment-order UUID, per spec. */
function buildReceipt(internalOrderId: string): string {
  return `wallet_${internalOrderId.replace(/-/g, "").slice(0, 32)}`;
}

/**
 * Owns idempotent creation of wallet credit-purchase orders across both
 * persistence modes. A purchase order is "reserved" (row exists, no provider
 * order id yet) before the provider is called, then filled in once the
 * provider responds — so a provider order is only ever created once per
 * (user_id, idempotency_key), even under concurrent requests.
 */
@Injectable()
export class WalletPurchaseService {
  /** In-memory mode only: serializes concurrent creation for the same key within this process. */
  private readonly inMemoryLocks = new Map<string, Promise<ResolvedOrder>>();

  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(RazorpayOrdersService) private readonly razorpayOrders: RazorpayOrdersService
  ) {}

  async createIntent(input: CreatePurchaseIntentInput): Promise<PurchaseIntentResult> {
    assertCreditPurchaseEnabled();
    const plan = parseCreditPlanForRole(input.planId, input.role);
    const provider = parsePaymentProvider(input.provider);

    const order = this.database.isEnabled()
      ? await this.createIntentDb(input, plan, provider)
      : await this.createIntentInMemory(input, plan, provider);

    return this.toResult(order);
  }

  private assertNoConflict(
    storedPlanId: CreditPlanId,
    storedProvider: PaymentProvider,
    requestedPlanId: CreditPlanId,
    requestedProvider: PaymentProvider
  ) {
    if (storedPlanId !== requestedPlanId || storedProvider !== requestedProvider) {
      throw purchaseIntentConflictException();
    }
  }

  private async resolveProviderOrderId(
    provider: PaymentProvider,
    plan: { planId: CreditPlanId; amountPaise: number; credits: number },
    receipt: string
  ): Promise<string> {
    // UPI orders never touch Razorpay — the id is a locally generated reference
    // used only to build the deep link and for webhook correlation.
    if (provider === "upi") {
      return `order_${randomUUID().replace(/-/g, "")}`;
    }

    const order = await this.razorpayOrders.createOrder({
      amountPaise: plan.amountPaise,
      receipt,
      planId: plan.planId,
      credits: plan.credits
    });
    return order.id;
  }

  private toResult(order: ResolvedOrder): PurchaseIntentResult {
    return {
      order_id: order.providerOrderId,
      amount_paise: order.amountPaise,
      credits_to_grant: order.creditsToGrant,
      provider_payload: buildProviderPayload({
        provider: order.provider,
        providerOrderId: order.providerOrderId,
        amountPaise: order.amountPaise,
        creditsToGrant: order.creditsToGrant,
        planId: order.planId,
        keyId: this.razorpayOrders.keyId()
      })
    };
  }

  // ── In-memory mode ────────────────────────────────────────────────────

  private toResolvedOrder(record: PaymentOrderRecord): ResolvedOrder {
    if (!record.providerOrderId) {
      // Unreachable in practice: in-memory records are only ever exposed
      // (via paymentOrderByIdempotency / the lock map) once fully created.
      throw new Error("payment order record missing providerOrderId");
    }
    return {
      providerOrderId: record.providerOrderId,
      amountPaise: record.amountPaise,
      creditsToGrant: record.creditsToGrant,
      provider: record.provider,
      planId: record.planId
    };
  }

  private async createIntentInMemory(
    input: CreatePurchaseIntentInput,
    plan: ReturnType<typeof parseCreditPlanForRole>,
    provider: PaymentProvider
  ): Promise<ResolvedOrder> {
    const idemCacheKey = `${input.userId}:purchase:${input.idempotencyKey}`;

    const existing = this.appState.paymentOrderByIdempotency.get(idemCacheKey);
    if (existing) {
      this.assertNoConflict(existing.planId, existing.provider, plan.planId, provider);
      logTelemetry("wallet.purchase_intent_idempotent_hit", {
        mode: "in_memory",
        user_id: input.userId,
        order_id: existing.providerOrderId,
        provider: existing.provider,
        plan_id: existing.planId,
        idempotency_key: input.idempotencyKey
      });
      return this.toResolvedOrder(existing);
    }

    const inFlight = this.inMemoryLocks.get(idemCacheKey);
    if (inFlight) {
      const order = await inFlight;
      this.assertNoConflict(order.planId, order.provider, plan.planId, provider);
      return order;
    }

    const task = this.createOrderInMemory(input, plan, provider, idemCacheKey);
    this.inMemoryLocks.set(idemCacheKey, task);
    try {
      return await task;
    } finally {
      this.inMemoryLocks.delete(idemCacheKey);
    }
  }

  private async createOrderInMemory(
    input: CreatePurchaseIntentInput,
    plan: ReturnType<typeof parseCreditPlanForRole>,
    provider: PaymentProvider,
    idemCacheKey: string
  ): Promise<ResolvedOrder> {
    const id = randomUUID();
    const receipt = buildReceipt(id);
    const providerOrderId = await this.resolveProviderOrderId(provider, plan, receipt);

    const record: PaymentOrderRecord = {
      id,
      userId: input.userId,
      provider,
      providerOrderId,
      amountPaise: plan.amountPaise,
      creditsToGrant: plan.credits,
      planId: plan.planId,
      status: "created"
    };

    this.appState.paymentOrders.set(record.id, record);
    this.appState.paymentOrderByProviderOrderId.set(providerOrderId, record);
    this.appState.paymentOrderByIdempotency.set(idemCacheKey, record);

    logTelemetry("wallet.purchase_intent_created", {
      mode: "in_memory",
      user_id: input.userId,
      order_id: providerOrderId,
      provider,
      plan_id: plan.planId,
      idempotency_key: input.idempotencyKey
    });

    return this.toResolvedOrder(record);
  }

  // ── DB mode ───────────────────────────────────────────────────────────

  private async createIntentDb(
    input: CreatePurchaseIntentInput,
    plan: ReturnType<typeof parseCreditPlanForRole>,
    provider: PaymentProvider
  ): Promise<ResolvedOrder> {
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      // Reserve the idempotency slot (no-op if a row already exists for this
      // user + key). provider_order_id is left NULL — it's filled in below,
      // while this transaction still holds the row lock, so a concurrent
      // transaction for the same key blocks on the SELECT ... FOR UPDATE
      // until this one commits.
      await client.query(
        `
        INSERT INTO payment_orders(
          user_id,
          provider,
          amount_paise,
          credits_to_grant,
          status,
          idempotency_key,
          metadata
        )
        VALUES (
          $1::uuid,
          $2::payment_provider,
          $3,
          $4,
          'created',
          $5,
          $6::jsonb
        )
        ON CONFLICT (user_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
        DO NOTHING
        `,
        [
          input.userId,
          provider,
          plan.amountPaise,
          plan.credits,
          input.idempotencyKey,
          JSON.stringify({ plan_id: plan.planId })
        ]
      );

      const locked = await client.query<{
        id: string;
        provider: string;
        provider_order_id: string | null;
        amount_paise: number;
        credits_to_grant: number;
        metadata: Record<string, unknown>;
      }>(
        `
        SELECT id::text, provider::text, provider_order_id, amount_paise, credits_to_grant, metadata
        FROM payment_orders
        WHERE user_id = $1::uuid
          AND idempotency_key = $2
        FOR UPDATE
        `,
        [input.userId, input.idempotencyKey]
      );

      const row = locked.rows[0];
      if (!row) {
        throw new Error("payment_orders row missing after reserve insert");
      }

      const storedPlanIdRaw =
        typeof row.metadata?.plan_id === "string" ? row.metadata.plan_id : undefined;
      if (!storedPlanIdRaw) {
        throw new Error("payment_orders row missing plan_id metadata");
      }
      const storedPlan = parseCreditPlan(storedPlanIdRaw);
      const storedProvider = parsePaymentProvider(row.provider);
      this.assertNoConflict(storedPlan.planId, storedProvider, plan.planId, provider);

      if (row.provider_order_id) {
        await client.query("COMMIT");
        logTelemetry("wallet.purchase_intent_idempotent_hit", {
          mode: "db",
          user_id: input.userId,
          order_id: row.provider_order_id,
          provider: storedProvider,
          plan_id: storedPlan.planId,
          idempotency_key: input.idempotencyKey
        });
        return {
          providerOrderId: row.provider_order_id,
          amountPaise: Number(row.amount_paise),
          creditsToGrant: Number(row.credits_to_grant),
          provider: storedProvider,
          planId: storedPlan.planId
        };
      }

      const receipt = buildReceipt(row.id);
      const providerOrderId = await this.resolveProviderOrderId(provider, plan, receipt);

      await client.query(
        `
        UPDATE payment_orders
        SET provider_order_id = $2, updated_at = now()
        WHERE id = $1::uuid
        `,
        [row.id, providerOrderId]
      );

      await client.query("COMMIT");

      logTelemetry("wallet.purchase_intent_created", {
        mode: "db",
        user_id: input.userId,
        order_id: providerOrderId,
        provider,
        plan_id: plan.planId,
        idempotency_key: input.idempotencyKey
      });

      return {
        providerOrderId,
        amountPaise: Number(row.amount_paise),
        creditsToGrant: Number(row.credits_to_grant),
        provider,
        planId: plan.planId
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
