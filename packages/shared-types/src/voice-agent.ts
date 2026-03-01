/**
 * Voice Agent – shared type definitions for the real-time conversational
 * Hindi voice agent used during owner property listing capture.
 *
 * These types are consumed by both `apps/api` (NestJS WebSocket gateway)
 * and `apps/web` (Socket.IO client).
 */

// ─── Enums / Literals ────────────────────────────────────────────────────────

export type VoiceAgentPhase =
  | "greeting"
  | "property_type"
  | "location"
  | "basics"
  | "details"
  | "amenities"
  | "confirmation"
  | "complete";

export type VoiceAgentSessionStatus = "active" | "completed" | "abandoned" | "error";

export type VoiceAgentState =
  | "connecting"
  | "greeting"
  | "listening"
  | "thinking"
  | "speaking"
  | "complete"
  | "error";

// ─── Conversation Turn ───────────────────────────────────────────────────────

export interface ConversationTurn {
  role: "agent" | "user";
  text: string;
  timestamp: string; // ISO 8601
  extracted_fields?: Record<string, unknown>;
}

// ─── Partial Draft (mirrors OwnerDraftPayloadSnakeCase shape) ────────────────

export interface VoiceAgentDraft {
  listing_type?: "flat_house" | "pg";
  title?: string;
  description?: string;
  rent?: number;
  deposit?: number;
  location?: {
    city?: string;
    locality?: string;
    address_line1?: string;
  };
  property_fields?: {
    bhk?: number;
    bathrooms?: number;
    area_sqft?: number;
    furnishing?: "unfurnished" | "semi_furnished" | "fully_furnished";
  };
  pg_fields?: {
    total_beds?: number;
    room_sharing_options?: string[];
    food_included?: boolean;
    attached_bathroom?: boolean;
  };
  amenities?: string[];
  preferred_tenant?: string;
}

// ─── Socket.IO Client → Server Events ────────────────────────────────────────

export interface VoiceAgentClientEvents {
  /** Start a new voice agent session */
  start_session: (payload: {
    locale?: "hi-IN" | "en-IN";
    listing_type_hint?: "flat_house" | "pg";
  }) => void;

  /** Stream raw audio chunk from browser mic (PCM/WebM bytes) */
  audio_chunk: (data: ArrayBuffer) => void;

  /** User started speaking while agent was talking – interrupt TTS */
  interrupt: () => void;

  /** User manually ends the conversation */
  end_session: () => void;

  /** Fallback: user types text instead of speaking */
  text_input: (payload: { text: string }) => void;
}

// ─── Socket.IO Server → Client Events ────────────────────────────────────────

export interface VoiceAgentServerEvents {
  /** Session initialized, agent ready */
  session_started: (payload: { session_id: string; phase: VoiceAgentPhase }) => void;

  /** Agent speaking – streamed audio chunk */
  agent_audio: (data: ArrayBuffer) => void;

  /** Signals end of an agent audio response (all chunks sent) */
  agent_audio_end: () => void;

  /** Agent's text transcript (arrives alongside or instead of audio) */
  agent_text: (payload: { text: string; phase: VoiceAgentPhase }) => void;

  /** User's transcribed speech */
  user_transcript: (payload: { text: string; is_final: boolean }) => void;

  /** Updated draft fields extracted from conversation */
  draft_update: (payload: {
    draft: VoiceAgentDraft;
    fields_collected: string[];
    fields_remaining: string[];
  }) => void;

  /** Conversation phase changed */
  phase_change: (payload: { phase: VoiceAgentPhase; message: string }) => void;

  /** Voice agent is now in a specific state */
  state_change: (payload: { state: VoiceAgentState }) => void;

  /** Conversation completed – final draft ready */
  session_complete: (payload: {
    session_id: string;
    final_draft: VoiceAgentDraft;
    fields_collected: string[];
    fields_remaining: string[];
    turn_count: number;
    total_audio_seconds: number;
  }) => void;

  /** Error occurred */
  error: (payload: { code: string; message: string; recoverable: boolean }) => void;
}

// ─── REST fallback types ─────────────────────────────────────────────────────

export interface VoiceAgentSessionResponse {
  id: string;
  status: VoiceAgentSessionStatus;
  current_phase: VoiceAgentPhase;
  partial_draft: VoiceAgentDraft;
  fields_collected: string[];
  fields_remaining: string[];
  turn_count: number;
  total_audio_seconds: number;
  created_at: string;
  updated_at: string;
}
