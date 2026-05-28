export interface FrontendFlags {
  rent_agreement_dev_auth: boolean;
  rent_agreement_use_mock_providers: boolean;
  rent_agreement_show_e_sign: boolean;
  rent_agreement_show_e_stamp: boolean;
  rent_agreement_status_poll_interval_ms: number;
}

export interface FlagsPort {
  get<K extends keyof FrontendFlags>(key: K): FrontendFlags[K];
  refresh(): Promise<void>;
}
