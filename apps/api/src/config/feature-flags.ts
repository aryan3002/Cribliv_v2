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
  ff_owner_listing_assisted_capture: boolean;
  ff_production_db_only: boolean;
  /** Phase B – AI-Ready */
  ff_ai_intent_classifier: boolean;
  ff_ai_embeddings: boolean;
  ff_ai_ranking: boolean;
  ff_ai_conversation_context: boolean;
  /** Phase C – Voice */
  ff_voice_search: boolean;
  /** Phase D – Conversational Hindi Voice Agent */
  ff_voice_agent_enabled: boolean;
  /** Phase E – Geo, Analytics, Leads, Fraud, Boost, Map, Admin */
  ff_geo_search_enabled: boolean;
  ff_listing_analytics_enabled: boolean;
  ff_lead_management_enabled: boolean;
  ff_fraud_detection_enabled: boolean;
  ff_availability_toggle_enabled: boolean;
  ff_featured_listings_enabled: boolean;
  ff_map_browsing_enabled: boolean;
  ff_extended_search_filters_enabled: boolean;
  ff_similar_listings_enabled: boolean;
  ff_popular_localities_enabled: boolean;
  ff_admin_analytics_enabled: boolean;
  ff_partial_phone_reveal_enabled: boolean;
  /** Phase F – Monetisation / Alerts / Verification */
  ff_subscription_plans_enabled: boolean;
  ff_pricing_intel_enabled: boolean;
  ff_saved_search_alerts_enabled: boolean;
  ff_bill_ocr_enabled: boolean;
  ff_aadhaar_ekyc_enabled: boolean;
  /** Phase G – CriblMap Advanced */
  ff_seeker_pins_enabled: boolean;
  ff_locality_insights_enabled: boolean;
  ff_alert_zones_enabled: boolean;
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
  ff_owner_listing_assisted_capture: false,
  ff_production_db_only: true,
  /** Phase B – AI-Ready (default OFF until Azure credentials configured) */
  ff_ai_intent_classifier: false,
  ff_ai_embeddings: false,
  ff_ai_ranking: false,
  ff_ai_conversation_context: false,
  /** Phase C – Voice (default OFF) */
  ff_voice_search: false,
  /** Phase D – Conversational Hindi Voice Agent (default OFF) */
  ff_voice_agent_enabled: false,
  /** Phase E – Platform features (default OFF) */
  ff_geo_search_enabled: false,
  ff_listing_analytics_enabled: false,
  ff_lead_management_enabled: false,
  ff_fraud_detection_enabled: false,
  ff_availability_toggle_enabled: false,
  ff_featured_listings_enabled: false,
  ff_map_browsing_enabled: false,
  ff_extended_search_filters_enabled: false,
  ff_similar_listings_enabled: false,
  ff_popular_localities_enabled: false,
  ff_admin_analytics_enabled: true,
  ff_partial_phone_reveal_enabled: false,
  /** Phase F – Monetisation / Alerts / Verification (default OFF) */
  ff_subscription_plans_enabled: false,
  ff_pricing_intel_enabled: false,
  ff_saved_search_alerts_enabled: false,
  ff_bill_ocr_enabled: false,
  ff_aadhaar_ekyc_enabled: false,
  /** Phase G – CriblMap Advanced (default OFF) */
  ff_seeker_pins_enabled: false,
  ff_locality_insights_enabled: false,
  ff_alert_zones_enabled: false
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
    ff_owner_listing_assisted_capture: parseBooleanEnv(
      "FF_OWNER_LISTING_ASSISTED_CAPTURE",
      defaultFeatureFlags.ff_owner_listing_assisted_capture
    ),
    ff_production_db_only: parseBooleanEnv(
      "FF_PRODUCTION_DB_ONLY",
      defaultFeatureFlags.ff_production_db_only
    ),
    ff_ai_intent_classifier: parseBooleanEnv(
      "FF_AI_INTENT_CLASSIFIER",
      defaultFeatureFlags.ff_ai_intent_classifier
    ),
    ff_ai_embeddings: parseBooleanEnv("FF_AI_EMBEDDINGS", defaultFeatureFlags.ff_ai_embeddings),
    ff_ai_ranking: parseBooleanEnv("FF_AI_RANKING", defaultFeatureFlags.ff_ai_ranking),
    ff_ai_conversation_context: parseBooleanEnv(
      "FF_AI_CONVERSATION_CONTEXT",
      defaultFeatureFlags.ff_ai_conversation_context
    ),
    ff_voice_search: parseBooleanEnv("FF_VOICE_SEARCH", defaultFeatureFlags.ff_voice_search),
    ff_voice_agent_enabled: parseBooleanEnv(
      "FF_VOICE_AGENT_ENABLED",
      defaultFeatureFlags.ff_voice_agent_enabled
    ),
    ff_geo_search_enabled: parseBooleanEnv(
      "FF_GEO_SEARCH_ENABLED",
      defaultFeatureFlags.ff_geo_search_enabled
    ),
    ff_listing_analytics_enabled: parseBooleanEnv(
      "FF_LISTING_ANALYTICS_ENABLED",
      defaultFeatureFlags.ff_listing_analytics_enabled
    ),
    ff_lead_management_enabled: parseBooleanEnv(
      "FF_LEAD_MANAGEMENT_ENABLED",
      defaultFeatureFlags.ff_lead_management_enabled
    ),
    ff_fraud_detection_enabled: parseBooleanEnv(
      "FF_FRAUD_DETECTION_ENABLED",
      defaultFeatureFlags.ff_fraud_detection_enabled
    ),
    ff_availability_toggle_enabled: parseBooleanEnv(
      "FF_AVAILABILITY_TOGGLE_ENABLED",
      defaultFeatureFlags.ff_availability_toggle_enabled
    ),
    ff_featured_listings_enabled: parseBooleanEnv(
      "FF_FEATURED_LISTINGS_ENABLED",
      defaultFeatureFlags.ff_featured_listings_enabled
    ),
    ff_map_browsing_enabled: parseBooleanEnv(
      "FF_MAP_BROWSING_ENABLED",
      defaultFeatureFlags.ff_map_browsing_enabled
    ),
    ff_extended_search_filters_enabled: parseBooleanEnv(
      "FF_EXTENDED_SEARCH_FILTERS_ENABLED",
      defaultFeatureFlags.ff_extended_search_filters_enabled
    ),
    ff_similar_listings_enabled: parseBooleanEnv(
      "FF_SIMILAR_LISTINGS_ENABLED",
      defaultFeatureFlags.ff_similar_listings_enabled
    ),
    ff_popular_localities_enabled: parseBooleanEnv(
      "FF_POPULAR_LOCALITIES_ENABLED",
      defaultFeatureFlags.ff_popular_localities_enabled
    ),
    ff_admin_analytics_enabled: parseBooleanEnv(
      "FF_ADMIN_ANALYTICS_ENABLED",
      defaultFeatureFlags.ff_admin_analytics_enabled
    ),
    ff_partial_phone_reveal_enabled: parseBooleanEnv(
      "FF_PARTIAL_PHONE_REVEAL_ENABLED",
      defaultFeatureFlags.ff_partial_phone_reveal_enabled
    ),
    ff_subscription_plans_enabled: parseBooleanEnv(
      "FF_SUBSCRIPTION_PLANS_ENABLED",
      defaultFeatureFlags.ff_subscription_plans_enabled
    ),
    ff_pricing_intel_enabled: parseBooleanEnv(
      "FF_PRICING_INTEL_ENABLED",
      defaultFeatureFlags.ff_pricing_intel_enabled
    ),
    ff_saved_search_alerts_enabled: parseBooleanEnv(
      "FF_SAVED_SEARCH_ALERTS_ENABLED",
      defaultFeatureFlags.ff_saved_search_alerts_enabled
    ),
    ff_bill_ocr_enabled: parseBooleanEnv(
      "FF_BILL_OCR_ENABLED",
      defaultFeatureFlags.ff_bill_ocr_enabled
    ),
    ff_aadhaar_ekyc_enabled: parseBooleanEnv(
      "FF_AADHAAR_EKYC_ENABLED",
      defaultFeatureFlags.ff_aadhaar_ekyc_enabled
    ),
    ff_seeker_pins_enabled: parseBooleanEnv(
      "FF_SEEKER_PINS_ENABLED",
      defaultFeatureFlags.ff_seeker_pins_enabled
    ),
    ff_locality_insights_enabled: parseBooleanEnv(
      "FF_LOCALITY_INSIGHTS_ENABLED",
      defaultFeatureFlags.ff_locality_insights_enabled
    ),
    ff_alert_zones_enabled: parseBooleanEnv(
      "FF_ALERT_ZONES_ENABLED",
      defaultFeatureFlags.ff_alert_zones_enabled
    )
  };
}
