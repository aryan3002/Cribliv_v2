export interface FeatureFlags {
  ff_agentic_router_enabled: boolean;
  ff_otp_send_enabled: boolean;
  ff_auto_verify_enabled: boolean;
  ff_bill_match_blocking: boolean;
  ff_auto_refund_enabled: boolean;
  ff_contact_unlock_enabled: boolean;
  ff_owner_self_publish_enabled: boolean;
  ff_hi_locale_enabled: boolean;
  ff_search_sort_advanced: boolean;
  ff_heavy_analytics: boolean;
  ff_credit_purchase_enabled: boolean;
  ff_admin_wallet_adjust: boolean;
}

export const defaultFeatureFlags: FeatureFlags = {
  ff_agentic_router_enabled: true,
  ff_otp_send_enabled: true,
  ff_auto_verify_enabled: false,
  ff_bill_match_blocking: true,
  ff_auto_refund_enabled: true,
  ff_contact_unlock_enabled: true,
  ff_owner_self_publish_enabled: false,
  ff_hi_locale_enabled: true,
  ff_search_sort_advanced: false,
  ff_heavy_analytics: false,
  ff_credit_purchase_enabled: false,
  ff_admin_wallet_adjust: true
};
