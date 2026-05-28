import type { AnalyticsEventName } from "@cribliv/shared-types";

export function trackEvent(event: AnalyticsEventName, properties: Record<string, unknown> = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const payload = {
    event,
    properties,
    ts: new Date().toISOString()
  };

  window.dispatchEvent(new CustomEvent("cribliv:analytics", { detail: payload }));
  if (process.env.NODE_ENV !== "production") {
    console.debug("analytics", payload);
  }
}
