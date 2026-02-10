import { readFeatureFlags } from "../../../config/feature-flags";

export interface VerificationProviderConfig {
  enabled: boolean;
  timeoutMs: number;
  liveness: {
    url: string;
    apiKey: string;
    providerName: string;
  };
  electricity: {
    url: string;
    apiKey: string;
    providerName: string;
  };
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function trimOrEmpty(raw: string | undefined): string {
  return raw?.trim() ?? "";
}

export function readVerificationProviderConfig(): VerificationProviderConfig {
  const flags = readFeatureFlags();
  return {
    enabled: flags.ff_real_verification_provider,
    timeoutMs: parsePositiveInt(process.env.VERIFICATION_PROVIDER_TIMEOUT_MS, 5000),
    liveness: {
      url: trimOrEmpty(process.env.LIVENESS_PROVIDER_URL),
      apiKey: trimOrEmpty(process.env.LIVENESS_PROVIDER_API_KEY),
      providerName: trimOrEmpty(process.env.LIVENESS_PROVIDER_NAME) || "mock_liveness_v1"
    },
    electricity: {
      url: trimOrEmpty(process.env.ELECTRICITY_PROVIDER_URL),
      apiKey: trimOrEmpty(process.env.ELECTRICITY_PROVIDER_API_KEY),
      providerName: trimOrEmpty(process.env.ELECTRICITY_PROVIDER_NAME) || "mock_bbps_v1"
    }
  };
}

function assertValidUrl(raw: string, field: string) {
  try {
    new URL(raw);
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }
}

export function assertVerificationProviderConfig() {
  const config = readVerificationProviderConfig();
  if (!config.enabled) {
    return;
  }

  if (!config.liveness.url) {
    throw new Error("LIVENESS_PROVIDER_URL is required when FF_REAL_VERIFICATION_PROVIDER=true");
  }
  if (!config.liveness.apiKey) {
    throw new Error(
      "LIVENESS_PROVIDER_API_KEY is required when FF_REAL_VERIFICATION_PROVIDER=true"
    );
  }
  if (!config.electricity.url) {
    throw new Error("ELECTRICITY_PROVIDER_URL is required when FF_REAL_VERIFICATION_PROVIDER=true");
  }
  if (!config.electricity.apiKey) {
    throw new Error(
      "ELECTRICITY_PROVIDER_API_KEY is required when FF_REAL_VERIFICATION_PROVIDER=true"
    );
  }

  assertValidUrl(config.liveness.url, "LIVENESS_PROVIDER_URL");
  assertValidUrl(config.electricity.url, "ELECTRICITY_PROVIDER_URL");
}
