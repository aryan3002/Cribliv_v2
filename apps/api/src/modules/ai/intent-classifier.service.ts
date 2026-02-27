import { Injectable, Logger } from "@nestjs/common";
import { readFeatureFlags } from "../../config/feature-flags";
import type { IntentClassification, ParsedFilters, SearchIntent } from "./ai.types";

// ─── Azure OpenAI configuration ───────────────────────────────────────────────

interface AiClientConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  timeoutMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readAiConfig(): AiClientConfig {
  return {
    endpoint: trimTrailingSlash(process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment:
      process.env.AZURE_OPENAI_CHAT_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ||
      "",
    timeoutMs: parsePositiveInt(process.env.AZURE_AI_TIMEOUT_MS, 8000)
  };
}

// ─── Function-calling schema for intent extraction ────────────────────────────

const INTENT_FUNCTION = {
  name: "classify_search_intent",
  description:
    "Classify a natural-language rental search query (Hindi/Hinglish/English) into a structured intent with filters.",
  parameters: {
    type: "object" as const,
    properties: {
      intent: {
        type: "string",
        enum: ["search_listing", "city_browse", "open_listing", "post_listing", "unknown"],
        description: "The classified user intent"
      },
      confidence: {
        type: "number",
        description: "Confidence score 0-1"
      },
      filters: {
        type: "object",
        properties: {
          city: {
            type: "string",
            description: "Canonical city slug (delhi, gurugram, noida, etc.)"
          },
          locality: { type: "string", description: "Locality within city" },
          listing_type: { type: "string", enum: ["flat_house", "pg"] },
          min_rent: { type: "number", description: "Minimum monthly rent in INR" },
          max_rent: { type: "number", description: "Maximum monthly rent in INR" },
          bhk: { type: "number", description: "Number of bedrooms (1-5)" },
          furnishing: {
            type: "string",
            enum: ["unfurnished", "semi_furnished", "fully_furnished"]
          },
          verified_only: { type: "boolean" },
          listing_id: { type: "string", description: "UUID of a specific listing" }
        }
      },
      missing_required: {
        type: "array",
        items: { type: "string" },
        description: "List of important missing filters like 'city' or 'listing_type'"
      }
    },
    required: ["intent", "confidence", "filters"]
  }
};

const SYSTEM_PROMPT = `You are a search intent classifier for a rental property platform in India.
Supported cities: delhi, gurugram, noida, ghaziabad, faridabad, chandigarh, jaipur, lucknow.
Listing types: flat_house (flats, apartments, houses, 1bhk-4bhk) or pg (PG, hostel).
Users search in English, Hindi, or Hinglish.

Rules:
- Map city aliases: "gurgaon" → "gurugram", "new delhi" → "delhi", Hindi names to English slugs.
- Rent values: "18k" → 18000, "2 lakh" → 200000.
- If query contains a UUID, intent is "open_listing".
- If query mentions posting/listing a property, intent is "post_listing".
- If only a city is mentioned with no other criteria, intent is "city_browse".
- Otherwise intent is "search_listing".
- Report missing_required when city or listing_type cannot be determined.
- Be conservative with confidence; use < 0.5 when very ambiguous.`;

// ─── City aliases (must stay in sync with search.service.ts) ──────────────────

const CITY_MAP: Record<string, string> = {
  delhi: "delhi",
  "new delhi": "delhi",
  दिल्ली: "delhi",
  gurugram: "gurugram",
  gurgaon: "gurugram",
  गुड़गांव: "gurugram",
  गुरुग्राम: "gurugram",
  noida: "noida",
  नोएडा: "noida",
  ghaziabad: "ghaziabad",
  गाज़ियाबाद: "ghaziabad",
  faridabad: "faridabad",
  फरीदाबाद: "faridabad",
  chandigarh: "chandigarh",
  चंडीगढ़: "chandigarh",
  jaipur: "jaipur",
  जयपुर: "jaipur",
  lucknow: "lucknow",
  लखनऊ: "lucknow"
};

const VALID_CITIES = new Set(Object.values(CITY_MAP));
const CITY_ORDER = ["delhi", "gurugram", "noida", "ghaziabad"];

@Injectable()
export class IntentClassifierService {
  private readonly logger = new Logger(IntentClassifierService.name);

