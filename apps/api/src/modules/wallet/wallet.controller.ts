import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { ok } from "../../common/response";
import { AppStateService } from "../../common/app-state.service";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { DatabaseService } from "../../common/database.service";
import { logTelemetry } from "../../common/telemetry";
import { randomUUID } from "crypto";
import {
  buildProviderPayload,
  parseCreditPlan,
  parsePaymentProvider
} from "../payments/payments.util";

@Controller("wallet")
@UseGuards(AuthGuard)
export class WalletController {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  @Get()
  async balance(@Req() req: { user: { id: string } }) {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        balance_credits: number;
        free_credits_granted: number;
      }>(
        `
        SELECT balance_credits, free_credits_granted
        FROM wallets
        WHERE user_id = $1::uuid
        LIMIT 1
        `,
        [req.user.id]
      );

      return ok({
        balance_credits: Number(result.rows[0]?.balance_credits ?? 0),
        free_credits_granted: Number(result.rows[0]?.free_credits_granted ?? 0)
      });
    }

    return ok({
      balance_credits: this.appState.getWalletBalance(req.user.id),
      free_credits_granted: 2
    });
  }

  @Get("transactions")
  async transactions(@Req() req: { user: { id: string } }) {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        id: string;
        txn_type: string;
        credits_delta: number;
        reference_id: string | null;
        created_at: string;
      }>(
        `
        SELECT id::text, txn_type::text, credits_delta, reference_id::text, created_at::text
        FROM wallet_transactions
        WHERE wallet_user_id = $1::uuid
        ORDER BY created_at DESC
        `,
        [req.user.id]
      );

      return ok({
        items: result.rows.map((txn) => ({
          id: txn.id,
          txn_type: txn.txn_type,
          credits_delta: Number(txn.credits_delta),
          reference_id: txn.reference_id,
          created_at: txn.created_at
        })),
        total: result.rowCount ?? 0
      });
    }

    const items = this.appState.listWalletTransactions(req.user.id).map((txn) => ({
      id: txn.id,
      txn_type: txn.type,
      credits_delta: txn.creditsDelta,
      reference_id: txn.referenceId,
      created_at: new Date(txn.createdAt).toISOString()
    }));
    return ok({ items, total: items.length });
  }

  @Post("purchase-intents")
  async purchaseIntent(
    @Req()
    req: {
      user: { id: string };
      headers: Record<string, string | string[] | undefined>;
    },
    @Body() body: { plan_id: string; provider: string }
  ) {
    const idemHeader = req.headers["idempotency-key"];
    const idem = requireIdempotencyKey(Array.isArray(idemHeader) ? idemHeader[0] : idemHeader);
    const plan = parseCreditPlan(body.plan_id);
    const provider = parsePaymentProvider(body.provider);

    if (this.database.isEnabled()) {
      const existing = await this.database.query<{
        provider: "razorpay" | "upi";
        provider_order_id: string;
        amount_paise: number;
        credits_to_grant: number;
        metadata: Record<string, unknown>;
      }>(
        `
        SELECT provider::text, provider_order_id, amount_paise, credits_to_grant, metadata
        FROM payment_orders
        WHERE user_id = $1::uuid
          AND idempotency_key = $2
        LIMIT 1
        `,
        [req.user.id, idem]
      );

      if (existing.rowCount && existing.rows[0]) {
        const row = existing.rows[0];
        const existingPlanId =
          typeof row.metadata?.plan_id === "string" ? row.metadata.plan_id : plan.planId;
        const providerPayload = buildProviderPayload({
          provider: parsePaymentProvider(row.provider),
          providerOrderId: row.provider_order_id,
          amountPaise: Number(row.amount_paise),
          creditsToGrant: Number(row.credits_to_grant),
          planId: parseCreditPlan(existingPlanId).planId
        });
        logTelemetry("wallet.purchase_intent_idempotent_hit", {
          mode: "db",
          user_id: req.user.id,
          order_id: row.provider_order_id,
          provider: row.provider,
          plan_id: existingPlanId,
          idempotency_key: idem
        });
        return ok({
          order_id: row.provider_order_id,
          amount_paise: Number(row.amount_paise),
          credits_to_grant: Number(row.credits_to_grant),
          provider_payload: providerPayload
        });
      }

      const providerOrderId = `order_${randomUUID().replace(/-/g, "")}`;

      const inserted = await this.database.query<{
        provider_order_id: string;
        amount_paise: number;
        credits_to_grant: number;
      }>(
        `
        INSERT INTO payment_orders(
          user_id,
          provider,
          provider_order_id,
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
          $5,
          'created',
          $6,
          $7::jsonb
        )
        ON CONFLICT (user_id, idempotency_key)
          WHERE idempotency_key IS NOT NULL
        DO NOTHING
        RETURNING provider_order_id, amount_paise, credits_to_grant
        `,
        [
          req.user.id,
          provider,
          providerOrderId,
          plan.amountPaise,
          plan.credits,
          idem,
          JSON.stringify({ plan_id: plan.planId })
        ]
      );

      const orderRow =
        inserted.rows[0] ??
        (
          await this.database.query<{
            provider_order_id: string;
            amount_paise: number;
            credits_to_grant: number;
          }>(
            `
            SELECT provider_order_id, amount_paise, credits_to_grant
            FROM payment_orders
            WHERE user_id = $1::uuid
              AND idempotency_key = $2
            LIMIT 1
            `,
            [req.user.id, idem]
          )
        ).rows[0];

      const providerPayload = buildProviderPayload({
        provider,
        providerOrderId: orderRow.provider_order_id,
        amountPaise: Number(orderRow.amount_paise),
        creditsToGrant: Number(orderRow.credits_to_grant),
        planId: plan.planId
      });

      logTelemetry("wallet.purchase_intent_created", {
        mode: "db",
        user_id: req.user.id,
        order_id: orderRow.provider_order_id,
        provider,
        plan_id: plan.planId,
        idempotency_key: idem
      });

      return ok({
        order_id: orderRow.provider_order_id,
        amount_paise: Number(orderRow.amount_paise),
        credits_to_grant: Number(orderRow.credits_to_grant),
        provider_payload: providerPayload
      });
    }

    const idemCacheKey = `${req.user.id}:purchase:${idem}`;
    const existingOrder = this.appState.paymentOrderByIdempotency.get(idemCacheKey);
    if (existingOrder) {
      logTelemetry("wallet.purchase_intent_idempotent_hit", {
        mode: "in_memory",
        user_id: req.user.id,
        order_id: existingOrder.providerOrderId,
        provider: existingOrder.provider,
        plan_id: existingOrder.planId,
        idempotency_key: idem
      });
      return ok({
        order_id: existingOrder.providerOrderId,
        amount_paise: existingOrder.amountPaise,
        credits_to_grant: existingOrder.creditsToGrant,
        provider_payload: buildProviderPayload({
          provider: existingOrder.provider,
          providerOrderId: existingOrder.providerOrderId,
          amountPaise: existingOrder.amountPaise,
          creditsToGrant: existingOrder.creditsToGrant,
          planId: existingOrder.planId
        })
      });
    }

    const providerOrderId = `order_${randomUUID().replace(/-/g, "")}`;
    const order = {
      id: randomUUID(),
      userId: req.user.id,
      provider,
      providerOrderId,
      amountPaise: plan.amountPaise,
      creditsToGrant: plan.credits,
      planId: plan.planId,
      status: "created" as const
    };
    this.appState.paymentOrders.set(order.id, order);
    this.appState.paymentOrderByProviderOrderId.set(providerOrderId, order);
    this.appState.paymentOrderByIdempotency.set(idemCacheKey, order);
    logTelemetry("wallet.purchase_intent_created", {
      mode: "in_memory",
      user_id: req.user.id,
      order_id: providerOrderId,
      provider,
      plan_id: plan.planId,
      idempotency_key: idem
    });

    return ok({
      order_id: providerOrderId,
      amount_paise: plan.amountPaise,
      credits_to_grant: plan.credits,
      provider_payload: buildProviderPayload({
        provider,
        providerOrderId,
        amountPaise: plan.amountPaise,
        creditsToGrant: plan.credits,
        planId: plan.planId
      })
    });
  }
}
