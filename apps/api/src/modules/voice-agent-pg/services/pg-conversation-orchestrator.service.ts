import { Injectable } from "@nestjs/common";
import type { VoiceAgentPgPhase } from "@cribliv/shared-types";
import { nextPhase } from "../schema/pg-phase";

type DraftPayload = {
  property?: Record<string, unknown>;
  pg_details?: Record<string, unknown>;
  room_types?: unknown[];
};

/**
 * Required field paths per phase. Advance only when ALL listed paths are non-null
 * in the current draft. Special syntax: `"path[>=N]"` means array length >= N.
 * Phases without requirements advance on caller signal (orchestrator-driven).
 */
export const PHASE_REQUIREMENTS: Record<VoiceAgentPgPhase, string[]> = {
  greeting: [],
  discovery: ["property.display_name", "pg_details.total_beds"],
  pricing: ["room_types[>=1]"],
  food: ["pg_details.meals"],
  rules: ["pg_details.house_rules"],
  media: [],
  confirmation: [],
  done: []
};

@Injectable()
export class PgConversationOrchestrator {
  computeNextPhase(
    current: VoiceAgentPgPhase,
    draft: DraftPayload,
    opts: { force?: boolean } = {}
  ): VoiceAgentPgPhase {
    if (opts.force) return "done";
    if (current === "greeting") return "discovery";
    if (current === "media" || current === "confirmation") return nextPhase(current);
    const required = PHASE_REQUIREMENTS[current] ?? [];
    const allMet = required.every((p) => this.pathSatisfied(draft, p));
    return allMet ? nextPhase(current) : current;
  }

  private pathSatisfied(draft: DraftPayload, path: string): boolean {
    const m = path.match(/^(.+)\[>=(\d+)\]$/);
    if (m) {
      const arr = this.pathValue(draft, m[1]);
      return Array.isArray(arr) && arr.length >= Number(m[2]);
    }
    return this.pathValue(draft, path) != null;
  }

  private pathValue(draft: DraftPayload, path: string): unknown {
    return path
      .split(".")
      .reduce<unknown>(
        (acc, key) => (acc == null ? acc : (acc as Record<string, unknown>)[key]),
        draft as unknown
      );
  }
}
