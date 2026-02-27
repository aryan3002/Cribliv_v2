import { Inject, Injectable, Logger } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import type { EmbeddingResult } from "./ai.types";

// ─── Azure OpenAI Embeddings configuration ──────────────────────────────────

interface EmbeddingsConfig {
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

function readEmbeddingsConfig(): EmbeddingsConfig {
  return {
    endpoint: trimTrailingSlash(process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? ""),
    apiKey: process.env.AZURE_OPENAI_API_KEY?.trim() ?? "",
    deployment: process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT?.trim() || "text-embedding-3-small",
    timeoutMs: parsePositiveInt(process.env.AZURE_AI_TIMEOUT_MS, 10000)
  };
}

/**
 * Build a textual representation of a listing for embedding.
 * Concatenates key searchable fields into a single document string.
 */
function buildListingDocument(listing: ListingRow): string {
  const parts: string[] = [];

  if (listing.title_en) parts.push(listing.title_en);
  if (listing.title_hi) parts.push(listing.title_hi);
  if (listing.description_en) parts.push(listing.description_en);
  if (listing.description_hi) parts.push(listing.description_hi);

  parts.push(`${listing.listing_type === "pg" ? "PG hostel" : "Flat house apartment"}`);

  if (listing.city) parts.push(listing.city);
  if (listing.locality) parts.push(listing.locality);
  if (listing.bhk) parts.push(`${listing.bhk}BHK`);
  if (listing.monthly_rent) parts.push(`₹${listing.monthly_rent}/month`);
  if (listing.furnishing) parts.push(listing.furnishing.replace(/_/g, " "));

  return parts.join(" | ");
}

interface ListingRow {
  id: string;
  title_en?: string;
  title_hi?: string;
  description_en?: string;
  description_hi?: string;
  listing_type: string;
  city?: string;
  locality?: string;
  bhk?: number;
  monthly_rent?: number;
  furnishing?: string;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  /**
   * Generate and store embedding for a single listing.
   * Called on listing create/update when ff_ai_embeddings is ON.
   */
  async embedListing(listingId: string): Promise<EmbeddingResult | null> {
    const flags = readFeatureFlags();
    if (!flags.ff_ai_embeddings) return null;
    if (!this.database.isEnabled()) return null;

    try {
      // Fetch listing data
      const result = await this.database.query<ListingRow>(
        `SELECT
           l.id::text,
           l.title_en, l.title_hi,
           l.description_en, l.description_hi,
           l.listing_type::text,
           c.slug AS city,
           loc.slug AS locality,
           l.bhk,
           l.monthly_rent,
           l.furnishing::text
         FROM listings l
         JOIN listing_locations ll ON ll.listing_id = l.id
         JOIN cities c ON c.id = ll.city_id
         LEFT JOIN localities loc ON loc.id = ll.locality_id
         WHERE l.id = $1`,
        [listingId]
      );

      if (result.rows.length === 0) {
        this.logger.warn(`Listing ${listingId} not found for embedding`);
        return null;
      }

      const listing = result.rows[0];
      const document = buildListingDocument(listing);
      const embeddingResult = await this.callEmbeddingApi(document);

      if (!embeddingResult) return null;

      // Upsert into listing_embeddings
      await this.database.query(
        `INSERT INTO listing_embeddings (listing_id, embedding, model, token_count)
         VALUES ($1, $2::vector, $3, $4)
         ON CONFLICT (listing_id, embedding, model, token_count) DO UPDATE SET
           embedding = EXCLUDED.embedding,
           model = EXCLUDED.model,
           token_count = EXCLUDED.token_count`,
        [
          listingId,
          `[${embeddingResult.embedding.join(",")}]`,
          embeddingResult.model,
          embeddingResult.tokenCount
        ]
      );

      return {
        listing_id: listingId,
        embedding: embeddingResult.embedding,
        token_count: embeddingResult.tokenCount,
        model: embeddingResult.model
      };
    } catch (error) {
      this.logger.error(`Failed to embed listing ${listingId}`, error);
      return null;
    }
  }

  /**
   * Generate embedding for a search query (for cosine similarity search).
   */
  async embedQuery(query: string): Promise<number[] | null> {
    const flags = readFeatureFlags();
    if (!flags.ff_ai_embeddings) return null;

    try {
      const result = await this.callEmbeddingApi(query);
      return result?.embedding ?? null;
    } catch (error) {
      this.logger.error("Failed to embed search query", error);
      return null;
    }
  }

  /**
   * Semantic search: find top-K listings by cosine similarity to a query embedding.
   */
  async semanticSearch(
    queryEmbedding: number[],
    limit = 50,
    cityFilter?: string
  ): Promise<Array<{ listing_id: string; similarity: number }>> {
    if (!this.database.isEnabled()) return [];

    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    const params: unknown[] = [embeddingStr, limit];
    let cityClause = "";

    if (cityFilter) {
      params.push(cityFilter);
      cityClause = `AND c.slug = $${params.length}`;
    }

    const result = await this.database.query<{
      listing_id: string;
      similarity: number;
    }>(
      `SELECT
         le.listing_id::text,
         1 - (le.embedding <=> $1::vector) AS similarity
       FROM listing_embeddings le
       JOIN listings l ON l.id = le.listing_id
       JOIN listing_locations ll ON ll.listing_id = l.id
       JOIN cities c ON c.id = ll.city_id
       WHERE l.status = 'active' ${cityClause}
       ORDER BY le.embedding <=> $1::vector
       LIMIT $2`,
      params
    );

    return result.rows;
  }

  /**
   * Bulk embed all active listings that don't have embeddings yet.
   * Intended for background job / admin trigger.
   */
  async backfillEmbeddings(batchSize = 50): Promise<number> {
    const flags = readFeatureFlags();
    if (!flags.ff_ai_embeddings) return 0;
    if (!this.database.isEnabled()) return 0;

    const missing = await this.database.query<{ id: string }>(
      `SELECT l.id::text
       FROM listings l
       LEFT JOIN listing_embeddings le ON le.listing_id = l.id
       WHERE l.status = 'active' AND le.listing_id IS NULL
       LIMIT $1`,
      [batchSize]
    );

    let count = 0;
    for (const row of missing.rows) {
      const result = await this.embedListing(row.id);
      if (result) count++;
    }

    this.logger.log(`Backfilled ${count} listing embeddings`);
    return count;
  }

  // ── Azure OpenAI Embeddings API call ────────────────────────────────────────

  private async callEmbeddingApi(
    input: string
  ): Promise<{ embedding: number[]; tokenCount: number; model: string } | null> {
    const config = readEmbeddingsConfig();
    if (!config.endpoint || !config.apiKey || !config.deployment) {
      this.logger.warn("Azure OpenAI embeddings not configured — skipping");
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    const url = `${config.endpoint}/openai/deployments/${encodeURIComponent(config.deployment)}/embeddings?api-version=2024-10-21`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey
        },
        body: JSON.stringify({
          input,
          encoding_format: "float"
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        this.logger.warn(`Azure embeddings API returned ${response.status}`);
        return null;
      }

      const payload = (await response.json()) as {
        data?: Array<{ embedding?: number[] }>;
        usage?: { total_tokens?: number };
        model?: string;
      };

      const embedding = payload.data?.[0]?.embedding;
      if (!embedding || !Array.isArray(embedding)) {
        this.logger.warn("Azure embeddings returned empty embedding");
        return null;
      }

      return {
        embedding,
        tokenCount: payload.usage?.total_tokens ?? 0,
        model: payload.model ?? config.deployment
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        this.logger.warn("Azure embeddings API timed out");
        return null;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
