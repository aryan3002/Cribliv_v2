import { Injectable, Logger } from "@nestjs/common";
import { logTelemetry } from "../../common/telemetry";

/**
 * WhatsApp Business API (WABA) client.
 *
 * Sends template-based messages via Meta Cloud API.
 * In dev/test, logs payloads instead of hitting the real API when
 * WHATSAPP_PROVIDER=mock (default for local dev).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 */

export interface WhatsAppTemplateMessage {
  /** Recipient phone in E.164 format, e.g. "+919876543210" */
  to: string;
  /** Meta-approved template name, e.g. "listing_approved_hi" */
  templateName: string;
  /** Language code, e.g. "hi" for Hindi, "en" for English */
  languageCode: string;
  /** Positional parameters for the template body */
  bodyParams?: string[];
  /** Header parameters (image/document URL, etc.) */
  headerParams?: Array<{ type: "text" | "image"; value: string }>;
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class WhatsAppClient {
  private readonly logger = new Logger(WhatsAppClient.name);
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly phoneNumberId: string;
  private readonly provider: "meta" | "mock";

  constructor() {
    this.provider = (process.env.WHATSAPP_PROVIDER ?? "mock") as "meta" | "mock";
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    this.apiToken = process.env.WHATSAPP_API_TOKEN ?? "";
    this.apiUrl =
      process.env.WHATSAPP_API_URL ??
      `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`;
  }

  async sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    if (this.provider === "mock") {
      return this.sendMock(message);
    }

    return this.sendMeta(message);
  }

  // ---------------------------------------------------------------------------
  // Meta Cloud API
  // ---------------------------------------------------------------------------
  private async sendMeta(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    if (!this.apiToken || !this.phoneNumberId) {
      this.logger.warn("WhatsApp credentials not configured – skipping send");
      logTelemetry("whatsapp.send_skipped", {
        reason: "missing_credentials",
        to: message.to,
        template: message.templateName
      });
      return { success: false, error: "missing_credentials" };
    }

    const body = this.buildMetaPayload(message);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const json = (await response.json()) as {
        messages?: Array<{ id: string }>;
        error?: { message: string; code: number };
      };

      if (!response.ok || json.error) {
        const errMsg = json.error?.message ?? `HTTP ${response.status}`;
        this.logger.error(`WhatsApp send failed: ${errMsg}`, { to: message.to });
        logTelemetry("whatsapp.send_failed", {
          to: message.to,
          template: message.templateName,
          error: errMsg,
          status: response.status
        });
        return { success: false, error: errMsg };
      }

      const messageId = json.messages?.[0]?.id ?? "unknown";
      logTelemetry("whatsapp.send_success", {
        to: message.to,
        template: message.templateName,
        message_id: messageId
      });
      return { success: true, messageId };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`WhatsApp send error: ${errMsg}`);
      logTelemetry("whatsapp.send_error", {
        to: message.to,
        template: message.templateName,
        error: errMsg
      });
      return { success: false, error: errMsg };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------------------------------------------------------------------------
  // Mock (local dev / test)
  // ---------------------------------------------------------------------------
  private sendMock(message: WhatsAppTemplateMessage): WhatsAppSendResult {
    const fakeId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.logger.log(
      `[MOCK] WhatsApp → ${message.to} | template=${message.templateName} | params=${JSON.stringify(message.bodyParams ?? [])}`
    );
    logTelemetry("whatsapp.send_mock", {
      to: message.to,
      template: message.templateName,
      body_params: message.bodyParams ?? [],
      mock_message_id: fakeId
    });
    return { success: true, messageId: fakeId };
  }

  // ---------------------------------------------------------------------------
  // Payload builder
  // ---------------------------------------------------------------------------
  private buildMetaPayload(message: WhatsAppTemplateMessage) {
    const components: Array<Record<string, unknown>> = [];

    if (message.headerParams?.length) {
      components.push({
        type: "header",
        parameters: message.headerParams.map((p) =>
          p.type === "image"
            ? { type: "image", image: { link: p.value } }
            : { type: "text", text: p.value }
        )
      });
    }

    if (message.bodyParams?.length) {
      components.push({
        type: "body",
        parameters: message.bodyParams.map((text) => ({ type: "text", text }))
      });
    }

    return {
      messaging_product: "whatsapp",
      to: message.to.replace(/^\+/, ""), // Meta wants country-code without '+'
      type: "template",
      template: {
        name: message.templateName,
        language: { code: message.languageCode },
        ...(components.length > 0 ? { components } : {})
      }
    };
  }
}
