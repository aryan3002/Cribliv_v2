import { BadGatewayException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import {
  LlmExtractDraftResponse,
  ListingType,
  SupportedCaptureLocale
} from "./owner.capture.types";

interface ExtractorConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  timeoutMs: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readConfig(): ExtractorConfig {
  return {
    endpoint: trimTrailingSlash(process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment: process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ?? "",
    timeoutMs: parsePositiveInt(process.env.AZURE_AI_TIMEOUT_MS, 8000)
  };
}

const SYSTEM_PROMPT = `Extract owner listing draft data from Hindi/Hinglish/English transcript.
Return JSON ONLY in this shape:
{
  "draft_suggestion": {
    "listing_type": "flat_house|pg",
    "title": "string",
    "description": "string",
    "rent": 18000,
    "deposit": 36000,
    "location": {"city":"noida","locality":"sector-62","address_line1":"...","masked_address":"..."},
    "property_fields": {"bhk":2,"bathrooms":1,"area_sqft":850,"furnishing":"unfurnished|semi_furnished|fully_furnished"},
    "pg_fields": {"total_beds":20,"room_sharing_options":["single|double|triple|quad"],"food_included":true,"attached_bathroom":false}
  },
  "field_confidence": {
    "title": 0.9,
    "rent": 0.8,
    "location.city": 0.85
  },
  "critical_warnings": ["optional warning text"]
}
Rules:
- Use only values explicitly present in transcript; do not guess missing fields.
- rent/deposit must be numeric rupee values (18k => 18000, 2 lakh => 200000).
- listing_type must be flat_house or pg only.
- furnishing must use allowed enum only.
- field_confidence values must be between 0 and 1.
- keep critical_warnings empty array when none.`;

@Injectable()
export class AzureOpenAiExtractorClient {
  async extractDraft(input: {
    transcript: string;
    locale: SupportedCaptureLocale;
    listingTypeHint?: ListingType;
  }): Promise<LlmExtractDraftResponse> {
    const config = readConfig();
    if (!config.endpoint || !config.apiKey || !config.deployment) {
      throw new ServiceUnavailableException({
        code: "voice_extraction_unavailable",
        message: "Azure OpenAI extraction is not configured"
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    const hint = input.listingTypeHint ? `listing_type_hint=${input.listingTypeHint}` : "no_hint";
    const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;

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
            {
              role: "user",
              content: `locale=${input.locale}\n${hint}\ntranscript=${input.transcript}`
            }
          ],
          temperature: 0,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      if (!response.ok) {
        throw new BadGatewayException({
          code: "voice_extraction_failed",
          message: "Voice extraction provider failed"
        });
      }

      const content = payload.choices?.[0]?.message?.content;
      if (!content || typeof content !== "string") {
        throw new BadGatewayException({
          code: "voice_extraction_failed",
          message: "Voice extraction returned empty content"
        });
      }

      const parsed = JSON.parse(content) as LlmExtractDraftResponse;
      return {
        draft_suggestion: parsed.draft_suggestion ?? {},
        field_confidence: parsed.field_confidence ?? {},
        critical_warnings: parsed.critical_warnings ?? []
      };
    } catch (error) {
      if (error instanceof BadGatewayException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      if (error instanceof Error && error.name === "AbortError") {
        throw new BadGatewayException({
          code: "voice_extraction_timeout",
          message: "Voice extraction timed out"
        });
      }
      throw new BadGatewayException({
        code: "voice_extraction_failed",
        message: "Voice extraction failed"
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
