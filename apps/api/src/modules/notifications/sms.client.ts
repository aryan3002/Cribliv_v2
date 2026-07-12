import { Injectable, Logger } from "@nestjs/common";

/**
 * D7 Networks SMS client.
 *
 * Sends transactional SMS via the D7 messaging API. In dev/test, logs
 * payloads instead of hitting the real API when SMS_PROVIDER=mock
 * (default for local dev). Mirrors WhatsAppClient's shape/provider-switch
 * pattern.
 *
 * Docs: https://d7networks.com/docs/Messages/Send_Messages/
 */

export interface SmsMessage {
  to: string; // E.164
  body: string;
}
export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 8_000;

@Injectable()
export class SmsClient {
  private readonly logger = new Logger(SmsClient.name);
  private readonly provider = (process.env.SMS_PROVIDER ?? "mock") as "d7" | "mock";
  private readonly apiKey = process.env.D7_KEY ?? "";
  private readonly url = process.env.D7_SMS_URL ?? "https://api.d7networks.com/messages/v1/send";
  private readonly originator = process.env.SMS_SENDER_ID ?? process.env.OTP_SENDER_ID ?? "CribLiv";

  async sendSms(message: SmsMessage): Promise<SmsSendResult> {
    if (this.provider === "mock") {
      this.logger.log(`[mock-sms] to=${message.to} body=${message.body.slice(0, 40)}…`);
      return { success: true, messageId: `mock_sms_${Date.now()}` };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              channel: "sms",
              recipients: [message.to],
              content: message.body,
              msg_type: "text",
              data_coding: "text"
            }
          ],
          message_globals: { originator: this.originator }
        }),
        signal: controller.signal
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { success: false, error: `d7 ${res.status}` };
      return { success: true, messageId: String((json as any).request_id ?? "") };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
