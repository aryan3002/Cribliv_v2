import { Injectable, Logger } from "@nestjs/common";
import { logTelemetry } from "../../common/telemetry";

/**
 * WhatsApp Business API (WABA) client.
 *
 * Sends template-based messages through one of three transports, selected by
 * WHATSAPP_PROVIDER:
 *
 *   mock — logs the payload; default for local dev and tests
 *   d7   — D7 Networks' proxy. D7 ran the Meta embedded-signup that created the
 *          CribLiv WABA, so it holds the Meta credentials and we never see a
 *          phone_number_id or Meta token. This is our live path.
 *   meta — Meta Cloud API direct. Only usable if we ever hold our own
 *          credentials; kept because it is the cheaper long-run route.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
 *       https://d7networks.com/docs/whatsapp/send-templated-message/authentication-template-message/
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
  /**
   * Parameters for a template's button component. Authentication templates
   * require this — Meta renders a copy-code button and the code must be
   * repeated here as well as in the body.
   */
  buttonParams?: string[];
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
  private readonly provider: "meta" | "d7" | "mock";
  /** D7-issued bearer token; falls back to the shared D7_KEY used for SMS. */
  private readonly d7Token: string;
  /** The WhatsApp number registered with D7, in E.164. */
  private readonly d7Originator: string;
  private readonly d7Url: string;

  constructor() {
    this.provider = (process.env.WHATSAPP_PROVIDER ?? "mock") as "meta" | "d7" | "mock";
    this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    this.apiToken = process.env.WHATSAPP_API_TOKEN ?? "";
    this.apiUrl =
      process.env.WHATSAPP_API_URL ??
      `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`;
    this.d7Token = process.env.D7_WHATSAPP_TOKEN ?? process.env.D7_KEY ?? "";
    this.d7Originator = process.env.WHATSAPP_ORIGINATOR ?? "";
    this.d7Url = process.env.D7_WHATSAPP_URL ?? "https://api.d7networks.com/whatsapp/v2/send";
  }

  async sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    if (this.provider === "mock") {
      return this.sendMock(message);
    }

    if (this.provider === "d7") {
      return this.sendD7(message);
    }

    return this.sendMeta(message);
  }

  // ---------------------------------------------------------------------------
  // D7 Networks proxy
  // ---------------------------------------------------------------------------
  private async sendD7(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    if (!this.d7Token || !this.d7Originator) {
      this.logger.warn("D7 WhatsApp credentials not configured – skipping send");
      logTelemetry("whatsapp.send_skipped", {
        reason: "missing_credentials",
        to: message.to,
        template: message.templateName
      });
      return { success: false, error: "missing_credentials" };
    }

    // D7 carries the code only in the button's action_payload — unlike Meta,
    // there is no separate body parameter. Meta fills the visible body text
    // from the same code on its side.
    const code = message.buttonParams?.[0] ?? message.bodyParams?.[0] ?? "";
    const body = {
      messages: [
        {
          originator: this.d7Originator,
          content: {
            message_type: "TEMPLATE",
            template: {
              template_id: message.templateName,
              language: message.languageCode,
              buttons: {
                actions: [{ action_index: "0", action_type: "url", action_payload: code }]
              }
            }
          },
          recipients: [{ recipient: message.to, recipient_type: "individual" }]
        }
      ]
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(this.d7Url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.d7Token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const json = (await response.json().catch(() => ({}))) as {
        request_id?: string;
        detail?: unknown;
      };

      if (!response.ok) {
        const errMsg = `d7 ${response.status}: ${JSON.stringify(json.detail ?? json)}`;
        this.logger.error(`D7 WhatsApp send failed: ${errMsg}`, { to: message.to });
        logTelemetry("whatsapp.send_failed", {
          to: message.to,
          template: message.templateName,
          error: errMsg,
          status: response.status
        });
        return { success: false, error: errMsg };
      }

      const messageId = json.request_id ?? "unknown";
      logTelemetry("whatsapp.send_success", {
        to: message.to,
        template: message.templateName,
        message_id: messageId
      });
      return { success: true, messageId };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`D7 WhatsApp send error: ${errMsg}`);
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

    if (message.buttonParams?.length) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: message.buttonParams.map((text) => ({ type: "text", text }))
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
