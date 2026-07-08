import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingService } from "../src/modules/ai/embedding.service";

function makeDatabase(query: ReturnType<typeof vi.fn>) {
  return {
    isEnabled: () => true,
    query
  } as never;
}

describe("EmbeddingService", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips backfill when the optional listing_embeddings table is unavailable", async () => {
    vi.stubEnv("FF_AI_EMBEDDINGS", "true");
    const missingTableError = Object.assign(
      new Error('relation "listing_embeddings" does not exist'),
      {
        code: "42P01"
      }
    );
    const query = vi.fn(async () => {
      throw missingTableError;
    });
    const service = new EmbeddingService(makeDatabase(query));

    await expect(service.backfillEmbeddings()).resolves.toBe(0);
  });

  it("upserts listing embeddings by listing id", async () => {
    vi.stubEnv("FF_AI_EMBEDDINGS", "true");
    vi.stubEnv("AZURE_OPENAI_ENDPOINT", "https://azure.example.test");
    vi.stubEnv("AZURE_OPENAI_API_KEY", "test-key");
    vi.stubEnv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "embed-small");
    const query = vi.fn(async (text: string) => {
      if (/FROM listings l/i.test(text)) {
        return {
          rows: [
            {
              id: "listing-1",
              title_en: "Studio near metro",
              listing_type: "flat_house",
              city: "delhi"
            }
          ]
        };
      }
      return { rows: [] };
    });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { total_tokens: 4 },
        model: "embed-small"
      })
    }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new EmbeddingService(makeDatabase(query));

    await expect(service.embedListing("listing-1")).resolves.toMatchObject({
      listing_id: "listing-1"
    });

    const insertSql = query.mock.calls.find(([sql]) =>
      /INSERT INTO listing_embeddings/i.test(sql)
    )?.[0] as string | undefined;
    expect(insertSql).toMatch(/ON CONFLICT \(listing_id\) DO UPDATE/i);
  });
});
