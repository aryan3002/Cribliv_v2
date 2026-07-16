import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import { DatabaseService } from "../../common/database.service";

/**
 * AI-generated copy for programmatic SEO landing pages. Designed to:
 *   - Never block page render — failures and timeouts return null and the
 *     page falls back to template defaults.
 *   - Cache aggressively in `seo_page_copy` keyed by (path, locale).
 *   - Respect manual overrides in `seo_page_overrides` (always preferred).
 *   - Auto-regenerate when listing aggregates drift (hash mismatch) or after
 *     the row's expires_at.
 *
 * Mirrors the structure of map/seeker-tags.service.ts (Azure OpenAI usage,
 * env config, error semantics).
 */

const MAX_INTRO_WORDS = 140;
const MAX_FAQ_ITEMS = 6;

export interface CopyInputs {
  pagePath: string;
  locale: "en" | "hi";
  placeName: { en: string; hi: string };
  placeKind: "city" | "locality" | "metro" | "landmark";
  intentLabel?: { en: string; hi: string } | null;
  /** Live numbers; used for grounding and aggregates_hash. */
  aggregates: {
    listing_count: number;
    pg_count?: number;
    flat_count?: number;
    median_rent_pg?: number | null;
    median_rent_1bhk?: number | null;
    median_rent_2bhk?: number | null;
    nearest_metro?: { name: string; walk_minutes: number } | null;
    parent_locality?: string | null;
  };
}

