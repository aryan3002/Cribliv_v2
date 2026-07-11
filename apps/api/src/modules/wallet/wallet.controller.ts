import { Body, Controller, Get, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { ok } from "../../common/response";
import { AppStateService } from "../../common/app-state.service";
import { requireIdempotencyKey } from "../../common/idempotency.util";
import { DatabaseService } from "../../common/database.service";
import { assertCreditPurchaseEnabled, listCreditPlansForRole } from "../payments/payments.util";
import { WalletPurchaseService } from "./wallet-purchase.service";

@Controller("wallet")
@UseGuards(AuthGuard)
export class WalletController {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WalletPurchaseService) private readonly walletPurchase: WalletPurchaseService
  ) {}

  @Get("plans")
  async plans(@Req() req: { user: { id: string; role: string } }) {
    assertCreditPurchaseEnabled();
    return ok({ items: listCreditPlansForRole(req.user.role) });
  }

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
      user: { id: string; role: string };
      headers: Record<string, string | string[] | undefined>;
    },
    @Body() body: { plan_id: string; provider: string }
  ) {
    const idemHeader = req.headers["idempotency-key"];
    const idem = requireIdempotencyKey(Array.isArray(idemHeader) ? idemHeader[0] : idemHeader);

    const result = await this.walletPurchase.createIntent({
      userId: req.user.id,
      role: req.user.role,
      planId: body.plan_id,
      provider: body.provider,
      idempotencyKey: idem
    });

    return ok(result);
  }

  @Post("purchase-intents/:orderId/confirm")
  async confirmPurchaseIntent(
    @Req() req: { user: { id: string } },
    @Param("orderId") orderId: string,
    @Body()
    body: {
      razorpay_order_id: string;
      razorpay_payment_id: string;
      razorpay_signature: string;
    }
  ) {
    const result = await this.walletPurchase.confirmIntent({
      userId: req.user.id,
      orderId,
      razorpayOrderId: body.razorpay_order_id,
      razorpayPaymentId: body.razorpay_payment_id,
      razorpaySignature: body.razorpay_signature
    });

    return ok(result);
  }

  @Get("purchase-intents/:orderId")
  async purchaseIntentStatus(
    @Req() req: { user: { id: string } },
    @Param("orderId") orderId: string
  ) {
    const result = await this.walletPurchase.getIntentStatus({
      userId: req.user.id,
      orderId
    });

    return ok(result);
  }
}
