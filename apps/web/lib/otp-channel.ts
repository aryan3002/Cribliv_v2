/**
 * Shared OTP-channel state for the three places that request a code:
 * both login pages and the contact-unlock panel.
 *
 * The API tells us which channel actually delivered the code and whether the
 * SMS escape hatch has been earned yet (it opens after two WhatsApp attempts).
 * Both fields are optional here on purpose: a web deploy that lands before the
 * API deploy sees neither, and must degrade to the old generic copy rather
 * than render "undefined" or offer a fallback the server would refuse.
 */

export type OtpChannel = "whatsapp" | "sms" | "mock";

export interface OtpSendData {
  challenge_id: string;
  expires_in_sec?: number;
  retry_after_sec?: number;
  /** Absent on an API older than the WhatsApp-first release. */
  channel?: OtpChannel;
  /** Absent on an older API; treated as "not available". */
  sms_fallback_available?: boolean;
  /** Mock provider only. */
  dev_otp?: string;
}

/**
 * What to tell the user about where their code went. Falls back to the
 * pre-WhatsApp wording when the API didn't say.
 */
export function describeOtpChannel(channel: OtpChannel | undefined, phone: string): string {
  switch (channel) {
    case "whatsapp":
      return `Code sent to your WhatsApp on ${phone}`;
    case "sms":
      return `Code sent by SMS to ${phone}`;
    default:
      return `OTP sent to ${phone}`;
  }
}

/** Label for the resend control, which stays on whichever channel was used. */
export function resendLabel(channel: OtpChannel | undefined): string {
  return channel === "whatsapp" ? "Resend on WhatsApp" : "Resend code";
}

/**
 * The SMS fallback is only offered when the server says it has been earned.
 * Deliberately conservative: an undefined flag means "no", so we never render
 * a button whose request the server would silently downgrade back to WhatsApp.
 */
export function canOfferSmsFallback(data: Pick<OtpSendData, "sms_fallback_available">): boolean {
  return data.sms_fallback_available === true;
}
