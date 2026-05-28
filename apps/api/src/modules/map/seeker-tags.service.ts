import { Injectable, Logger } from "@nestjs/common";

/**
 * Fixed taxonomy — we never accept tags outside this set. Keeps the demand-
 * signal usable for downstream matching (we know every possible tag value).
 * Add new tags here and bump it through the prompt below.
 */
export const ALLOWED_TAGS = [
  "pet-friendly",
  "parking",
  "gym",
  "wifi-included",
  "near-metro",
  "near-it-park",
  "near-college",
  "quiet-area",
  "family",
  "bachelor",
  "female-only",
  "vegetarian",
  "furnished-preferred",
  "urgent"
] as const;
export type SeekerTag = (typeof ALLOWED_TAGS)[number];

const ALLOWED_SET = new Set<string>(ALLOWED_TAGS);
const MAX_TAGS_PER_NOTE = 6;
const MIN_NOTE_LENGTH = 10;

function readAiConfig() {
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    // Reuse the existing extract deployment if set, fall back to the chat one.
    deployment:
      process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_CHAT_DEPLOYMENT?.trim() ||
      "",
    timeoutMs: Math.max(Number(process.env.AZURE_AI_TIMEOUT_MS) || 3000, 2000)
  };
}

/**
 * Extracts structured tags from a free-form seeker note using Azure OpenAI.
 * Designed never to block pin creation — on any failure (no API key, parse
 * error, timeout, model garbage) returns `[]`. Tags are optional metadata,
 * not a requirement.
 */
@Injectable()
export class SeekerTagsService {
  private readonly logger = new Logger(SeekerTagsService.name);

  async extractTags(note: string | null | undefined): Promise<string[]> {
    const trimmed = note?.trim() ?? "";
    if (trimmed.length < MIN_NOTE_LENGTH) return [];

    const config = readAiConfig();
    if (!config.endpoint || !config.apiKey || !config.deployment) {
      this.logger.debug("Azure OpenAI not configured — skipping tag extraction");
      return [];
    }

    const prompt = `You will read a short note from a person searching for a rental in India. Extract structured tags that describe what they're looking for. Only emit tags from this exact list (lowercase, hyphenated):

${ALLOWED_TAGS.join(", ")}

Rules:
- Output strict JSON with the shape: {"tags": ["tag1", "tag2"]}
- Pick at most 6 tags. Pick fewer if fewer apply. Empty array is fine.
- Only include a tag if the note clearly implies it. Don't guess.
- Never invent tags outside the list above.

Note: """${trimmed.slice(0, 400)}"""`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/chat/completions?api-version=2024-10-21`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": config.apiKey },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You extract structured rental-search tags. Reply with valid JSON only — no prose, no markdown."
            },
            { role: "user", content: prompt }
          ],
          temperature: 0,
          max_tokens: 120,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        this.logger.warn(`Tag extraction returned HTTP ${response.status}`);
        return [];
      }

      const payload = (await response.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) return [];

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        return [];
      }

      const raw = (parsed as { tags?: unknown })?.tags;
      if (!Array.isArray(raw)) return [];

      // Filter to ALLOWED_TAGS, dedupe, cap.
      const out: string[] = [];
      const seen = new Set<string>();
      for (const t of raw) {
        if (typeof t !== "string") continue;
        const key = t.toLowerCase().trim();
        if (!ALLOWED_SET.has(key) || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
        if (out.length >= MAX_TAGS_PER_NOTE) break;
      }
      return out;
    } catch (err) {
      // AbortError on timeout, network failures, JSON errors — all benign.
      this.logger.debug(
        `Tag extraction failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Defence-in-depth: filter incoming client-supplied tags to the allowed
   *  set. Lets the frontend pre-populate tags safely if we add that flow. */
  sanitize(tags: string[] | null | undefined): string[] {
    if (!Array.isArray(tags)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of tags) {
      if (typeof t !== "string") continue;
      const key = t.toLowerCase().trim();
      if (!ALLOWED_SET.has(key) || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
      if (out.length >= MAX_TAGS_PER_NOTE) break;
    }
    return out;
  }
}
