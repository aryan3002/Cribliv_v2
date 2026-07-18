// Thin typed trackEvent wrappers for the Maya voice map dock (spec §14).
// Pure — no React, no network beyond what trackEvent itself does.
import { trackEvent } from "./analytics";

export const mapVoice = {
  holdStart: () => trackEvent("map_voice_hold_start", {}),
  transcript: (t: string, chips: string[], unsupported: string[]) =>
    trackEvent("map_voice_transcript", { transcript: t, chips, unsupported }),
  cameraFly: (locality: string, method: string) =>
    trackEvent("map_voice_camera_fly", { locality, method }),
  result: (count: number, isComplete: boolean) =>
    trackEvent("map_voice_result", { count, isComplete }),
  negotiationShown: (doorIds: string[]) => trackEvent("map_voice_negotiation_shown", { doorIds }),
  demandCapture: (spec: Record<string, unknown>) => trackEvent("map_voice_demand_capture", spec),
  fallbackText: () => trackEvent("map_voice_fallback_text", {})
};
