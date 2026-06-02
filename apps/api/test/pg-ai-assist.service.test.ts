import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgAiAssistService } from "../src/modules/pg-operator/services/pg-ai-assist.service";
import type { PgListingPayload } from "../../packages/shared-types/src/pg-operator";

const basePayload: PgListingPayload = {
  property: { display_name: "Green PG", city_slug: "pune", locality_slug: "kothrud" },
  pg_details: {
    total_beds: 8,
    gender_policy: "girls",
    tenant_type: "working",
    meals: { provided: true, breakfast: true, dinner: true }
  },
  room_types: [
    {
      sharing: "double",
      ac: false,
      monthly_rent_paise: 900000,
      vacancy_count: 2,
      security_deposit_paise: 450000
    },
    {
      sharing: "triple",
      ac: false,
      monthly_rent_paise: 650000,
      vacancy_count: 3,
      security_deposit_paise: 325000
    }
  ]
} as any;

function makeService() {
  const contentGenerator = {
    generate: vi.fn(async () => ({
      title: "Green PG for Girls in Kothrud — ₹9,000/mo",
      description: "Well-maintained PG."
    }))
  };
  const db = {
    isEnabled: () => true,
    query: vi.fn(async () => ({
      rows: [
        { sharing: "double", p25: 800000, p50: 900000, p75: 1050000, sample: 5 },
        { sharing: "triple", p25: 600000, p50: 680000, p75: 750000, sample: 4 }
      ],
      rowCount: 2
    }))
  };
  const svc = new PgAiAssistService(contentGenerator as never, db as never);
  return { svc, contentGenerator, db };
}

describe("PgAiAssistService", () => {
  describe("generateContent", () => {
    it("maps PG payload to GenerateContentInput and returns title + description", async () => {
      const { svc, contentGenerator } = makeService();
      const result = await svc.generateContent(basePayload);
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("description");
      expect(contentGenerator.generate).toHaveBeenCalledOnce();
      const input = contentGenerator.generate.mock.calls[0][0];
      expect(input.listing_type).toBe("pg");
      expect(input.city).toBe("pune");
    });
  });

  describe("pricingSuggestions", () => {
    it("returns p25/p50/p75 in paise for each sharing type with sufficient samples", async () => {
      const { svc } = makeService();
      const result = await svc.pricingSuggestions({
        city_slug: "pune",
        sharings: ["double", "triple"]
      });
      expect(result.suggestions).toHaveLength(2);
      const dbl = result.suggestions.find((s) => s.sharing === "double");
      expect(dbl).toBeDefined();
      expect(dbl!.p50_paise).toBe(900000);
      expect(dbl!.sample).toBe(5);
    });

    it("omits sharing types with sample < 3", async () => {
      const db = {
        isEnabled: () => true,
        query: vi.fn(async () => ({
          rows: [{ sharing: "single", p25: 500000, p50: 600000, p75: 700000, sample: 2 }],
          rowCount: 1
        }))
      };
      const contentGenerator = { generate: vi.fn() };
      const svc = new PgAiAssistService(contentGenerator as never, db as never);
      const result = await svc.pricingSuggestions({ city_slug: "pune", sharings: ["single"] });
      expect(result.suggestions).toHaveLength(0);
    });
  });

  describe("amenitySuggestions", () => {
    it("returns arrays of amenity and house_rule strings", async () => {
      const { svc } = makeService();
      const result = await svc.amenitySuggestions(basePayload);
      expect(Array.isArray(result.amenities)).toBe(true);
      expect(Array.isArray(result.house_rules)).toBe(true);
    });
  });
});
