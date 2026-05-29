import type { VoiceAgentPgPhase } from "@cribliv/shared-types";

export const PG_PHASES: readonly VoiceAgentPgPhase[] = [
  "greeting",
  "discovery",
  "pricing",
  "food",
  "rules",
  "media",
  "confirmation",
  "done"
] as const;

/** Returns the next phase in linear order, or current if already at done. */
export function nextPhase(current: VoiceAgentPgPhase): VoiceAgentPgPhase {
  const i = PG_PHASES.indexOf(current);
  return i >= 0 && i < PG_PHASES.length - 1 ? PG_PHASES[i + 1] : current;
}
