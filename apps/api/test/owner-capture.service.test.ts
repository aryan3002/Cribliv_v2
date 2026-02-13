import { afterEach, describe, expect, it } from "vitest";
import { OwnerCaptureService } from "../src/modules/owner/owner.capture.service";
import { parseIndianNumber, toConfidenceTier } from "../src/modules/owner/owner.capture.utils";

describe("Owner capture utilities", () => {
  it("parses Indian number patterns", () => {
    expect(parseIndianNumber("18k")).toBe(18000);
    expect(parseIndianNumber("2 lakh")).toBe(200000);
    expect(parseIndianNumber("₹35,000")).toBe(35000);
    expect(parseIndianNumber("२० हजार")).toBe(20000);
  });

  it("maps confidence scores to tiers", () => {
    expect(toConfidenceTier(0.9)).toBe("high");
    expect(toConfidenceTier(0.7)).toBe("medium");
    expect(toConfidenceTier(0.3)).toBe("low");
  });
});

describe("OwnerCaptureService extraction", () => {
  afterEach(() => {
    delete process.env.FF_OWNER_LISTING_ASSISTED_CAPTURE;
  });

  function createService(
    input: {
      dbEnabled?: boolean;
      cities?: Array<{ id: number; slug: string; name_en: string; name_hi: string }>;
      localities?: Array<{ slug: string; name_en: string; name_hi: string }>;
    } = {}
  ) {
    const dbEnabled = input.dbEnabled ?? false;
    const database = {
      isEnabled: () => dbEnabled,
      query: async (sql: string) => {
        if (sql.includes("FROM cities")) {
          return { rows: input.cities ?? [], rowCount: (input.cities ?? []).length };
        }
        if (sql.includes("FROM localities")) {
          return { rows: input.localities ?? [], rowCount: (input.localities ?? []).length };
        }
        return { rows: [], rowCount: 0 };
      }
    };

    const speechClient = {
      transcribe: async () =>
        "Mere paas Noida mein 2BHK hai, rent 18k hai, title spacious 2BHK near metro"
    };

    const extractorClient = {
      extractDraft: async () => ({
        draft_suggestion: {
          title: "Spacious 2BHK near metro",
          listing_type: "flat_house",
          rent: "18k",
          location: { city: "Noida", locality: "Sector 62" }
        },
        field_confidence: {
          title: 0.92,
          listing_type: 0.9,
          rent: 0.82,
          "location.city": 0.88,
          "location.locality": 0.65
        },
        critical_warnings: []
      })
    };

    return new OwnerCaptureService(
      database as never,
      speechClient as never,
      extractorClient as never
    );
  }

  it("normalizes draft values and returns confirm fields", async () => {
    process.env.FF_OWNER_LISTING_ASSISTED_CAPTURE = "true";
    const service = createService({ dbEnabled: false });
    const result = await service.extractFromAudio({
      audioBuffer: Buffer.from("test"),
      contentType: "audio/webm",
      locale: "hi-IN"
    });

    expect(result.draft_suggestion.rent).toBe(18000);
    expect(result.draft_suggestion.location?.city).toBe("noida");
    expect(result.confirm_fields).toContain("listing_type");
    expect(result.confirm_fields).toContain("rent");
    expect(result.confirm_fields).toContain("location.city");
    expect(result.missing_required_fields).toEqual([]);
  });

  it("marks city missing when city catalog validation fails in db mode", async () => {
    process.env.FF_OWNER_LISTING_ASSISTED_CAPTURE = "true";
    const service = createService({
      dbEnabled: true,
      cities: [{ id: 1, slug: "delhi", name_en: "delhi", name_hi: "दिल्ली" }]
    });

    const result = await service.extractFromAudio({
      audioBuffer: Buffer.from("test"),
      contentType: "audio/webm",
      locale: "en-IN"
    });

    expect(result.draft_suggestion.location?.city).toBeUndefined();
    expect(result.missing_required_fields).toContain("location.city");
    expect(result.critical_warnings.length).toBeGreaterThan(0);
  });
});
