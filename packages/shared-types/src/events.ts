export const analyticsEvents = [
  "home_viewed",
  "agentic_query_submitted",
  "agentic_clarification_shown",
  "agentic_route_resolved",
  "city_page_viewed",
  "search_results_viewed",
  "filter_applied",
  "listing_card_clicked",
  "listing_detail_viewed",
  "shortlist_added",
  "shortlist_removed",
  "contact_unlock_clicked",
  "otp_send_requested",
  "otp_verified",
  "credit_debited",
  "contact_unlocked",
  "owner_response_marked",
  "auto_refund_triggered",
  "owner_listing_draft_saved",
  "owner_listing_submitted",
  "owner_listing_capture_started",
  "owner_listing_recording_completed",
  "owner_listing_extraction_completed",
  "owner_listing_field_confirmed",
  "owner_listing_field_edited",
  "owner_listing_capture_completed",
  "owner_listing_capture_abandoned",
  "owner_listing_manual_fallback",
  "verification_video_submitted",
  "verification_bill_submitted",
  "admin_listing_decision",
  "admin_verification_decision",
  "pg_segmentation_triggered",
  "pg_sales_assist_requested",
  "property_management_requested",
  "admin_lead_status_updated",
  // Lead monetization — owner-side unlock/call flow
  "lead_unlocked",
  "call_clicked",
  // Lead monetization — tenant-side callback request flow
  "callback_requested",
  "callback_confirmed",
  "callback_disputed",
  // Lead monetization — one-time welcome credits celebration
  "welcome_credits_shown",
  // Lead monetization — SEO-safe guest gating (blurred cards + signup CTA)
  "guest_gate_signup_clicked",
  "guest_gate_viewed",
  // Lead monetization — Slice 3: shared Razorpay/UPI credit purchase dialog
  "lead_pack_purchased",
  // Phase C – Voice search events
  "voice_search_started",
  "voice_search_recording_complete",
  "voice_search_result",
  "voice_search_error",
  "voice_search_mic_denied",
  "voice_search_routed",
  // Phase D – Search autocomplete & Google Places
  "places_suggestion_selected",
  "suggest_selected",
  // Phase E – Conversational Hindi Voice Agent
  "voice_agent_session_started",
  "voice_agent_greeting_played",
  "voice_agent_user_spoke",
  "voice_agent_agent_responded",
  "voice_agent_phase_changed",
  "voice_agent_draft_updated",
  "voice_agent_session_completed",
  "voice_agent_session_abandoned",
  "voice_agent_error",
  "voice_agent_barge_in",
  "voice_agent_text_fallback",
  "voice_agent_manual_fallback",
  "voice_agent_inline_started",
  "voice_agent_inline_completed",
  // Phase E.2 – Realtime concierge (Azure OpenAI Realtime via WebRTC)
  "voice_realtime_started",
  "voice_realtime_stopped",
  "voice_realtime_tool_called",
  "voice_realtime_field_filled",
  "voice_realtime_step_jump",
  "voice_realtime_error"
] as const;

export type AnalyticsEventName = (typeof analyticsEvents)[number];

// PG tenant funnel events (search → detail → interest). Written from web via
// track() (PostHog) and, for search-scoped ones, POST /pg/analytics/search.
export const pgEvents = [
  "pg_search_executed",
  "pg_card_clicked",
  "pg_filter_applied",
  "pg_filter_cleared",
  "pg_sort_changed",
  "pg_zero_results",
  "pg_pagination_used",
  "pg_detail_viewed",
  "pg_photo_viewed",
  "pg_interest_clicked",
  "pg_interest_submitted",
  "pg_shared",
  "pg_similar_clicked",
  "pg_city_page_viewed",
  "pg_hub_clicked"
] as const;

export type PgEventName = (typeof pgEvents)[number];
