import { Body, Controller, Headers, Inject, Post, Req } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { ok } from "../../common/response";
import { logTelemetry } from "../../common/telemetry";
import {
  PaymentProvider,
  canonicalPayload,
  ensureWebhookSignature,
  parsePaymentProvider,
  parseWebhookEvent
} from "./payments.util";

type WebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
};

@Controller("webhooks")
export class PaymentsController {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  @Post("razorpay")
  async razorpay(
    @Req() req: WebhookRequest,
    @Headers("x-razorpay-signature") signature: string | undefined,
    @Body() payload: Record<string, unknown>
  ) {
    return this.handleWebhook("razorpay", req, signature, payload);
  }

  @Post("upi")
  async upi(
    @Req() req: WebhookRequest,
    @Headers("x-upi-signature") signature: string | undefined,
    @Body() payload: Record<string, unknown>
  ) {
    return this.handleWebhook("upi", req, signature, payload);
  }

  private async handleWebhook(
    provider: PaymentProvider,
    req: WebhookRequest,
    signature: string | undefined,
    payload: Record<string, unknown>
  ) {
    const payloadForSignature = req.rawBody?.toString("utf8") ?? canonicalPayload(payload);
    const parsedEvent = parseWebhookEvent(provider, payload, payloadForSignature);

    const persistInvalidSignature = async () => {
      if (!this.database.isEnabled()) {
        return;
      }
      await this.database.query(
        `
        INSERT INTO payment_webhook_events(provider, provider_event_id, signature_valid, payload)
        VALUES ($1::payment_provider, null, false, $2::jsonb)
        `,
        [provider, JSON.stringify(payload)]
      );
    };

    try {
      ensureWebhookSignature({
        payloadForSignature,
        signature,
        provider: parsePaymentProvider(provider)
      });
    } catch (error) {
      await persistInvalidSignature();
      logTelemetry("payments.webhook_rejected", {
        provider,
        reason: "invalid_signature",
        event_type: parsedEvent.eventType,
        provider_event_id: parsedEvent.providerEventId
      });
      throw error;
    }

    if (!this.database.isEnabled()) {
      return ok(this.handleWebhookInMemory(provider, parsedEvent));
    }

    return ok(await this.handleWebhookDb(provider, payload, parsedEvent));
  }

  private handleWebhookInMemory(
    provider: PaymentProvider,
    parsedEvent: ReturnType<typeof parseWebhookEvent>
  ) {
    const dedupeKey = `${provider}:${parsedEvent.providerEventId}`;
    if (this.appState.processedPaymentWebhookEvents.has(dedupeKey)) {
      logTelemetry("payments.webhook_duplicate", {
        mode: "in_memory",
        provider,
        event_type: parsedEvent.eventType,
        provider_event_id: parsedEvent.providerEventId
      });
      return {
        received: true,
        provider,
        event: parsedEvent.eventType,
        duplicate: true
      };
    }

    this.appState.processedPaymentWebhookEvents.add(dedupeKey);

    if (!parsedEvent.providerOrderId) {
      logTelemetry("payments.webhook_ignored", {
        mode: "in_memory",
        provider,
        event_type: parsedEvent.eventType,
        provider_event_id: parsedEvent.providerEventId,
        reason: "missing_order_id"
      });
      return {
        received: true,
        provider,
        event: parsedEvent.eventType,
        ignored: true,
        reason: "missing_order_id"
      };
    }

    const order = this.appState.paymentOrderByProviderOrderId.get(parsedEvent.providerOrderId);
    if (!order) {
      logTelemetry("payments.webhook_ignored", {
        mode: "in_memory",
        provider,
        event_type: parsedEvent.eventType,
        provider_event_id: parsedEvent.providerEventId,
        reason: "order_not_found"
      });
      return {
        received: true,
        provider,
        event: parsedEvent.eventType,
        ignored: true,
        reason: "order_not_found"
      };
    }

    if (parsedEvent.isCaptureSuccess) {
      if (order.status !== "captured") {
        this.appState.ensureWallet(order.userId);
        this.appState.addWalletTxn({
          userId: order.userId,
          type: "purchase_pack",
          creditsDelta: order.creditsToGrant,
          referenceId: order.id,
          idempotencyKey: `payment_capture:${order.id}`
        });
        order.status = "captured";
        order.providerPaymentId = parsedEvent.providerPaymentId ?? order.providerPaymentId;
      }

      logTelemetry("payments.webhook_processed", {
        mode: "in_memory",
        provider,
        event_type: parsedEvent.eventType,
        provider_event_id: parsedEvent.providerEventId,
        order_id: order.providerOrderId,
        payment_status: order.status
      });

      return {
        received: true,
        provider,
        event: parsedEvent.eventType,
        processed: true,
        order_id: order.providerOrderId,
        payment_status: order.status
      };
    }

    if (parsedEvent.isFailure && order.status !== "captured") {
      order.status = "failed";
      order.providerPaymentId = parsedEvent.providerPaymentId ?? order.providerPaymentId;
    }

    logTelemetry("payments.webhook_processed", {
      mode: "in_memory",
      provider,
      event_type: parsedEvent.eventType,
      provider_event_id: parsedEvent.providerEventId,
      order_id: order.providerOrderId,
      payment_status: order.status
    });

    return {
      received: true,
      provider,
      event: parsedEvent.eventType,
      processed: true,
      order_id: order.providerOrderId,
      payment_status: order.status
    };
  }

