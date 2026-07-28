import { Inject, Injectable } from "@nestjs/common";
import { D7OtpClient, D7OtpVerifyError } from "../d7-otp.client";
import { readOtpProviderConfig } from "../otp-provider.config";
import {
  MARKER_PREFIX_D7,
  OtpVerifyError,
  type OtpProvider,
  type OtpSendResult
} from "./otp-provider.interface";

/**
 * Wraps the existing D7OtpClient unchanged. Behaviour must stay identical to
 * the pre-refactor AuthService path — test/auth-d7.provider.test.ts is the gate.
 */
@Injectable()
export class D7OtpProvider implements OtpProvider {
  readonly name = "d7" as const;

  constructor(@Inject(D7OtpClient) private readonly client: D7OtpClient) {}

  async send(input: { phoneE164: string }): Promise<OtpSendResult> {
    const config = readOtpProviderConfig();
    const expirySec = config.provider === "d7" ? config.expirySec : 300;
    const result = await this.client.sendOtp({ phoneE164: input.phoneE164 });
    return { marker: `${MARKER_PREFIX_D7}${result.otpId}`, expirySec };
  }

  async verify(input: { marker: string; code: string }): Promise<void> {
    const otpId = input.marker.slice(MARKER_PREFIX_D7.length);
    try {
      await this.client.verifyOtp({ otpId, otpCode: input.code });
    } catch (error) {
      if (error instanceof D7OtpVerifyError) {
        throw new OtpVerifyError(error.code, error.message);
      }
      throw error;
    }
  }
}
