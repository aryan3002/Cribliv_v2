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
  ff_real_verification_provider: boolean;
  ff_pg_sales_leads: boolean;
  ff_production_db_only: boolean;
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
  ff_admin_wallet_adjust: true,
  ff_real_verification_provider: false,
  ff_pg_sales_leads: true,
  ff_production_db_only: true
};

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function readFeatureFlags(): FeatureFlags {
  return {
    ff_agentic_router_enabled: parseBooleanEnv(
      "FF_AGENTIC_ROUTER_ENABLED",
      defaultFeatureFlags.ff_agentic_router_enabled
    ),
    ff_otp_send_enabled: parseBooleanEnv(
      "FF_OTP_SEND_ENABLED",
      defaultFeatureFlags.ff_otp_send_enabled
    ),
    ff_auto_verify_enabled: parseBooleanEnv(
      "FF_AUTO_VERIFY_ENABLED",
      defaultFeatureFlags.ff_auto_verify_enabled
    ),
    ff_bill_match_blocking: parseBooleanEnv(
      "FF_BILL_MATCH_BLOCKING",
      defaultFeatureFlags.ff_bill_match_blocking
    ),
    ff_auto_refund_enabled: parseBooleanEnv(
      "FF_AUTO_REFUND_ENABLED",
      defaultFeatureFlags.ff_auto_refund_enabled
    ),
    ff_contact_unlock_enabled: parseBooleanEnv(
      "FF_CONTACT_UNLOCK_ENABLED",
      defaultFeatureFlags.ff_contact_unlock_enabled
    ),
    ff_owner_self_publish_enabled: parseBooleanEnv(
      "FF_OWNER_SELF_PUBLISH_ENABLED",
      defaultFeatureFlags.ff_owner_self_publish_enabled
    ),
    ff_hi_locale_enabled: parseBooleanEnv(
      "FF_HI_LOCALE_ENABLED",
      defaultFeatureFlags.ff_hi_locale_enabled
    ),
    ff_search_sort_advanced: parseBooleanEnv(
      "FF_SEARCH_SORT_ADVANCED",
      defaultFeatureFlags.ff_search_sort_advanced
    ),
    ff_heavy_analytics: parseBooleanEnv(
      "FF_HEAVY_ANALYTICS",
      defaultFeatureFlags.ff_heavy_analytics
    ),
    ff_credit_purchase_enabled: parseBooleanEnv(
      "FF_CREDIT_PURCHASE_ENABLED",
      defaultFeatureFlags.ff_credit_purchase_enabled
    ),
    ff_admin_wallet_adjust: parseBooleanEnv(
      "FF_ADMIN_WALLET_ADJUST",
      defaultFeatureFlags.ff_admin_wallet_adjust
    ),
    ff_real_verification_provider: parseBooleanEnv(
      "FF_REAL_VERIFICATION_PROVIDER",
      defaultFeatureFlags.ff_real_verification_provider
    ),
    ff_pg_sales_leads: parseBooleanEnv("FF_PG_SALES_LEADS", defaultFeatureFlags.ff_pg_sales_leads),
    ff_production_db_only: parseBooleanEnv(
      "FF_PRODUCTION_DB_ONLY",
      defaultFeatureFlags.ff_production_db_only
    )
  };
}
