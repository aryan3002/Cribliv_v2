import { fetchApi } from "./api";

export interface PgFunnelEvent {
  event_type:
    | "wizard_started"
    | "step_completed"
    | "geocode_resolved"
    | "photos_added"
    | "draft_saved"
    | "submitted"
    | "published"
    | "abandoned";
  source: "manual" | "voice";
  step_no?: number;
  draft_id?: string;
  listing_id?: string;
  metadata?: Record<string, unknown>;
}

// The funnel endpoint is Bearer-auth-guarded. trackPgFunnel is called from deep
// step components that don't hold the token, so the wizard/voice-flow registers
// it once here and every event authenticates. Without this the events 401 and
// silently drop (the endpoint attaches operator_user_id from this token).
let funnelToken: string | null = null;
export function setPgFunnelToken(token: string | null): void {
  funnelToken = token;
}

/**
 * Best-effort funnel event POST. `keepalive` lets unload-time events (abandon)
 * flush WITH auth — one authenticated ingest path, no orphan Next route.
 * Never throws to the caller.
 */
export async function trackPgFunnel(event: PgFunnelEvent): Promise<void> {
  try {
    await fetchApi("/pg-operator/funnel", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(funnelToken ? { Authorization: `Bearer ${funnelToken}` } : {})
      },
      body: JSON.stringify(event),
      keepalive: true
    });
  } catch (e) {
    // BUG-M6: fire-and-forget — offline / 404 / 401 tolerated, but no longer a
    // fully silent drop; surface it so lost funnel telemetry is at least visible.
    if (typeof console !== "undefined")
      console.warn(`[pg-funnel] ${event.event_type} event dropped:`, e);
  }
}
