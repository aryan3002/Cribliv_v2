/**
 * Shared types for the AI module.
 */

export type SearchIntent =
  | "search_listing"
  | "city_browse"
  | "open_listing"
  | "post_listing"
  | "unknown";

export interface ParsedFilters {
  city?: string;
  locality?: string;
  listing_type?: "flat_house" | "pg";
  min_rent?: number;
  max_rent?: number;
  bhk?: number;
  furnishing?: "unfurnished" | "semi_furnished" | "fully_furnished";
  verified_only?: boolean;
  listing_id?: string;
}

export interface IntentClassification {
  intent: SearchIntent;
  filters: ParsedFilters;
  confidence: number;
  /** Optional clarifying question when filters are ambiguous/incomplete */
  clarifying_question?: {
    id: string;
    text: string;
    options: string[];
  };
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  filters?: ParsedFilters;
  timestamp: number;
}

export interface ConversationContext {
  session_id: string;
  turns: ConversationTurn[];
  accumulated_filters: ParsedFilters;
  last_intent: SearchIntent;
}

export interface EmbeddingResult {
  listing_id: string;
  embedding: number[];
  token_count: number;
  model: string;
}

export interface ScoredListing {
  listing_id: string;
  composite_score: number;
  verification_score: number;
  freshness_score: number;
  photo_score: number;
  response_rate_score: number;
  completeness_score: number;
  engagement_score: number;
}
