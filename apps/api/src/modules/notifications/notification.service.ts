import { Inject, Injectable, Logger } from "@nestjs/common";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { logTelemetry } from "../../common/telemetry";
import { WhatsAppClient } from "./whatsapp.client";
import { SmsClient } from "./sms.client";
import { TEMPLATES, type NotificationType } from "./notification.templates";

/**
 * High-level notification orchestrator.
 *
 * Checks user preferences (whatsapp_opt_in) and feature flags, then fans a
 * notification out across every channel declared on its template
 * (`template.channels`) — currently WhatsApp and/or SMS.
 *
 * Two dispatch modes:
 * 1. **Immediate** – fires the provider API call(s) synchronously (used for
 *    time-critical notifications like contact unlocks).
 * 2. **Queued** – inserts one outbound_events row per channel for
 *    worker-based delivery with retry logic (used for non-urgent
 *    notifications).
 *
 * WhatsApp delivery is gated by the recipient's `whatsapp_opt_in`
 * preference (unless `forceOptIn` is set). SMS is treated as transactional
 * and is NOT gated by that preference — it only requires a resolvable
 * phone number.
 */

type NotificationChannel = "whatsapp" | "sms";

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
    @Inject(WhatsAppClient) private readonly whatsApp: WhatsAppClient,
    @Inject(SmsClient) private readonly sms: SmsClient
  ) {
    this.featureEnabled = process.env.FF_WHATSAPP_NOTIFICATIONS !== "false";
  }

  /**
   * Send a notification across every channel its template declares.
   *
   * Returns true if at least one channel was dispatched (or queued)
   * successfully, false if every channel was skipped (opt-out, no phone,
   * feature disabled, etc.) or failed.
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

    if (input.mode === "queued") {
      return this.enqueueNotification(input, template);
    }

    // Immediate dispatch
    return this.dispatchImmediate(input, template);
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
      "delivered",
      "whatsapp"
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

  /**
   * Resolve the recipient's phone for SMS delivery. Unlike
   * `resolveRecipient`, this is NOT gated by `whatsapp_opt_in` — SMS here
   * is used for transactional notifications, so it only requires a
   * resolvable phone number.
   */
  private async resolveSmsPhone(userId: string, overridePhone?: string): Promise<string | null> {
    if (overridePhone) {
      return overridePhone;
    }

    if (this.database.isEnabled()) {
      const result = await this.database.query<{ phone_e164: string }>(
        `
        SELECT phone_e164
        FROM users
        WHERE id = $1::uuid
        LIMIT 1
        `,
        [userId]
      );
      return result.rows[0]?.phone_e164 ?? null;
    }

    // In-memory fallback
    const user = this.appState.users.get(userId);
    return user?.phone ?? null;
  }

  // ---------------------------------------------------------------------------
  // Immediate dispatch – loops over template.channels
  // ---------------------------------------------------------------------------

  private async dispatchImmediate(
    input: SendNotificationInput,
    template: (typeof TEMPLATES)[NotificationType]
  ): Promise<boolean> {
    let anySucceeded = false;

    for (const channel of template.channels) {
      if (channel === "whatsapp") {
        if (await this.dispatchWhatsAppImmediate(input, template)) {
          anySucceeded = true;
        }
      } else if (channel === "sms") {
        if (await this.dispatchSmsImmediate(input, template)) {
          anySucceeded = true;
        }
      }
    }

    return anySucceeded;
  }

  private async dispatchWhatsAppImmediate(
    input: SendNotificationInput,
    template: (typeof TEMPLATES)[NotificationType]
  ): Promise<boolean> {
    const recipient = await this.resolveRecipient(
      input.recipientUserId,
      input.recipientPhone,
      input.forceOptIn
    );

    if (!recipient) {
      logTelemetry("notification.skipped", {
        type: input.type,
        channel: "whatsapp",
        reason: "no_phone_or_opt_out",
        user_id: input.recipientUserId
      });
      return false;
    }

    const bodyParams = template.buildBodyParams(input.payload);

    try {
      const result = await this.whatsApp.sendTemplate({
        to: recipient.phone,
        templateName: template.templateName,
        languageCode: template.languageCode,
        bodyParams
      });

      await this.logNotification(
        input.recipientUserId,
        input.type,
        recipient.phone,
        result.messageId ?? null,
        result.success ? "delivered" : "failed",
        "whatsapp"
      );

      if (!result.success) {
        this.logger.warn(
          `Notification ${input.type} to ${recipient.phone} failed: ${result.error}`
        );
      }

      return result.success;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Notification dispatch error: ${errMsg}`);
      await this.logNotification(
        input.recipientUserId,
        input.type,
        recipient.phone,
        null,
        "failed",
        "whatsapp"
      );
      return false;
    }
  }

  private async dispatchSmsImmediate(
    input: SendNotificationInput,
    template: (typeof TEMPLATES)[NotificationType]
  ): Promise<boolean> {
    const phone = await this.resolveSmsPhone(input.recipientUserId, input.recipientPhone);

    if (!phone) {
      logTelemetry("notification.skipped", {
        type: input.type,
        channel: "sms",
        reason: "no_phone",
        user_id: input.recipientUserId
      });
      return false;
    }

    if (!template.buildSmsBody) {
      this.logger.warn(
        `Notification type ${input.type} declares 'sms' channel but has no buildSmsBody`
      );
      return false;
    }

    const body = template.buildSmsBody(input.payload);

    try {
      const result = await this.sms.sendSms({ to: phone, body });

      await this.logNotification(
        input.recipientUserId,
        input.type,
        phone,
        result.messageId ?? null,
        result.success ? "delivered" : "failed",
        "sms"
      );

      if (!result.success) {
        this.logger.warn(`SMS notification ${input.type} to ${phone} failed: ${result.error}`);
      }

      return result.success;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMS notification dispatch error: ${errMsg}`);
      await this.logNotification(input.recipientUserId, input.type, phone, null, "failed", "sms");
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Queued dispatch – emits one outbound_events row per channel
  // ---------------------------------------------------------------------------

  private async enqueueNotification(
    input: SendNotificationInput,
    template: (typeof TEMPLATES)[NotificationType]
  ): Promise<boolean> {
    let anySucceeded = false;

    for (const channel of template.channels) {
      if (channel === "whatsapp") {
        if (await this.enqueueWhatsAppEvent(input, template)) {
          anySucceeded = true;
        }
      } else if (channel === "sms") {
        if (await this.enqueueSmsEvent(input, template)) {
          anySucceeded = true;
        }
      }
    }

    return anySucceeded;
  }

  private async enqueueWhatsAppEvent(
    input: SendNotificationInput,
    template: (typeof TEMPLATES)[NotificationType]
  ): Promise<boolean> {
    const recipient = await this.resolveRecipient(
      input.recipientUserId,
      input.recipientPhone,
      input.forceOptIn
    );

    if (!recipient) {
      logTelemetry("notification.skipped", {
        type: input.type,
        channel: "whatsapp",
        reason: "no_phone_or_opt_out",
        user_id: input.recipientUserId
      });
      return false;
    }

    const bodyParams = template.buildBodyParams(input.payload);
    const eventType = `notification.whatsapp.${input.type}`;
    const dedupeKey = this.buildDedupeKey("whatsapp", input);

    const payload = {
      notification_type: input.type,
      recipient_user_id: input.recipientUserId,
      recipient_phone: recipient.phone,
      template_name: template.templateName,
      language_code: template.languageCode,
      body_params: bodyParams,
      ...input.payload
    };

    await this.insertOutboundEvent(eventType, input.recipientUserId, dedupeKey, payload);

    logTelemetry("notification.queued", {
      type: input.type,
      channel: "whatsapp",
      user_id: input.recipientUserId,
      dedupe_key: dedupeKey
    });

    return true;
  }

  private async enqueueSmsEvent(
    input: SendNotificationInput,
    template: (typeof TEMPLATES)[NotificationType]
  ): Promise<boolean> {
    const phone = await this.resolveSmsPhone(input.recipientUserId, input.recipientPhone);

    if (!phone) {
      logTelemetry("notification.skipped", {
        type: input.type,
        channel: "sms",
        reason: "no_phone",
        user_id: input.recipientUserId
      });
      return false;
    }

    if (!template.buildSmsBody) {
      this.logger.warn(
        `Notification type ${input.type} declares 'sms' channel but has no buildSmsBody`
      );
      return false;
    }

    const smsBody = template.buildSmsBody(input.payload);
    const eventType = `notification.sms.${input.type}`;
    const dedupeKey = this.buildDedupeKey("sms", input);

    const payload = {
      notification_type: input.type,
      recipient_user_id: input.recipientUserId,
      recipient_phone: phone,
      sms_body: smsBody,
      ...input.payload
    };

    await this.insertOutboundEvent(eventType, input.recipientUserId, dedupeKey, payload);

    logTelemetry("notification.queued", {
      type: input.type,
      channel: "sms",
      user_id: input.recipientUserId,
      dedupe_key: dedupeKey
    });

    return true;
  }

  /**
   * Default queued-mode dedupe key, scoped per channel so a single
   * multi-channel template (e.g. contact_unlocked) always produces one
   * outbound_events row per channel instead of two channels colliding on
   * the `dedupe_key` UNIQUE constraint. A caller-supplied `dedupeKey` is
   * scoped the same way.
   */
  private buildDedupeKey(channel: NotificationChannel, input: SendNotificationInput): string {
    if (input.dedupeKey) {
      return `${channel}:${input.dedupeKey}`;
    }
    return `${channel}:${input.type}:${input.recipientUserId}:${Date.now()}`;
  }

  private async insertOutboundEvent(
    eventType: string,
    aggregateId: string,
    dedupeKey: string,
    payload: Record<string, unknown>
  ): Promise<void> {
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
        [eventType, aggregateId, dedupeKey, JSON.stringify(payload)]
      );
      return;
    }

    // In-memory fallback
    this.appState.outboundEvents.push({
      id: this.appState.outboundEvents.length + 1,
      eventType,
      aggregateType: "notification",
      aggregateId,
      payload,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  private async logNotification(
    userId: string,
    type: NotificationType,
    phone: string,
    messageId: string | null,
    status: "delivered" | "failed",
    channel: NotificationChannel
  ) {
    logTelemetry("notification.result", {
      type,
      channel,
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
          VALUES ($1::uuid, $2, $3, $4, $5, $6)
          `,
          [userId, channel, type, phone.slice(0, 4) + "****" + phone.slice(-2), messageId, status]
        );
      } catch (err) {
        // Non-critical – log but don't break the notification flow
        this.logger.warn(`Failed to log notification: ${err}`);
      }
    }
  }
}
