export type SupportedCaptureLocale = "hi-IN" | "en-IN";

export type ListingType = "flat_house" | "pg";

export type Furnishing = "unfurnished" | "semi_furnished" | "fully_furnished";

export type ConfidenceTier = "high" | "medium" | "low";

export interface OwnerDraftPayloadSnakeCase {
  listing_type?: ListingType;
  title?: string;
  description?: string;
  rent?: number;
  deposit?: number;
  location?: {
    city?: string;
    locality?: string;
    address_line1?: string;
    masked_address?: string;
  };
  property_fields?: {
    bhk?: number;
    bathrooms?: number;
    area_sqft?: number;
    furnishing?: Furnishing;
  };
  pg_fields?: {
    total_beds?: number;
    room_sharing_options?: string[];
    food_included?: boolean;
    attached_bathroom?: boolean;
  };
}

export interface OwnerCaptureExtractResponse {
  transcript_echo: string;
  draft_suggestion: Partial<OwnerDraftPayloadSnakeCase>;
  field_confidence_tier: Record<string, ConfidenceTier>;
  confirm_fields: string[];
  missing_required_fields: string[];
  critical_warnings: string[];
}

export interface LlmExtractDraftResponse {
  draft_suggestion?: Partial<OwnerDraftPayloadSnakeCase>;
  field_confidence?: Record<string, number>;
  critical_warnings?: string[];
}