export interface GeneratedCopy {
  h1: string;
  meta_title: string;
  meta_description: string;
  intro_paragraph: string;
  nearby_blurb?: string | null;
  faq_items: Array<{ q: string; a: string }>;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeGeneratedCopy(copy: GeneratedCopy): GeneratedCopy {
  return {
    h1: escapeHtml(copy.h1),
    meta_title: escapeHtml(copy.meta_title),
    meta_description: escapeHtml(copy.meta_description),
    intro_paragraph: escapeHtml(copy.intro_paragraph),
    nearby_blurb: copy.nearby_blurb ? escapeHtml(copy.nearby_blurb) : null,
    faq_items: copy.faq_items.map((item) => ({ q: escapeHtml(item.q), a: escapeHtml(item.a) }))
  };
}

function readAiConfig() {
  return {
    endpoint: (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment:
      process.env.AZURE_OPENAI_CHAT_DEPLOYMENT?.trim() ||
      process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT?.trim() ||
      "",
    timeoutMs: Math.max(Number(process.env.SEO_COPY_TIMEOUT_MS) || 8000, 4000)
  };
}

@Injectable()
export class SeoCopyService {
  private readonly logger = new Logger(SeoCopyService.name);

  constructor(private readonly database: DatabaseService) {}

  hashAggregates(inputs: CopyInputs["aggregates"]): string {
    const norm = JSON.stringify(inputs, Object.keys(inputs).sort());
    return createHash("sha1").update(norm).digest("hex").slice(0, 16);
  }

  /**
   * Look up cached copy or generate it. Returns null only if the database is
   * disabled AND the AI call fails — callers must handle null by falling
   * back to template defaults.
   */
  async getOrGenerate(inputs: CopyInputs): Promise<GeneratedCopy | null> {
    // 1. Manual override always wins
    const override = await this.readOverride(inputs.pagePath, inputs.locale);
    if (override) return override;

    // 2. Fresh cache hit
    const cached = await this.readCache(inputs.pagePath, inputs.locale);
    const aggHash = this.hashAggregates(inputs.aggregates);
    if (cached && cached.aggregates_hash === aggHash && new Date(cached.expires_at) > new Date()) {
      return cachedToCopy(cached);
    }

    // 3. Generate via Azure OpenAI
    const fresh = await this.generate(inputs);
    if (fresh) {
      await this.writeCache(inputs, fresh, aggHash).catch((err) =>
        this.logger.warn(`SEO copy cache write failed: ${err instanceof Error ? err.message : err}`)
      );
      return fresh;
    }

    // 4. Stale cache is better than nothing
    if (cached) return cachedToCopy(cached);
    return null;
  }

  /**
   * Read-only: return stored copy (manual override, else cached) without ever
   * generating. This is what the PUBLIC render path uses — no LLM, no auth —
   * so anonymous SSR can serve AI copy the batch generator pre-populated.
   */
  async getStored(pagePath: string, locale: string): Promise<GeneratedCopy | null> {
    const override = await this.readOverride(pagePath, locale);
    if (override) return override;
    const cached = await this.readCache(pagePath, locale);
    return cached ? cachedToCopy(cached) : null;
  }

  /**
   * True when the page already has non-expired stored copy (or a manual
   * override). The batch generator uses this to skip pages that don't need
   * regeneration, so it only spends LLM calls on missing/expired copy.
   */
  async hasFreshCopy(pagePath: string, locale: string): Promise<boolean> {
    const override = await this.readOverride(pagePath, locale);
    if (override) return true;
    const cached = await this.readCache(pagePath, locale);
    return !!cached && new Date(cached.expires_at) > new Date();
  }

  private async readOverride(pagePath: string, locale: string): Promise<GeneratedCopy | null> {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<{
      h1: string | null;
      meta_title: string | null;
      meta_description: string | null;
      intro_paragraph: string | null;
      nearby_blurb: string | null;
      faq_items: Array<{ q: string; a: string }> | null;
    }>(
      `SELECT h1, meta_title, meta_description, intro_paragraph, nearby_blurb, faq_items
       FROM seo_page_overrides
       WHERE page_path = $1 AND locale = $2`,
      [pagePath, locale]
    );
    const row = rows[0];
    if (!row) return null;
    // Override may be partial — caller still has template defaults to fill gaps.
    if (!row.h1 && !row.intro_paragraph) return null;
    return {
      h1: row.h1 ?? "",
      meta_title: row.meta_title ?? "",
      meta_description: row.meta_description ?? "",
      intro_paragraph: row.intro_paragraph ?? "",
      nearby_blurb: row.nearby_blurb,
      faq_items: row.faq_items ?? []
    };
  }

  private async readCache(pagePath: string, locale: string) {
    if (!this.database.isEnabled()) return null;
    const { rows } = await this.database.query<{
      h1: string;
      meta_title: string;
      meta_description: string;
      intro_paragraph: string;
      nearby_blurb: string | null;
      faq_items: Array<{ q: string; a: string }>;
      aggregates_hash: string;
      expires_at: string;
    }>(
      `SELECT h1, meta_title, meta_description, intro_paragraph, nearby_blurb,
              faq_items, aggregates_hash, expires_at
       FROM seo_page_copy
       WHERE page_path = $1 AND locale = $2`,
      [pagePath, locale]
    );
    return rows[0] ?? null;
  }

  private async writeCache(inputs: CopyInputs, copy: GeneratedCopy, aggHash: string) {
    if (!this.database.isEnabled()) return;
    await this.database.query(
      `INSERT INTO seo_page_copy
         (page_path, locale, h1, meta_title, meta_description, intro_paragraph,
          nearby_blurb, faq_items, aggregates_hash, generated_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, now(), now() + interval '30 days')
       ON CONFLICT (page_path, locale) DO UPDATE SET
         h1 = EXCLUDED.h1,
         meta_title = EXCLUDED.meta_title,
         meta_description = EXCLUDED.meta_description,
         intro_paragraph = EXCLUDED.intro_paragraph,
         nearby_blurb = EXCLUDED.nearby_blurb,
         faq_items = EXCLUDED.faq_items,
         aggregates_hash = EXCLUDED.aggregates_hash,
         generated_at = now(),
         expires_at = now() + interval '30 days'`,
      [
        inputs.pagePath,
        inputs.locale,
        copy.h1,
        copy.meta_title,
        copy.meta_description,
        copy.intro_paragraph,
        copy.nearby_blurb ?? null,
        JSON.stringify(copy.faq_items),
        aggHash
      ]
    );
  }

  private async generate(inputs: CopyInputs): Promise<GeneratedCopy | null> {
    const config = readAiConfig();
    if (!config.endpoint || !config.apiKey || !config.deployment) {
      this.logger.debug("Azure OpenAI not configured — skipping SEO copy generation");
      return null;
    }

    const isHindi = inputs.locale === "hi";
    const placeName = isHindi ? inputs.placeName.hi : inputs.placeName.en;
    const intent = inputs.intentLabel
      ? isHindi
        ? inputs.intentLabel.hi
        : inputs.intentLabel.en
      : null;

    const groundingFacts = [
      `Place: ${placeName} (${inputs.placeKind})`,
      `Total active listings: ${inputs.aggregates.listing_count}`,
      inputs.aggregates.pg_count != null ? `PG count: ${inputs.aggregates.pg_count}` : null,
      inputs.aggregates.flat_count != null ? `Flat count: ${inputs.aggregates.flat_count}` : null,
      inputs.aggregates.median_rent_pg != null
        ? `Median PG rent: ₹${inputs.aggregates.median_rent_pg}`
        : null,
      inputs.aggregates.median_rent_1bhk != null
        ? `Median 1BHK rent: ₹${inputs.aggregates.median_rent_1bhk}`
        : null,
      inputs.aggregates.median_rent_2bhk != null
        ? `Median 2BHK rent: ₹${inputs.aggregates.median_rent_2bhk}`
        : null,
      inputs.aggregates.nearest_metro
        ? `Nearest metro: ${inputs.aggregates.nearest_metro.name} (${inputs.aggregates.nearest_metro.walk_minutes} min walk)`
        : null,
      inputs.aggregates.parent_locality ? `Part of: ${inputs.aggregates.parent_locality}` : null,
      intent ? `Filter intent: ${intent}` : null
    ]
      .filter(Boolean)
      .join("\n");

    const langGuidance = isHindi
      ? "Write in natural conversational Hindi using Devanagari script. Keep brand and proper place names in their commonly-used form. Do not translate already-Hindi place names back to English."
      : "Write in clear, factual English suitable for an Indian audience. You may include common Hinglish phrases where natural (e.g. 'PG accommodation', 'BHK', 'broker-free').";

    const prompt = `You are writing SEO copy for a rental real-estate listing platform (Cribliv).
Page subject: ${placeName} in Lucknow${intent ? `, filtered to: ${intent}` : ""}.

Grounding facts (do not invent numbers, landmarks, or counts beyond these):
${groundingFacts}

Generate JSON with this exact shape:
{
  "h1": "string, ≤70 chars, includes place name",
  "meta_title": "string, ≤60 chars, ends with — Cribliv",
  "meta_description": "string, 140–155 chars, mentions a concrete fact like rent or count",
  "intro_paragraph": "string, ${MAX_INTRO_WORDS} words max, character of area + who lives there + connectivity",
  "nearby_blurb": "string, ~50 words, what's around — only use named places from the facts",
  "faq_items": [{"q": "...", "a": "..."}]  // exactly ${MAX_FAQ_ITEMS} items, answers ≤60 words
}

${langGuidance}
Never invent listings, landmarks, metro stations, or numerical figures.
Reply with valid JSON only — no markdown, no surrounding prose.`;

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
                "You produce structured SEO copy for an Indian rental platform. Reply with valid JSON only."
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.4,
          max_tokens: 1400,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        this.logger.warn(`SEO copy generation returned HTTP ${response.status}`);
        return null;
      }
      const payload = (await response.json().catch(() => ({}))) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) return null;

      const parsed = JSON.parse(content) as Partial<GeneratedCopy>;
      if (
        typeof parsed.h1 !== "string" ||
        typeof parsed.meta_title !== "string" ||
        typeof parsed.meta_description !== "string" ||
        typeof parsed.intro_paragraph !== "string" ||
        !Array.isArray(parsed.faq_items)
      ) {
        return null;
      }
      return sanitizeGeneratedCopy({
        h1: parsed.h1.slice(0, 100),
        meta_title: parsed.meta_title.slice(0, 70),
        meta_description: parsed.meta_description.slice(0, 160),
        intro_paragraph: parsed.intro_paragraph,
        nearby_blurb: parsed.nearby_blurb ?? null,
        faq_items: parsed.faq_items
          .filter(
            (f): f is { q: string; a: string } =>
              !!f && typeof f.q === "string" && typeof f.a === "string"
          )
          .slice(0, MAX_FAQ_ITEMS)
      });
    } catch (err) {
      this.logger.debug(
        `SEO copy generation failed: ${err instanceof Error ? err.message : String(err)}`
      );
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Worker entry: regenerate copy for pages whose expires_at has passed. */
  async regenerateExpired(limit = 50): Promise<number> {
    if (!this.database.isEnabled()) return 0;
    const { rows } = await this.database.query<{ page_path: string; locale: string }>(
      `SELECT page_path, locale FROM seo_page_copy
       WHERE expires_at < now()
       ORDER BY expires_at ASC
       LIMIT $1`,
      [limit]
    );
    // Worker does not know inputs — caller must rebuild them. We just clear
    // the expired rows; next render of those pages will repopulate via
    // getOrGenerate (which sees the missing row and calls the AI).
    if (rows.length > 0) {
      await this.database.query(
        `DELETE FROM seo_page_copy WHERE expires_at < now()
         AND (page_path, locale) IN (${rows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(", ")})`,
        rows.flatMap((r) => [r.page_path, r.locale])
      );
    }
    return rows.length;
  }
}

function cachedToCopy(row: {
  h1: string;
  meta_title: string;
  meta_description: string;
  intro_paragraph: string;
  nearby_blurb: string | null;
  faq_items: Array<{ q: string; a: string }>;
}): GeneratedCopy {
  return sanitizeGeneratedCopy({
    h1: row.h1,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    intro_paragraph: row.intro_paragraph,
    nearby_blurb: row.nearby_blurb,
    faq_items: row.faq_items
  });
}
