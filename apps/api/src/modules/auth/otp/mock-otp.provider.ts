import { Injectable } from "@nestjs/common";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { OtpVerifyError, type OtpProvider, type OtpSendResult } from "./otp-provider.interface";

/**
 * Local/test provider. The code is stored raw in otp_hash and returned as
 * dev_otp so E2E tests and local logins need no real delivery. Raw storage is
 * acceptable here precisely because this path never runs in production —
 * the WhatsApp provider stores a hash instead.
 */
@Injectable()
export class MockOtpProvider implements OtpProvider {
  readonly name = "mock" as const;

  async send(): Promise<OtpSendResult> {
    const otp = String(randomInt(100000, 999999));
    return { marker: otp, expirySec: 300, devOtp: otp };
  }

  async verify(input: { marker: string; code: string }): Promise<void> {
    const expected = createHash("sha256").update(input.marker, "utf8").digest();
    const provided = createHash("sha256").update(input.code, "utf8").digest();
    if (input.marker.length !== input.code.length || !timingSafeEqual(expected, provided)) {
      throw new OtpVerifyError("invalid_otp", "Invalid OTP");
    }
  }
}
