import { Inject, Injectable, Logger } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { logTelemetry } from "../../common/telemetry";
import { WhatsAppClient } from "./whatsapp.client";
import { TEMPLATES, type NotificationType } from "./notification.templates";

/**
 * High-level notification orchestrator.
 *
 * Checks user preferences (whatsapp_opt_in) and feature flags,
 * then dispatches notifications through the appropriate channel.
 *
 * Two dispatch modes:
 * 1. **Immediate** – fires WhatsApp API call synchronously (used for
 *    time-critical notifications like contact unlocks).
 * 2. **Queued** – inserts into outbound_events for worker-based delivery
 *    with retry logic (used for non-urgent notifications).
 */

interface SendNotificationInput {
  /** The notification type to send */
  type: NotificationType;
  /** The user_id of the recipient (used to look up phone + opt-in) */
  recipientUserId: string;
  /** Optional: override the recipient phone (skips DB lookup) */
  recipientPhone?: string;
  /** Optional: override opt-in check (e.g. system-critical messages) */
  forceOptIn?: boolean;
  /** Template payload – passed to template.buildBodyParams() */
  payload: Record<string, unknown>;
  /** Dispatch mode, defaults to "immediate" */
  mode?: "immediate" | "queued";
  /** Dedupe key for queued mode – prevents duplicate sends */
  dedupeKey?: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly featureEnabled: boolean;

  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(WhatsAppClient) private readonly whatsApp: WhatsAppClient
  ) {
    this.featureEnabled = process.env.FF_WHATSAPP_NOTIFICATIONS !== "false";
  }

  /**
   * Send a WhatsApp notification if the recipient has opted in.
   *
   * Returns true if the notification was dispatched (or queued), false
   * if it was skipped (opt-out, feature disabled, etc.).
   */
  async send(input: SendNotificationInput): Promise<boolean> {
    if (!this.featureEnabled) {
      logTelemetry("notification.skipped", {
        type: input.type,
        reason: "feature_disabled",
        user_id: input.recipientUserId
      });
      return false;
    }

    const template = TEMPLATES[input.type];
    if (!template) {
      this.logger.warn(`Unknown notification type: ${input.type}`);
      return false;
    }

    // Resolve recipient phone & opt-in preference
    const recipient = await this.resolveRecipient(
      input.recipientUserId,
      input.recipientPhone,
      input.forceOptIn
    );

    if (!recipient) {
      logTelemetry("notification.skipped", {
        type: input.type,
        reason: "no_phone_or_opt_out",
        user_id: input.recipientUserId
      });
      return false;
    }

    const bodyParams = template.buildBodyParams(input.payload);

    if (input.mode === "queued") {
      return this.enqueueNotification(input, template, recipient.phone, bodyParams);
    }

    // Immediate dispatch
    return this.dispatchImmediate(input, template, recipient.phone, bodyParams);
  }

  /**
   * Dispatch a queued notification event via the WhatsApp client.
   * Called by the worker for events with type starting with "notification.whatsapp."
   */
  async dispatchQueuedEvent(event: {
    id: number;
    event_type: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const notificationType = event.payload.notification_type as NotificationType | undefined;
    if (!notificationType) {
      throw new Error(`Missing notification_type in payload for event ${event.id}`);
    }

    const template = TEMPLATES[notificationType];
    if (!template) {
      throw new Error(`Unknown notification template: ${notificationType}`);
    }

    const phone = event.payload.recipient_phone as string;
    if (!phone) {
      throw new Error(`Missing recipient_phone in payload for event ${event.id}`);
    }

    const bodyParams =
      (event.payload.body_params as string[]) ?? template.buildBodyParams(event.payload);

    const result = await this.whatsApp.sendTemplate({
      to: phone,
      templateName: template.templateName,
      languageCode: template.languageCode,
      bodyParams
    });

    if (!result.success) {
      throw new Error(result.error ?? "WhatsApp send failed");
    }

    // Log the successful delivery
    await this.logNotification(
      event.payload.recipient_user_id as string,
      notificationType,
      phone,
      result.messageId ?? null,
      "delivered"
    );
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async resolveRecipient(
    userId: string,
    overridePhone?: string,
    forceOptIn?: boolean
  ): Promise<{ phone: string } | null> {
    if (overridePhone && forceOptIn) {
      return { phone: overridePhone };
    }

    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        phone_e164: string;
        whatsapp_opt_in: boolean;
      }>(
        `
        SELECT phone_e164, whatsapp_opt_in
        FROM users
        WHERE id = $1::uuid
        LIMIT 1
        `,
        [userId]
      );

      const user = result.rows[0];
      if (!user?.phone_e164) return null;
      if (!forceOptIn && !user.whatsapp_opt_in) return null;

      return { phone: overridePhone ?? user.phone_e164 };
    }

    // In-memory fallback
    const user = this.appState.users.get(userId);
    if (!user) return null;

    const phone = overridePhone ?? user.phone;
    if (!phone) return null;

    const optedIn = forceOptIn || user.whatsapp_opt_in;
    if (!optedIn) return null;

    return { phone };
  }

  private async dispatchImmediate(
    input: SendNotificationInput,
    template: (typeof TEMPLATES)[NotificationType],
    phone: string,
    bodyParams: string[]
  ): Promise<boolean> {
    try {
      const result = await this.whatsApp.sendTemplate({
        to: phone,
        templateName: template.templateName,
        languageCode: template.languageCode,
        bodyParams
      });

      await this.logNotification(
        input.recipientUserId,
        input.type,
        phone,
        result.messageId ?? null,
        result.success ? "delivered" : "failed"
      );

      if (!result.success) {
        this.logger.warn(`Notification ${input.type} to ${phone} failed: ${result.error}`);
      }

      return result.success;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notification dispatch error: ${errMsg}`);
      await this.logNotification(input.recipientUserId, input.type, phone, null, "failed");
      return false;
    }
  }

  private async enqueueNotification(
    input: SendNotificationInput,
    template: (typeof TEMPLATES)[NotificationType],
    phone: string,
    bodyParams: string[]
  ): Promise<boolean> {
    const eventType = `notification.whatsapp.${input.type}`;
    const dedupeKey = input.dedupeKey ?? `wa:${input.type}:${input.recipientUserId}:${Date.now()}`;

    const payload = {
      notification_type: input.type,
      recipient_user_id: input.recipientUserId,
      recipient_phone: phone,
      template_name: template.templateName,
      language_code: template.languageCode,
      body_params: bodyParams,
      ...input.payload
    };

    if (this.database.isEnabled()) {
      await this.database.query(
        `
        INSERT INTO outbound_events(
          event_type,
          aggregate_type,
          aggregate_id,
          dedupe_key,
          payload,
          status,
          next_attempt_at
        )
        VALUES ($1, 'notification', $2::uuid, $3, $4::jsonb, 'pending', now())
        ON CONFLICT (dedupe_key) DO NOTHING
        `,
        [eventType, input.recipientUserId, dedupeKey, JSON.stringify(payload)]
      );
    } else {
      // In-memory fallback
      this.appState.outboundEvents.push({
        id: this.appState.outboundEvents.length + 1,
        eventType,
        aggregateType: "notification",
        aggregateId: input.recipientUserId,
        payload,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }

    logTelemetry("notification.queued", {
      type: input.type,
      user_id: input.recipientUserId,
      dedupe_key: dedupeKey
    });

    return true;
  }

  private async logNotification(
    userId: string,
    type: NotificationType,
    phone: string,
    messageId: string | null,
    status: "delivered" | "failed"
  ) {
    logTelemetry("notification.result", {
      type,
      user_id: userId,
      phone_masked: phone.slice(0, 4) + "****" + phone.slice(-2),
      message_id: messageId,
      status
    });

    if (this.database.isEnabled()) {
      try {
        await this.database.query(
          `
          INSERT INTO notification_log(
            user_id,
            channel,
            notification_type,
            recipient_phone_masked,
            provider_message_id,
            status
          )
          VALUES ($1::uuid, 'whatsapp', $2, $3, $4, $5)
          `,
          [userId, type, phone.slice(0, 4) + "****" + phone.slice(-2), messageId, status]
        );
      } catch (err) {
        // Non-critical – log but don't break the notification flow
        this.logger.warn(`Failed to log notification: ${err}`);
      }
    }
  }
}
