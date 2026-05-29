// packages/shared-types/src/voice-agent-pg.ts
// Shared types for the PG-specialised voice agent.
// Spec: vault Features/PG Operator Role/04-Voice-Agent-PG.md

export type VoiceAgentPgPhase =
  | "greeting"
  | "discovery"
  | "pricing"
  | "food"
  | "rules"
  | "media"
  | "confirmation"
  | "done";

export type PgVoiceToolName =
  | "extract_property_basics"
  | "extract_room_config"
  | "extract_pricing_matrix"
  | "extract_payment_terms"
  | "extract_amenities"
  | "extract_food"
  | "extract_house_rules"
  | "commit_field"
  | "summarize_for_confirm"
  | "request_photo_upload";

export interface PgExtractedField {
  field: string;
  value: unknown;
  confidence: number; // 0..1
  tool: PgVoiceToolName;
  phase: VoiceAgentPgPhase;
  ts: string;
}

export interface PgVoiceSessionStartPayload {
  locale: "en" | "hi";
  pg_property_id?: string;
  resume_draft_id?: string;
}

export interface PgVoiceFieldExtractedEvent {
  field: string;
  value: unknown;
  confidence: number;
  draft_id: string;
}

export interface PgVoicePhaseChangedEvent {
  from: VoiceAgentPgPhase;
  to: VoiceAgentPgPhase;
  fields_captured_count: number;
}

export interface PgVoiceSessionEndedEvent {
  draft_id: string;
  listing_id: string | null;
  duration_ms: number;
  fields_total: number;
  fields_committed: number;
  abandoned: boolean;
}
