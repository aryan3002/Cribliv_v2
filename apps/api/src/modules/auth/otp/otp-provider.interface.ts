/**
 * Provider-agnostic contract for login OTP delivery.
 *
 * AuthService owns rate limiting, the otp_challenges row lifecycle, attempt
 * counting and session minting. A provider owns only two things: putting a
 * code in front of the user, and later confirming a submitted code.
 *
 * `marker` is whatever the provider needs persisted in
 * otp_challenges.otp_hash to verify later. It doubles as the discriminator
 * that routes a verify back to the channel that issued that code, so changing
 * the configured channel cannot strand an in-flight login.
 */

export type OtpVerifyErrorCode = "invalid_otp" | "otp_expired";

export class OtpVerifyError extends Error {
  readonly code: OtpVerifyErrorCode;

  constructor(code: OtpVerifyErrorCode, message: string) {
    super(message);
    this.name = "OtpVerifyError";
    this.code = code;
  }
}

/**
 * Thrown when the provider knows, synchronously, that this recipient can
 * never receive on this channel — e.g. Meta reporting the number has no
 * WhatsApp account. Distinct from a transient failure: AuthService reacts by
 * falling back to SMS immediately, whereas a transient failure surfaces as an
 * error so we do not silently burn an expensive SMS on a blip.
 */
export class OtpUndeliverableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpUndeliverableError";
  }
}

export interface OtpSendResult {
  /** Persisted verbatim into otp_challenges.otp_hash. */
  marker: string;
  /** Drives the challenge row's expires_at and the API's expires_in_sec. */
  expirySec: number;
  /** Only the mock provider populates this; surfaced as dev_otp. */
  devOtp?: string;
}

export interface OtpProvider {
  readonly name: "mock" | "whatsapp" | "d7";
  send(input: { phoneE164: string; languageCode?: string }): Promise<OtpSendResult>;
  /** Resolves on success. Throws OtpVerifyError on a bad or expired code. */
  verify(input: { marker: string; phoneE164: string; code: string }): Promise<void>;
}

export const MARKER_PREFIX_D7 = "d7:";
export const MARKER_PREFIX_WHATSAPP = "wa:";
