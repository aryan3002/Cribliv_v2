// Shared types for the voice search button and its Azure batch fallback.

export interface VoiceTranscription {
  text: string;
  locale: string;
  confidence: number;
  duration_ms: number;
}

export interface VoiceSearchResponse {
  transcription: VoiceTranscription;
  route_result: {
    intent: string;
    route: string;
    filters: Record<string, unknown>;
    clarifying_question?: {
      id: string;
      text: string;
      options: string[];
    };
    source: "ai" | "regex";
  };
}

// Pipeline stages surfaced to the parent so it can render the strip
// (●Listening ○Transcribing ○Parsing ○Searching) below the bar.
export type VoiceStage = "idle" | "listening" | "transcribing" | "parsing" | "searching" | "error";

export interface VoiceSearchButtonProps {
  locale: "en" | "hi";
  sessionToken?: string;
  onResult: (result: VoiceSearchResponse) => void;
  onTranscript?: (text: string) => void;
  onStageChange?: (stage: VoiceStage) => void;
  className?: string;
}
