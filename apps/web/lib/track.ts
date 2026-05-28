"use client";

import posthog from "posthog-js";
import { getApiBaseUrl } from "./api";
import type { ListingEventType } from "@cribliv/shared-types";

// Events that are dual-written to the existing /analytics/event endpoint so
// owner analytics + ranking keep their Postgres source of truth.
const LISTING_EVENT_TYPES: ListingEventType[] = [
  "view",
  "enquiry",
  "shortlist",
  "share",
  "call_click"
];

type ProductEvent =
  | "lead_status_changed"
  | "kanban_card_dragged"
  | "lead_csv_exported"
  | "owner_dashboard_opened"
  | "contact_unlock_clicked"
  | "kanban_view_toggled";

export type TrackEvent = ListingEventType | ProductEvent | "search_impression";

interface TrackProps {
  listing_id?: string;
  user_id?: string;
  session_id?: string;
  [key: string]: unknown;
}

let cachedSessionId: string | null = null;
function getSessionId(): string {
  if (cachedSessionId) return cachedSessionId;
  if (typeof window === "undefined") return "ssr";
  try {
    const key = "cribliv:session_id";
    const existing = window.localStorage.getItem(key);
    if (existing) {
      cachedSessionId = existing;
      return existing;
    }
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    window.localStorage.setItem(key, fresh);
    cachedSessionId = fresh;
    return fresh;
  } catch {
    return `s_${Date.now()}`;
  }
}

function postListingEvent(eventType: ListingEventType, props: TrackProps) {
  if (typeof window === "undefined") return;
  if (!props.listing_id) return; // backend requires listing_id
  const body = {
    listing_id: props.listing_id,
    event_type: eventType,
    user_id: props.user_id ?? null,
    session_id: props.session_id ?? getSessionId(),
    metadata: Object.fromEntries(
      Object.entries(props).filter(([k]) => !["listing_id", "user_id", "session_id"].includes(k))
    )
  };
  // Fire and forget — analytics must never block UI.
  void fetch(`${getApiBaseUrl()}/analytics/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true
  }).catch(() => undefined);
}

export function track(event: TrackEvent, props: TrackProps = {}) {
  if (typeof window === "undefined") return;
  // PostHog (client-side telemetry).
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    try {
      posthog.capture(event, props);
    } catch {
      // posthog not yet ready — ignore
    }
  }
  // Dual-write listing engagement events to Postgres.
  if ((LISTING_EVENT_TYPES as readonly string[]).includes(event)) {
    postListingEvent(event as ListingEventType, props);
  }
}