  private async handleWebhookDb(
    provider: PaymentProvider,
    payload: Record<string, unknown>,
    parsedEvent: ReturnType<typeof parseWebhookEvent>
  ) {
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO payment_webhook_events(provider, provider_event_id, signature_valid, payload)
        VALUES ($1::payment_provider, $2, true, $3::jsonb)
        ON CONFLICT (provider, provider_event_id) DO NOTHING
        `,
        [provider, parsedEvent.providerEventId, JSON.stringify(payload)]
      );

      const eventRow = await client.query<{
        id: number;
        processed_at: string | null;
      }>(
        `
        SELECT id, processed_at::text
        FROM payment_webhook_events
        WHERE provider = $1::payment_provider
          AND provider_event_id = $2
        FOR UPDATE
        `,
        [provider, parsedEvent.providerEventId]
      );

      if (!eventRow.rowCount || eventRow.rows[0].processed_at) {
        await client.query("COMMIT");
        logTelemetry("payments.webhook_duplicate", {
          mode: "db",
          provider,
          event_type: parsedEvent.eventType,
          provider_event_id: parsedEvent.providerEventId
        });
        return {
          received: true,
          provider,
          event: parsedEvent.eventType,
          duplicate: true
        };
      }
      const eventDbId = eventRow.rows[0].id;

      if (!parsedEvent.providerOrderId) {
        await client.query(
          `
          UPDATE payment_webhook_events
          SET processed_at = now(), processing_note = 'missing_order_id'
          WHERE id = $1
          `,
          [eventDbId]
        );
        await client.query("COMMIT");
        logTelemetry("payments.webhook_ignored", {
          mode: "db",
          provider,
          event_type: parsedEvent.eventType,
          provider_event_id: parsedEvent.providerEventId,
          reason: "missing_order_id"
        });
        return {
          received: true,
          provider,
          event: parsedEvent.eventType,
          ignored: true,
          reason: "missing_order_id"
        };
      }

      const orderResult = await client.query<{
        id: string;
        user_id: string;
        provider_order_id: string;
        status: "created" | "authorized" | "captured" | "failed" | "refunded";
        credits_to_grant: number;
      }>(
        `
        SELECT id::text, user_id::text, provider_order_id, status::text, credits_to_grant
        FROM payment_orders
        WHERE provider = $1::payment_provider
          AND provider_order_id = $2
        LIMIT 1
        FOR UPDATE
        `,
        [provider, parsedEvent.providerOrderId]
      );

      if (!orderResult.rowCount || !orderResult.rows[0]) {
        await client.query(
          `
          UPDATE payment_webhook_events
          SET processed_at = now(), processing_note = 'order_not_found'
          WHERE id = $1
          `,
          [eventDbId]
        );
        await client.query("COMMIT");
        logTelemetry("payments.webhook_ignored", {
          mode: "db",
          provider,
          event_type: parsedEvent.eventType,
          provider_event_id: parsedEvent.providerEventId,
          reason: "order_not_found"
        });
        return {
          received: true,
          provider,
          event: parsedEvent.eventType,
          ignored: true,
          reason: "order_not_found"
        };
      }

      const order = orderResult.rows[0];
      let walletTxnId: string | null = null;

      if (parsedEvent.isCaptureSuccess) {
        await client.query(
          `
          UPDATE payment_orders
          SET
            status = 'captured',
            provider_payment_id = COALESCE($2, provider_payment_id),
            updated_at = now()
          WHERE id = $1::uuid
          `,
          [order.id, parsedEvent.providerPaymentId ?? null]
        );

        await client.query(
          `
          INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
          VALUES ($1::uuid, 0, 0)
          ON CONFLICT (user_id) DO NOTHING
          `,
          [order.user_id]
        );

        const walletTxn = await client.query<{ id: string }>(
          `
          INSERT INTO wallet_transactions(
            wallet_user_id,
            txn_type,
            credits_delta,
            cash_amount_paise,
            reference_type,
            reference_id,
            idempotency_key,
            metadata
          )
          VALUES (
            $1::uuid,
            'purchase_pack',
            $2,
            NULL,
            'payment',
            $3::uuid,
            $4,
            $5::jsonb
          )
          ON CONFLICT (wallet_user_id, idempotency_key) DO NOTHING
          RETURNING id::text
          `,
          [
            order.user_id,
            Number(order.credits_to_grant),
            order.id,
            `payment_capture:${order.id}`,
            JSON.stringify({
              provider,
              provider_event_id: parsedEvent.providerEventId,
              provider_payment_id: parsedEvent.providerPaymentId ?? null
            })
          ]
        );

        walletTxnId = walletTxn.rows[0]?.id ?? null;
        if (walletTxnId) {
          await client.query(
            `
            UPDATE wallets
            SET balance_credits = balance_credits + $2, updated_at = now()
            WHERE user_id = $1::uuid
            `,
            [order.user_id, Number(order.credits_to_grant)]
          );
        }

        await client.query(
          `
          UPDATE payment_webhook_events
          SET
            processed_at = now(),
            payment_order_id = $2::uuid,
            wallet_txn_id = $3::uuid,
            processing_note = 'captured'
          WHERE id = $1
          `,
          [eventDbId, order.id, walletTxnId]
        );
      } else if (parsedEvent.isFailure) {
        if (order.status !== "captured") {
          await client.query(
            `
            UPDATE payment_orders
            SET
              status = 'failed',
              provider_payment_id = COALESCE($2, provider_payment_id),
              updated_at = now()
            WHERE id = $1::uuid
            `,
            [order.id, parsedEvent.providerPaymentId ?? null]
          );
        }

        await client.query(
          `
          UPDATE payment_webhook_events
          SET
            processed_at = now(),
            payment_order_id = $2::uuid,
            processing_note = 'failed'
          WHERE id = $1
          `,
          [eventDbId, order.id]
        );
      } else {
        await client.query(
          `
          UPDATE payment_webhook_events
          SET
            processed_at = now(),
            payment_order_id = $2::uuid,
            processing_note = 'ignored_event'
          WHERE id = $1
          `,
          [eventDbId, order.id]
        );
      }

      await client.query("COMMIT");
      logTelemetry("payments.webhook_processed", {
        mode: "db",
        provider,
        event_type: parsedEvent.eventType,
        provider_event_id: parsedEvent.providerEventId,
        order_id: order.provider_order_id,
        payment_status: parsedEvent.isCaptureSuccess
          ? "captured"
          : parsedEvent.isFailure
            ? order.status === "captured"
              ? "captured"
              : "failed"
            : order.status,
        wallet_txn_id: walletTxnId
      });
      return {
        received: true,
        provider,
        event: parsedEvent.eventType,
        processed: true,
        duplicate: false,
        order_id: order.provider_order_id,
        payment_status: parsedEvent.isCaptureSuccess
          ? "captured"
          : parsedEvent.isFailure
            ? order.status === "captured"
              ? "captured"
              : "failed"
            : order.status,
        wallet_txn_id: walletTxnId
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
