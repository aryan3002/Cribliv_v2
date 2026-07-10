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
  /** Phase D.2 – Azure OpenAI Realtime concierge ("Maya") via WebRTC */
  ff_voice_agent_realtime: boolean;
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
  /** Phase G – Rent Agreement v2 (backend) */
  ff_rent_agreement_enabled: boolean;
  ff_rent_agreement_admin_enabled: boolean;
  /** Phase H – PG Operator V1 */
  ff_pg_operator_v1: boolean;
  ff_pg_listing_wizard_enabled: boolean;
  ff_pg_voice_agent_enabled: boolean;
  ff_pg_voice_agent_realtime: boolean;
  ff_pg_dashboard_enabled: boolean;
  ff_pg_dashboard_listing_health: boolean;
  ff_pg_dashboard_leads_inbox: boolean;
  ff_pg_segmentation_v2: boolean;
  ff_pg_multi_property_enabled: boolean;
  /** Phase H+ – PG Operator V2..V8 (declared early for compile-time awareness, all OFF in V1) */
  ff_pg_bed_mgmt: boolean;
  ff_pg_tenant_portal: boolean;
  ff_pg_rent_collection: boolean;
  ff_pg_food: boolean;
  ff_pg_ops_full: boolean;
  ff_pg_agreement: boolean;
  ff_pg_comms: boolean;
  /** Phase H – PG Listing Finalization (Plan 2) */
  ff_pg_listing_score: boolean;
  ff_pg_ai_assist: boolean;
  ff_pg_fraud_ai: boolean;
  /** Phase J/K – PG Voice listing + admin analytics (Plan 3) */
  ff_pg_voice_listing: boolean;
  ff_pg_admin_analytics: boolean;
  ff_programmatic_seo_cities_enabled: boolean;
  /** Slice 3 - Blog / content engine (worker generation + admin tab). */
  ff_seo_blog: boolean;
  /** Slice 2 - Indexing + Measurement (default OFF; flip at v1->v2 cutover) */
  ff_seo_indexing: boolean;
  ff_seo_gsc: boolean;
  /** Slice 1 – Lead monetization: callback-guarantee model (24h call promise, owner lead unlock). */
  ff_callback_leads: boolean;
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
  /** Phase D.2 – Azure OpenAI Realtime concierge (default OFF until deployment configured) */
  ff_voice_agent_realtime: false,
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
  ff_alert_zones_enabled: false,
  /** Phase G – Rent Agreement v2 (default OFF; gated until PAN key + IP salt validated at boot) */
  ff_rent_agreement_enabled: false,
  ff_rent_agreement_admin_enabled: false,
  /** Phase H – PG Operator V1 (default OFF in prod; staging/dev set via env) */
  ff_pg_operator_v1: false,
  ff_pg_listing_wizard_enabled: false,
  ff_pg_voice_agent_enabled: false,
  ff_pg_voice_agent_realtime: false,
  ff_pg_dashboard_enabled: false,
  ff_pg_dashboard_listing_health: true,
  ff_pg_dashboard_leads_inbox: true,
  ff_pg_segmentation_v2: false,
  ff_pg_multi_property_enabled: false,
  /** Phase H+ – PG Operator V2..V8 (default OFF; unlocked per future version cycle) */
  ff_pg_bed_mgmt: false,
  ff_pg_tenant_portal: false,
  ff_pg_rent_collection: false,
  ff_pg_food: false,
  ff_pg_ops_full: false,
  ff_pg_agreement: false,
  ff_pg_comms: false,
  ff_pg_listing_score: false,
  ff_pg_ai_assist: false,
  ff_pg_fraud_ai: false,
  ff_pg_voice_listing: false,
  ff_pg_admin_analytics: false,
  ff_programmatic_seo_cities_enabled: true,
  ff_seo_blog: false,
  ff_seo_indexing: false,
  ff_seo_gsc: false,
  ff_callback_leads: false
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
    ff_voice_agent_realtime: parseBooleanEnv(
      "FF_VOICE_AGENT_REALTIME",
      defaultFeatureFlags.ff_voice_agent_realtime
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
    ),
    ff_rent_agreement_enabled: parseBooleanEnv(
      "FF_RENT_AGREEMENT_ENABLED",
      defaultFeatureFlags.ff_rent_agreement_enabled
    ),
    ff_rent_agreement_admin_enabled: parseBooleanEnv(
      "FF_RENT_AGREEMENT_ADMIN_ENABLED",
      defaultFeatureFlags.ff_rent_agreement_admin_enabled
    ),
    ff_pg_operator_v1: parseBooleanEnv("FF_PG_OPERATOR_V1", defaultFeatureFlags.ff_pg_operator_v1),
    ff_pg_listing_wizard_enabled: parseBooleanEnv(
      "FF_PG_LISTING_WIZARD_ENABLED",
      defaultFeatureFlags.ff_pg_listing_wizard_enabled
    ),
    ff_pg_voice_agent_enabled: parseBooleanEnv(
      "FF_PG_VOICE_AGENT_ENABLED",
      defaultFeatureFlags.ff_pg_voice_agent_enabled
    ),
    ff_pg_voice_agent_realtime: parseBooleanEnv(
      "FF_PG_VOICE_AGENT_REALTIME",
      defaultFeatureFlags.ff_pg_voice_agent_realtime
    ),
    ff_pg_dashboard_enabled: parseBooleanEnv(
      "FF_PG_DASHBOARD_ENABLED",
      defaultFeatureFlags.ff_pg_dashboard_enabled
    ),
    ff_pg_dashboard_listing_health: parseBooleanEnv(
      "FF_PG_DASHBOARD_LISTING_HEALTH",
      defaultFeatureFlags.ff_pg_dashboard_listing_health
    ),
    ff_pg_dashboard_leads_inbox: parseBooleanEnv(
      "FF_PG_DASHBOARD_LEADS_INBOX",
      defaultFeatureFlags.ff_pg_dashboard_leads_inbox
    ),
    ff_pg_segmentation_v2: parseBooleanEnv(
      "FF_PG_SEGMENTATION_V2",
      defaultFeatureFlags.ff_pg_segmentation_v2
    ),
    ff_pg_multi_property_enabled: parseBooleanEnv(
      "FF_PG_MULTI_PROPERTY_ENABLED",
      defaultFeatureFlags.ff_pg_multi_property_enabled
    ),
    ff_pg_bed_mgmt: parseBooleanEnv("FF_PG_BED_MGMT", defaultFeatureFlags.ff_pg_bed_mgmt),
    ff_pg_tenant_portal: parseBooleanEnv(
      "FF_PG_TENANT_PORTAL",
      defaultFeatureFlags.ff_pg_tenant_portal
    ),
    ff_pg_rent_collection: parseBooleanEnv(
      "FF_PG_RENT_COLLECTION",
      defaultFeatureFlags.ff_pg_rent_collection
    ),
    ff_pg_food: parseBooleanEnv("FF_PG_FOOD", defaultFeatureFlags.ff_pg_food),
    ff_pg_ops_full: parseBooleanEnv("FF_PG_OPS_FULL", defaultFeatureFlags.ff_pg_ops_full),
    ff_pg_agreement: parseBooleanEnv("FF_PG_AGREEMENT", defaultFeatureFlags.ff_pg_agreement),
    ff_pg_comms: parseBooleanEnv("FF_PG_COMMS", defaultFeatureFlags.ff_pg_comms),
    ff_pg_listing_score: parseBooleanEnv(
      "FF_PG_LISTING_SCORE",
      defaultFeatureFlags.ff_pg_listing_score
    ),
    ff_pg_ai_assist: parseBooleanEnv("FF_PG_AI_ASSIST", defaultFeatureFlags.ff_pg_ai_assist),
    ff_pg_fraud_ai: parseBooleanEnv("FF_PG_FRAUD_AI", defaultFeatureFlags.ff_pg_fraud_ai),
    ff_pg_voice_listing: parseBooleanEnv(
      "FF_PG_VOICE_LISTING",
      defaultFeatureFlags.ff_pg_voice_listing
    ),
    ff_pg_admin_analytics: parseBooleanEnv(
      "FF_PG_ADMIN_ANALYTICS",
      defaultFeatureFlags.ff_pg_admin_analytics
    ),
    ff_programmatic_seo_cities_enabled: parseBooleanEnv(
      "FF_PROGRAMMATIC_SEO_CITIES_ENABLED",
      defaultFeatureFlags.ff_programmatic_seo_cities_enabled
    ),
    ff_seo_blog: parseBooleanEnv("FF_SEO_BLOG", defaultFeatureFlags.ff_seo_blog),
    ff_seo_indexing: parseBooleanEnv("FF_SEO_INDEXING", defaultFeatureFlags.ff_seo_indexing),
    ff_seo_gsc: parseBooleanEnv("FF_SEO_GSC", defaultFeatureFlags.ff_seo_gsc),
    ff_callback_leads: parseBooleanEnv("FF_CALLBACK_LEADS", defaultFeatureFlags.ff_callback_leads)
  };
}
