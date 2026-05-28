"use client";

import { useFeatureFlagEnabled } from "posthog-js/react";

// Map of frontend flag name → NEXT_PUBLIC env var.
// Flags listed here resolve to TRUE if EITHER env is "true" OR PostHog
// reports the flag enabled for the current user. This lets us ship gradual
// rollouts via PostHog without a redeploy, while keeping env defaults intact.
const ENV_FLAG_MAP: Record<string, string | undefined> = {
  ff_voice_agent_enabled: process.env.NEXT_PUBLIC_FF_VOICE_AGENT_ENABLED,
  ff_voice_realtime: process.env.NEXT_PUBLIC_FF_VOICE_REALTIME,
  ff_lead_management_enabled: process.env.NEXT_PUBLIC_FF_LEAD_MANAGEMENT_ENABLED,
  ff_listing_analytics_enabled: process.env.NEXT_PUBLIC_FF_LISTING_ANALYTICS_ENABLED
};

function readEnv(flag: string): boolean {
  const raw = ENV_FLAG_MAP[flag];
  return raw === "true" || raw === "1";
}

export function useFlag(flag: string): boolean {
  const remote = useFeatureFlagEnabled(flag);
  const env = readEnv(flag);
  return env || remote === true;
}
