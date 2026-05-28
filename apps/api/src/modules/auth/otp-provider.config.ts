import { InternalServerErrorException } from "@nestjs/common";

export type OtpProvider = "mock" | "d7";

interface OtpProviderConfigBase {
  provider: OtpProvider;
}

export interface D7OtpProviderConfig extends OtpProviderConfigBase {
  provider: "d7";
  apiKey: string;
  baseUrl: string;
  originator: string;
  contentTemplate: string;
  expirySec: number;
}

export interface MockOtpProviderConfig extends OtpProviderConfigBase {
  provider: "mock";
}

export type OtpProviderConfig = D7OtpProviderConfig | MockOtpProviderConfig;

const DEFAULT_D7_BASE_URL = "https://api.d7networks.com";
const DEFAULT_D7_TEMPLATE = "Greetings from CribLiv, your mobile verification code is: {}";
const DEFAULT_D7_EXPIRY_SEC = 300;
const DEFAULT_ORIGINATOR = "CribLiv";

function parseOtpProvider(raw: string | undefined): OtpProvider {
  if (!raw) {
    return "mock";
  }
  const provider = raw.trim().toLowerCase();
  if (provider === "mock" || provider === "d7") {
    return provider;
  }
  throw new InternalServerErrorException({
    code: "otp_provider_misconfigured",
    message: "Unsupported OTP provider"
  });
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InternalServerErrorException({
      code: "otp_provider_misconfigured",
      message: "Invalid OTP provider numeric config"
    });
  }
  return Math.floor(parsed);
}

export function readOtpProviderConfig(): OtpProviderConfig {
  const provider = parseOtpProvider(process.env.OTP_PROVIDER);
  if (provider === "mock") {
    return { provider: "mock" };
  }

  const apiKey = process.env.D7_KEY?.trim();
  if (!apiKey) {
    throw new InternalServerErrorException({
      code: "otp_provider_misconfigured",
      message: "D7_KEY is required when OTP_PROVIDER=d7"
    });
  }

  const baseUrl = (process.env.D7_BASE_URL?.trim() || DEFAULT_D7_BASE_URL).replace(/\/+$/, "");
  const contentTemplate = process.env.D7_OTP_CONTENT_TEMPLATE?.trim() || DEFAULT_D7_TEMPLATE;
  const originator = process.env.OTP_SENDER_ID?.trim() || DEFAULT_ORIGINATOR;
  const expirySec = parsePositiveInt(process.env.D7_OTP_EXPIRY_SEC, DEFAULT_D7_EXPIRY_SEC);

  return {
    provider: "d7",
    apiKey,
    baseUrl,
    originator,
    contentTemplate,
    expirySec
  };
}
