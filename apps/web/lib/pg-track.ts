"use client";

import { track, getSessionId } from "./track";
import { getApiBaseUrl } from "./api";

interface SearchEventPayload {
  city?: string;
  query?: string;
  filters?: Record<string, string>;
  result_count?: number;
  shown_listing_ids?: string[];
  clicked_listing_id?: string;
  clicked_position?: number;
  surface?: string;
}

function postSearchEvent(payload: SearchEventPayload) {
  if (typeof window === "undefined") return;
  void fetch(`${getApiBaseUrl()}/pg/analytics/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, session_id: getSessionId() }),
    keepalive: true
  }).catch(() => undefined);
}

// --- Listing-scoped (PostHog + listing_events via track()) ---
export function trackPgDetailView(p: { listing_id: string; city?: string; from_surface?: string }) {
  track("pg_detail_viewed", p);
  track("view", { listing_id: p.listing_id }); // → listing_events, powers views_7d
}

export function trackPgShare(p: { listing_id: string; method: "native" | "clipboard" }) {
  track("pg_shared", p);
  track("share", { listing_id: p.listing_id });
}

export function trackPgPhotoViewed(listing_id: string, photo_index: number) {
  track("pg_photo_viewed", { listing_id, photo_index });
}

export function trackPgInterestClicked(listing_id: string, auth_state: "logged_in" | "logged_out") {
  track("pg_interest_clicked", { listing_id, auth_state });
}

export function trackPgInterestSubmitted(listing_id: string) {
  track("pg_interest_submitted", { listing_id });
}

export function trackPgSimilarClicked(p: {
  from_listing_id: string;
  to_listing_id: string;
  position: number;
}) {
  track("pg_similar_clicked", p);
}

// --- Search-scoped (PostHog + fire-and-forget POST) ---
export function trackPgSearch(p: {
  city?: string;
  query?: string;
  filters: Record<string, string>;
  result_count: number;
  shown_listing_ids: string[];
}) {
  track("pg_search_executed", p);
  if (p.result_count === 0)
    track("pg_zero_results", { city: p.city, query: p.query, filters: p.filters });
  postSearchEvent(p);
}

export function trackPgCardClick(p: {
  listing_id: string;
  position: number;
  surface: string;
  city?: string;
  filters: Record<string, string>;
}) {
  track("pg_card_clicked", {
    listing_id: p.listing_id,
    position: p.position,
    surface: p.surface,
    filters_active: Object.keys(p.filters).length > 0
  });
  postSearchEvent({
    city: p.city,
    filters: p.filters,
    surface: p.surface,
    clicked_listing_id: p.listing_id,
    clicked_position: p.position
  });
}
