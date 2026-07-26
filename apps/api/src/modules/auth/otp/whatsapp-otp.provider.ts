import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { WhatsAppClient } from "../../notifications/whatsapp.client";
import {
  MARKER_PREFIX_WHATSAPP,
  OtpUndeliverableError,
  OtpVerifyError,
  type OtpProvider,
  type OtpSendResult
} from "./otp-provider.interface";

/**
 * WhatsApp OTP via Meta Cloud API authentication templates.
 *
 * Unlike D7, Meta neither generates nor verifies codes — it only delivers a
 * message. So this provider is self-managed: we mint the code, persist only
 * its SHA-256, and compare digests on verify. Nothing recoverable is stored.
 *
 * Authentication template content is fixed by Meta ("<CODE> is your
 * verification code") and the code must appear in BOTH the body parameter and
 * the copy-code button parameter.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates
 */

const DEFAULT_EXPIRY_SEC = 300;

/** Meta error codes meaning this recipient can never receive on WhatsApp. */
const UNDELIVERABLE_PATTERNS = [/\b131026\b/, /\b131051\b/, /undeliverable/i];

export function hashOtp(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

@Injectable()
export class WhatsAppOtpProvider implements OtpProvider {
  readonly name = "whatsapp" as const;

  constructor(@Inject(WhatsAppClient) private readonly client: WhatsAppClient) {}

  async send(input: { phoneE164: string; languageCode?: string }): Promise<OtpSendResult> {
    const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME?.trim();
    if (!templateName) {
      throw new HttpException(
        {
          code: "otp_provider_misconfigured",
          message: "WHATSAPP_OTP_TEMPLATE_NAME is required for the whatsapp channel"
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const otp = String(randomInt(100000, 999999));
    const result = await this.client.sendTemplate({
      to: input.phoneE164,
      templateName,
      languageCode: input.languageCode ?? "en",
      bodyParams: [otp],
      buttonParams: [otp]
    });

    if (!result.success) {
      const error = result.error ?? "unknown";
      // A recipient with no WhatsApp account is a permanent condition, so
      // AuthService should fall back to SMS immediately. A timeout or 5xx is
      // transient and must NOT silently burn an expensive SMS.
      if (UNDELIVERABLE_PATTERNS.some((pattern) => pattern.test(error))) {
        throw new OtpUndeliverableError(error);
      }
      throw new HttpException(
        { code: "otp_provider_error", message: "Failed to send OTP. Please try again." },
        HttpStatus.BAD_GATEWAY
      );
    }

    return {
      marker: `${MARKER_PREFIX_WHATSAPP}${hashOtp(otp)}`,
      expirySec: this.expirySec()
    };
  }

  async verify(input: { marker: string; code: string }): Promise<void> {
    const expectedHex = input.marker.slice(MARKER_PREFIX_WHATSAPP.length);
    const expected = Buffer.from(expectedHex, "hex");
    const provided = createHash("sha256").update(input.code, "utf8").digest();

    // A malformed marker decodes to the wrong length rather than throwing —
    // treat it as a failed comparison, never as a crash.
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new OtpVerifyError("invalid_otp", "Invalid OTP");
    }
  }

  private expirySec(): number {
    const raw = Number(process.env.WHATSAPP_OTP_EXPIRY_SEC);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_EXPIRY_SEC;
  }
}
