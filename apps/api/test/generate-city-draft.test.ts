import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildDraftPrompt,
  parseDraftResponse,
  draftCity,
  readAiConfig,
  type DraftResult,
} from "../../../data/seeds/generate-city-helpers";

/** Helper to create a Response-like object */
function jsonResponse(
  body: unknown,
  ok: boolean = true,
  status: number = 200
): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function chatCompletion(content: string): unknown {
  return {
    choices: [{ message: { content } }],
  };
}

describe("generate-city-draft", () => {
  describe("buildDraftPrompt", () => {
    const prompt = buildDraftPrompt("Noida", "Uttar Pradesh");

    it("mentions the city and state", () => {
      expect(prompt).toContain("Noida");
      expect(prompt).toContain("Uttar Pradesh");
    });

    it("requests the three arrays", () => {
      expect(prompt).toContain("localities");
      expect(prompt).toContain("micro_localities");
      expect(prompt).toContain("landmarks");
    });

    it("lists it_park as an allowed landmark type", () => {
      expect(prompt).toContain("it_park");
    });

    it("asks for aka / seo_aliases alternative spellings", () => {
      expect(prompt).toContain("aka");
      expect(prompt).toContain("seo_aliases");
      expect(prompt.toLowerCase()).toContain("alternative spelling");
    });
  });

  describe("parseDraftResponse", () => {
    it("returns empty arrays for non-JSON content", () => {
      expect(parseDraftResponse("not json")).toEqual({
        localities: [],
        micro_localities: [],
        landmarks: [],
      });
    });

    it("slugifies, filters, and dedupes a mixed body", () => {
      const body = JSON.stringify({
        localities: [
          {
            name_en: "Sector 62",
            name_hi: "सेक्टर 62",
            pincode: "201309",
          },
          {
            // duplicate slug (same slugified name) — should be dropped by dedupe
            name_en: "Sector 62",
            name_hi: "सेक्टर 62 डुप्लिकेट",
            pincode: "201309",
          },
          {
            // missing name_en — dropped
            name_hi: "अज्ञात",
          },
        ],
        micro_localities: [
          {
            name_en: "Vibhuti Khand",
            name_hi: "विभूति खंड",
            parent_slug: "gomti-nagar",
            seo_aliases: ["vibhutikhand"],
          },
          {
            // missing parent_slug — dropped
            name_en: "Orphan Colony",
            name_hi: "अनाथ कॉलोनी",
          },
        ],
        landmarks: [
          {
            name_en: "University of Lucknow",
            name_hi: "लखनऊ विश्वविद्यालय",
            type: "University", // maps to college
            aka: ["LU"],
          },
          {
            name_en: "City Center",
            name_hi: "सिटी सेंटर",
            type: "shopping mall", // maps to mall
          },
          {
            // unmappable type — dropped
            name_en: "Nightclub Zone",
            name_hi: "नाइट क्लब",
            type: "nightclub",
          },
          {
            // empty slug after slugify — dropped
            name_en: "!!!",
            name_hi: "कुछ नहीं",
            type: "monument",
          },
        ],
      });

      const result = parseDraftResponse(body);

      expect(result.localities).toHaveLength(1);
      expect(result.localities[0]).toMatchObject({
        slug: "sector-62",
        name_en: "Sector 62",
        name_hi: "सेक्टर 62",
        pincode: "201309",
      });

      expect(result.micro_localities).toHaveLength(1);
      expect(result.micro_localities[0]).toMatchObject({
        slug: "vibhuti-khand",
        name_en: "Vibhuti Khand",
        name_hi: "विभूति खंड",
        parent_slug: "gomti-nagar",
        seo_aliases: ["vibhutikhand"],
      });

      expect(result.landmarks).toHaveLength(2);
      expect(result.landmarks[0]).toMatchObject({
        slug: "university-of-lucknow",
        name_en: "University of Lucknow",
        type: "college",
        aka: ["LU"],
      });
      expect(result.landmarks[1]).toMatchObject({
        slug: "city-center",
        name_en: "City Center",
        type: "mall",
      });
    });

    it("carries seo_aliases through for micro_localities", () => {
      const body = JSON.stringify({
        localities: [],
        micro_localities: [
          {
            name_en: "Sector 18",
            name_hi: "सेक्टर 18",
            parent_slug: "sector-18-parent",
            seo_aliases: ["sec18", "sector eighteen"],
          },
        ],
        landmarks: [],
      });
      const result = parseDraftResponse(body);
      expect(result.micro_localities[0].seo_aliases).toEqual([
        "sec18",
        "sector eighteen",
      ]);
    });

    it("defaults missing arrays to empty", () => {
      const result = parseDraftResponse(JSON.stringify({}));
      expect(result).toEqual({
        localities: [],
        micro_localities: [],
        landmarks: [],
      });
    });
  });

  describe("draftCity", () => {
    const config = {
      endpoint: "https://example.openai.azure.com",
      apiKey: "test-key",
      deployment: "gpt-4o",
      timeoutMs: 30000,
    };

    it("posts to the chat completions endpoint with api-key header and returns parsed output", async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse(
          chatCompletion(
            JSON.stringify({
              localities: [
                { name_en: "Sector 62", name_hi: "सेक्टर 62" },
              ],
              micro_localities: [],
              landmarks: [],
            })
          )
        )
      );

      const result = await draftCity("Noida", "Uttar Pradesh", config, mockFetch);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/openai/deployments/gpt-4o/chat/completions");
      expect(init.headers["api-key"]).toBe("test-key");

      expect(result.localities).toHaveLength(1);
      expect(result.localities[0].slug).toBe("sector-62");
    });

    it("returns empty arrays (no throw) on HTTP 500", async () => {
      const mockFetch = vi.fn().mockResolvedValue(jsonResponse({}, false, 500));

      const result = await draftCity("Noida", "Uttar Pradesh", config, mockFetch);
      expect(result).toEqual({
        localities: [],
        micro_localities: [],
        landmarks: [],
      });
    });

    it("returns empty arrays (no throw) when fetch rejects", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));

      const result = await draftCity("Noida", "Uttar Pradesh", config, mockFetch);
      expect(result).toEqual({
        localities: [],
        micro_localities: [],
        landmarks: [],
      });
    });
  });

  describe("readAiConfig", () => {
    const ORIGINAL_ENV = { ...process.env };

    beforeEach(() => {
      delete process.env.AZURE_OPENAI_ENDPOINT;
      delete process.env.AZURE_OPENAI_API_KEY;
      delete process.env.AZURE_OPENAI_CHAT_DEPLOYMENT;
      delete process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT;
      delete process.env.SEO_GENERATE_TIMEOUT_MS;
    });

    afterEach(() => {
      process.env = { ...ORIGINAL_ENV };
    });

    it("reads endpoint/apiKey/deployment from env", () => {
      process.env.AZURE_OPENAI_ENDPOINT = "https://foo.openai.azure.com/";
      process.env.AZURE_OPENAI_API_KEY = "key123";
      process.env.AZURE_OPENAI_CHAT_DEPLOYMENT = "gpt-4o";

      const config = readAiConfig();
      expect(config.endpoint).toBe("https://foo.openai.azure.com");
      expect(config.apiKey).toBe("key123");
      expect(config.deployment).toBe("gpt-4o");
    });

    it("falls back to AZURE_OPENAI_EXTRACT_DEPLOYMENT when chat deployment is unset", () => {
      process.env.AZURE_OPENAI_EXTRACT_DEPLOYMENT = "extract-deploy";
      const config = readAiConfig();
      expect(config.deployment).toBe("extract-deploy");
    });

    it("defaults timeoutMs to 30000", () => {
      const config = readAiConfig();
      expect(config.timeoutMs).toBe(30000);
    });

    it("enforces a minimum timeoutMs of 10000", () => {
      process.env.SEO_GENERATE_TIMEOUT_MS = "1000";
      const config = readAiConfig();
      expect(config.timeoutMs).toBe(10000);
    });

    it("honors a valid SEO_GENERATE_TIMEOUT_MS above the minimum", () => {
      process.env.SEO_GENERATE_TIMEOUT_MS = "45000";
      const config = readAiConfig();
      expect(config.timeoutMs).toBe(45000);
    });
  });
});

// Type-only reference so DraftResult / imports are exercised even without
// per-field assertions above (keeps import list honest for typecheck).
const _typeCheck: DraftResult = {
  localities: [],
  micro_localities: [],
  landmarks: [],
};
void _typeCheck;
