import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { type D7OtpProviderConfig, readOtpProviderConfig } from "./otp-provider.config";

type D7OtpVerifyCode = "invalid_otp" | "otp_expired";

export class D7OtpVerifyError extends Error {
  code: D7OtpVerifyCode;

  constructor(code: D7OtpVerifyCode, message: string) {
    super(message);
    this.name = "D7OtpVerifyError";
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 8_000;

@Injectable()
export class D7OtpClient {
  private getConfig(): D7OtpProviderConfig {
    const config = readOtpProviderConfig();
    if (config.provider !== "d7") {
      throw new HttpException(
        {
          code: "otp_provider_misconfigured",
          message: "D7 OTP client cannot be used when OTP_PROVIDER is not d7"
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    return config;
  }

  async sendOtp(input: { phoneE164: string }) {
    const config = this.getConfig();
    let response: { otp_id?: string };
    try {
      response = await this.request<{ otp_id?: string }>(
        `${config.baseUrl}/verify/v1/otp/send-otp`,
        {
          originator: config.originator,
          recipient: input.phoneE164,
          content: config.contentTemplate,
          expiry: String(config.expirySec),
          data_coding: "text"
        },
        config
      );
    } catch {
      throw new HttpException(
        {
          code: "otp_provider_error",
          message: "Failed to send OTP. Please try again."
        },
        HttpStatus.BAD_GATEWAY
      );
    }

    const otpId = response?.otp_id?.trim();
    if (!otpId) {
      throw new HttpException(
        {
          code: "otp_provider_error",
          message: "OTP provider did not return otp_id"
        },
        HttpStatus.BAD_GATEWAY
      );
    }
    return { otpId };
  }

  async verifyOtp(input: { otpId: string; otpCode: string }) {
    const config = this.getConfig();
    try {
      await this.request(
        `${config.baseUrl}/verify/v1/otp/verify-otp`,
        {
          otp_id: input.otpId,
          otp_code: input.otpCode
        },
        config
      );
      return { success: true as const };
    } catch (error) {
      if (error instanceof HttpException) {
        const status = error.getStatus();
        if (status === 400 || status === 401) {
          throw new D7OtpVerifyError("invalid_otp", "Invalid OTP");
        }
        if (status === 404 || status === 410) {
          throw new D7OtpVerifyError("otp_expired", "OTP expired");
        }
      }
      throw error;
    }
  }

  private async request<T>(
    url: string,
    payload: Record<string, string>,
    config: D7OtpProviderConfig
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        throw new HttpException(
          {
            code: "otp_provider_error",
            message: "OTP provider request failed",
            details: {
              status: response.status,
              response: json
            }
          },
          response.status
        );
      }

      return json as T;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        {
          code: "otp_provider_error",
          message: "OTP provider request failed"
        },
        HttpStatus.BAD_GATEWAY
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