  /**
   * Classify a natural-language search query using Azure OpenAI function calling.
   * Falls back to null when the flag is off or Azure is unavailable.
   */
  async classify(
    query: string,
    locale: "en" | "hi",
    cityHint?: string
  ): Promise<IntentClassification | null> {
    const flags = readFeatureFlags();
    if (!flags.ff_ai_intent_classifier) return null;

    const config = readAiConfig();
    if (!config.endpoint || !config.apiKey || !config.deployment) {
      this.logger.warn("AI intent classifier not configured — skipping");
      return null;
    }

    try {
      return await this.callAzureOpenAi(config, query, locale, cityHint);
    } catch (error) {
      this.logger.error("AI intent classifier failed — returning null for regex fallback", error);
      return null;
    }
  }

  private async callAzureOpenAi(
    config: AiClientConfig,
    query: string,
    locale: "en" | "hi",
    cityHint?: string
  ): Promise<IntentClassification> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;

    const userContent = [
      `locale=${locale}`,
      cityHint ? `city_hint=${cityHint}` : "",
      `query=${query}`
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent }
          ],
          functions: [INTENT_FUNCTION],
          function_call: { name: "classify_search_intent" },
          temperature: 0,
          max_tokens: 400
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        this.logger.warn(`Azure OpenAI returned ${response.status}`);
        return this.buildFallback(query, locale, cityHint);
      }

      const payload = (await response.json()) as {
        choices?: Array<{
          message?: {
            function_call?: { arguments?: string };
          };
        }>;
      };

      const args = payload.choices?.[0]?.message?.function_call?.arguments;
      if (!args) {
        return this.buildFallback(query, locale, cityHint);
      }

      const parsed = JSON.parse(args) as {
        intent: SearchIntent;
        confidence: number;
        filters: ParsedFilters;
        missing_required?: string[];
      };

      // Normalize city through our canonical map
      if (parsed.filters.city) {
        const normalized = CITY_MAP[parsed.filters.city.toLowerCase()];
        if (normalized) {
          parsed.filters.city = normalized;
        } else if (!VALID_CITIES.has(parsed.filters.city.toLowerCase())) {
          delete parsed.filters.city;
        }
      }

      // Apply city hint when missing
      if (!parsed.filters.city && cityHint) {
        parsed.filters.city = cityHint.toLowerCase();
      }

      // Build clarifying question if needed
      const clarifying_question = this.buildClarification(parsed, locale);

      return {
        intent: parsed.intent,
        filters: parsed.filters,
        confidence: parsed.confidence,
        clarifying_question
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildClarification(
    parsed: { intent: SearchIntent; filters: ParsedFilters; missing_required?: string[] },
    locale: "en" | "hi"
  ): IntentClassification["clarifying_question"] {
    const missing = parsed.missing_required ?? [];

    if (missing.includes("city") || (!parsed.filters.city && parsed.intent === "search_listing")) {
      return {
        id: "missing_city",
        text: locale === "hi" ? "कौन सा शहर चाहिए?" : "Which city should we search in?",
        options: CITY_ORDER
      };
    }

    if (
      missing.includes("listing_type") ||
      (!parsed.filters.listing_type && parsed.intent === "search_listing")
    ) {
      return {
        id: "missing_type",
        text: locale === "hi" ? "फ्लैट/हाउस चाहिए या PG?" : "Do you want Flat/House or PG?",
        options: ["flat_house", "pg"]
      };
    }

    return undefined;
  }

  /**
   * Basic fallback when Azure call fails (should rarely be used since
   * the caller will fall through to the existing regex pipeline).
   */
  private buildFallback(
    query: string,
    locale: "en" | "hi",
    cityHint?: string
  ): IntentClassification {
    return {
      intent: "unknown",
      filters: cityHint ? { city: cityHint.toLowerCase() } : {},
      confidence: 0
    };
  }
}
