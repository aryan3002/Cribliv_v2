import type { FlagsPort, FrontendFlags } from "./flags";

export const DEFAULT_FLAGS: FrontendFlags = {
  rent_agreement_dev_auth: false,
  rent_agreement_use_mock_providers: false,
  rent_agreement_show_e_sign: true,
  rent_agreement_show_e_stamp: true,
  rent_agreement_status_poll_interval_ms: 1000
};

const ENV_KEY_MAP: Record<keyof FrontendFlags, string> = {
  rent_agreement_dev_auth: "NEXT_PUBLIC_RENT_AGREEMENT_DEV_AUTH",
  rent_agreement_use_mock_providers: "NEXT_PUBLIC_RENT_AGREEMENT_USE_MOCK_PROVIDERS",
  rent_agreement_show_e_sign: "NEXT_PUBLIC_RENT_AGREEMENT_SHOW_E_SIGN",
  rent_agreement_show_e_stamp: "NEXT_PUBLIC_RENT_AGREEMENT_SHOW_E_STAMP",
  rent_agreement_status_poll_interval_ms: "NEXT_PUBLIC_RENT_AGREEMENT_STATUS_POLL_INTERVAL_MS"
};

export class EnvFlagsAdapter implements FlagsPort {
  private readonly resolved: FrontendFlags;

  constructor(
    env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
  ) {
    this.resolved = { ...DEFAULT_FLAGS };
    for (const key of Object.keys(ENV_KEY_MAP) as (keyof FrontendFlags)[]) {
      const envKey = ENV_KEY_MAP[key];
      const raw = env[envKey];
      if (raw === undefined) continue;
      const defaultValue = DEFAULT_FLAGS[key];
      if (typeof defaultValue === "boolean") {
        (this.resolved as unknown as Record<string, unknown>)[key] = raw === "true";
      } else if (typeof defaultValue === "number") {
        const n = Number(raw);
        if (Number.isFinite(n)) (this.resolved as unknown as Record<string, unknown>)[key] = n;
      }
    }
  }

  get<K extends keyof FrontendFlags>(key: K): FrontendFlags[K] {
    return this.resolved[key];
  }

  async refresh(): Promise<void> {
    /* no-op for env-driven */
  }
}
