import { Body, Controller, Get, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { ok } from "../../common/response";
import { AppStateService } from "../../common/app-state.service";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { DatabaseService } from "../../common/database.service";
import { randomUUID } from "crypto";

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
    @Req() req: { user: { id: string }; headers: Record<string, string> },
    @Body() body: { plan_id: string; provider: string }
  ) {
    const idem = requireIdempotencyKey(req.headers["idempotency-key"]);
    const amountPaise = body.plan_id === "starter_10" ? 9900 : 19900;

    if (this.database.isEnabled()) {
      const existing = await this.database.query<{
        response: {
          order_id: string;
          amount_paise: number;
          provider_payload: { provider: string; mode: string };
        };
      }>(
        `
        SELECT payload #> '{response}' AS response
        FROM audit_logs
        WHERE actor_user_id = $1::uuid
          AND event_name = 'wallet_purchase_intent'
          AND payload ->> 'idempotency_key' = $2
        ORDER BY id DESC
        LIMIT 1
        `,
        [req.user.id, idem]
      );

      if (existing.rowCount && existing.rows[0]?.response) {
        return ok(existing.rows[0].response);
      }

      const orderId = `order_${randomUUID().replace(/-/g, "")}`;
      const response = {
        order_id: orderId,
        amount_paise: amountPaise,
        provider_payload: {
          provider: body.provider,
          mode: "placeholder"
        }
      };

      await this.database.query(
        `
        INSERT INTO payment_orders(user_id, provider, provider_order_id, amount_paise, credits_to_grant, status)
        VALUES ($1::uuid, $2::payment_provider, $3, $4, $5, 'created')
        `,
        [
          req.user.id,
          body.provider === "upi" ? "upi" : "razorpay",
          orderId,
          amountPaise,
          body.plan_id === "starter_10" ? 10 : 20
        ]
      );

      await this.database.query(
        `
        INSERT INTO audit_logs(actor_user_id, actor_type, event_name, entity_type, entity_id, payload)
        VALUES ($1::uuid, 'user', 'wallet_purchase_intent', 'payment_order', null, $2::jsonb)
        `,
        [req.user.id, JSON.stringify({ idempotency_key: idem, response })]
      );

      return ok(response);
    }

    const idemCacheKey = `${req.user.id}:wallet:purchase-intents:${idem}`;
    const cached = this.appState.getIdempotentResponse<{
      order_id: string;
      amount_paise: number;
      provider_payload: { provider: string; mode: string };
    }>(idemCacheKey);
    if (cached) {
      return ok(cached);
    }

    const response = {
      order_id: `order_${idem}`,
      amount_paise: amountPaise,
      provider_payload: {
        provider: body.provider,
        mode: "placeholder"
      }
    };

    return ok(this.appState.setIdempotentResponse(idemCacheKey, response));
  }
}
