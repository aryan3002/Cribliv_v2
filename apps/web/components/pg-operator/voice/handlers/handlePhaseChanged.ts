import type { VoiceAgentPgPhase } from "@cribliv/shared-types";

export interface PhaseChangedEvent {
  from: VoiceAgentPgPhase;
  to: VoiceAgentPgPhase;
  fields_captured_count: number;
}
export function handlePhaseChanged(ev: PhaseChangedEvent, deps: { setPhase: (p: string) => void }) {
  deps.setPhase(ev.to);
}
