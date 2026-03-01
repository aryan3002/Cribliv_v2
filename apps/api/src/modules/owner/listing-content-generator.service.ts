import { Injectable, Logger, BadGatewayException } from "@nestjs/common";

/* ──────────────────────────────────────────────────────────────────────
 * ListingContentGeneratorService
 *
 * Generates a listing title and description from collected form fields
 * using Azure OpenAI. Follows the same raw-fetch pattern as the
 * existing AzureOpenAiExtractorClient.
 * ──────────────────────────────────────────────────────────────────── */

interface GeneratorConfig {
  endpoint: string;
  apiKey: string;
  deployment: string;
  timeoutMs: number;
}

function readConfig(): GeneratorConfig {
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment: process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ?? "",
    timeoutMs: Math.max(Number(process.env.AZURE_AI_TIMEOUT_MS) || 8000, 3000)
  };
}

const SYSTEM_PROMPT = `You are a real estate listing copywriter for the Indian market.
Given structured property details, generate:
1. A concise listing TITLE in English (50-80 chars) that highlights key selling points
   Format: "<BHK/Type> <Furnishing> <PropertyType> in <Locality/City> — ₹<Rent>/mo"
   Examples: "Spacious 2BHK Semi-Furnished Flat in Sector 62, Noida — ₹15,000/mo"
             "PG for Girls near Huda City Centre, Gurugram — ₹8,000/mo"
2. A descriptive DESCRIPTION in English (100-250 chars) summarizing the property attractively.
   Mention location, amenities, suitability, and key features naturally.

RULES:
- Write in natural English, optimized for search
- Include the rent in title
- Mention city AND locality if available
- For PG: mention gender preference, meals, sharing type
- Never fabricate amenities or details not provided
- Keep it factual and appealing

Respond with JSON ONLY:
{
  "title": "...",
  "description": "..."
}`;

export interface GenerateContentInput {
  listing_type: "flat_house" | "pg";
  monthly_rent?: number;
  deposit?: number;
  furnishing?: string;
  city?: string;
  locality?: string;
  bedrooms?: number;
  bathrooms?: number;
  area_sqft?: number;
  amenities?: string[];
  preferred_tenant?: string;
  beds?: number;
  sharing_type?: string;
  meals_included?: boolean;
  attached_bathroom?: boolean;
}

export interface GenerateContentResult {
  title: string;
  description: string;
}

@Injectable()
export class ListingContentGeneratorService {
  private readonly logger = new Logger(ListingContentGeneratorService.name);

  async generate(input: GenerateContentInput): Promise<GenerateContentResult> {
    const config = readConfig();

    if (!config.endpoint || !config.apiKey || !config.deployment) {
      this.logger.warn("Azure OpenAI not configured, using template fallback");
      return this.fallbackGenerate(input);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;
      const userMessage = this.buildUserMessage(input);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 300,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      });

      const payload = (await response.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      if (!response.ok || !payload.choices?.[0]?.message?.content) {
        this.logger.error(`Azure OpenAI returned ${response.status}`);
        return this.fallbackGenerate(input);
      }

      const parsed = JSON.parse(payload.choices[0].message.content) as GenerateContentResult;

      return {
        title: (parsed.title || "").slice(0, 120),
        description: (parsed.description || "").slice(0, 500)
      };
    } catch (err) {
      this.logger.error(`Content generation failed: ${err}`);
      return this.fallbackGenerate(input);
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildUserMessage(input: GenerateContentInput): string {
    const lines: string[] = [];
    lines.push(`Property type: ${input.listing_type === "pg" ? "PG / Hostel" : "Flat / House"}`);
    if (input.monthly_rent)
      lines.push(`Monthly rent: ₹${input.monthly_rent.toLocaleString("en-IN")}`);
    if (input.deposit) lines.push(`Security deposit: ₹${input.deposit.toLocaleString("en-IN")}`);
    if (input.furnishing) lines.push(`Furnishing: ${input.furnishing.replace(/_/g, " ")}`);
    if (input.city) lines.push(`City: ${input.city}`);
    if (input.locality) lines.push(`Locality: ${input.locality}`);
    if (input.bedrooms) lines.push(`Bedrooms: ${input.bedrooms} BHK`);
    if (input.bathrooms) lines.push(`Bathrooms: ${input.bathrooms}`);
    if (input.area_sqft) lines.push(`Area: ${input.area_sqft} sq ft`);
    if (input.preferred_tenant) lines.push(`Preferred tenant: ${input.preferred_tenant}`);
    if (input.beds) lines.push(`Total beds: ${input.beds}`);
    if (input.sharing_type) lines.push(`Sharing type: ${input.sharing_type}`);
    if (input.meals_included) lines.push(`Meals included: Yes`);
    if (input.attached_bathroom) lines.push(`Attached bathroom: Yes`);
    if (input.amenities?.length) lines.push(`Amenities: ${input.amenities.join(", ")}`);
    return lines.join("\n");
  }

  /** Template-based fallback when Azure OpenAI is unavailable */
  private fallbackGenerate(input: GenerateContentInput): GenerateContentResult {
    const isPg = input.listing_type === "pg";
    const location = [input.locality, input.city].filter(Boolean).join(", ") || "Prime Location";
    const rentStr = input.monthly_rent ? `₹${input.monthly_rent.toLocaleString("en-IN")}/mo` : "";

    let title: string;
    if (isPg) {
      const pref = input.preferred_tenant
        ? ` for ${input.preferred_tenant === "female" ? "Girls" : input.preferred_tenant === "male" ? "Boys" : "All"}`
        : "";
      title = `PG${pref} in ${location}${rentStr ? ` — ${rentStr}` : ""}`;
    } else {
      const bhk = input.bedrooms ? `${input.bedrooms}BHK ` : "";
      const furn = input.furnishing
        ? `${input.furnishing.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())} `
        : "";
      title = `${bhk}${furn}Flat in ${location}${rentStr ? ` — ${rentStr}` : ""}`;
    }

    const features: string[] = [];
    if (input.area_sqft) features.push(`${input.area_sqft} sq ft`);
    if (input.furnishing) features.push(input.furnishing.replace(/_/g, " "));
    if (input.amenities?.length) features.push(input.amenities.slice(0, 4).join(", "));
    const description = features.length
      ? `Well-maintained property in ${location}. Features: ${features.join(", ")}. Contact for viewing.`
      : `Property available in ${location}. Contact owner for details and viewing.`;

    return { title: title.slice(0, 120), description: description.slice(0, 500) };
  }
}
