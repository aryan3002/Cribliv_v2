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
export interface ConversationTurn {
  role: "agent" | "user";
  text: string;
  timestamp: string;
  extracted_fields?: Record<string, unknown>;
}
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
export interface VoiceAgentClientEvents {
  start_session: (payload: {
    locale?: "hi-IN" | "en-IN";
    listing_type_hint?: "flat_house" | "pg";
  }) => void;
  audio_chunk: (data: ArrayBuffer) => void;
  interrupt: () => void;
  end_session: () => void;
  text_input: (payload: { text: string }) => void;
}
export interface VoiceAgentServerEvents {
  session_started: (payload: { session_id: string; phase: VoiceAgentPhase }) => void;
  agent_audio: (data: ArrayBuffer) => void;
  agent_audio_end: () => void;
  agent_text: (payload: { text: string; phase: VoiceAgentPhase }) => void;
  user_transcript: (payload: { text: string; is_final: boolean }) => void;
  draft_update: (payload: {
    draft: VoiceAgentDraft;
    fields_collected: string[];
    fields_remaining: string[];
  }) => void;
  phase_change: (payload: { phase: VoiceAgentPhase; message: string }) => void;
  state_change: (payload: { state: VoiceAgentState }) => void;
  session_complete: (payload: {
    session_id: string;
    final_draft: VoiceAgentDraft;
    fields_collected: string[];
    fields_remaining: string[];
    turn_count: number;
    total_audio_seconds: number;
  }) => void;
  error: (payload: { code: string; message: string; recoverable: boolean }) => void;
}
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
