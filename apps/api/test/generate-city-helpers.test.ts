import { describe, it, expect } from "vitest";
import {
  slugify,
  mapLandmarkType,
  dedupeBySlug,
  toLocalityOut,
  toMicroLocalityOut,
  toLandmarkOut,
  LANDMARK_TYPES,
} from "../../../data/seeds/generate-city-helpers";

describe("generate-city-helpers", () => {
  describe("slugify", () => {
    it("lowercases and handles sectors", () => {
      expect(slugify("Sector 62")).toBe("sector-62");
    });

    it("strips apostrophes before separator collapse", () => {
      expect(slugify("King George's Medical University")).toBe(
        "king-georges-medical-university"
      );
    });

    it("strips periods and apostrophes", () => {
      expect(slugify("St. Joseph's")).toBe("st-josephs");
    });

    it("handles multiple periods and exclamation", () => {
      expect(slugify("Dr. A.P.J. Abdul Kalam!")).toBe("dr-a-p-j-abdul-kalam");
    });

    it("collapses multiple separators and slashes", () => {
      expect(slugify("Sector – 18 // Atta")).toBe("sector-18-atta");
    });

    it("strips non-ASCII Devanagari, keeps Latin", () => {
      expect(slugify("विभूति खंड Vibhuti Khand")).toBe("vibhuti-khand");
    });

    it("returns empty string for pure Devanagari", () => {
      expect(slugify("विभूति")).toBe("");
    });

    it("returns empty string for punctuation only", () => {
      expect(slugify("!!!")).toBe("");
    });
  });

  describe("mapLandmarkType", () => {
    it("recognizes all LANDMARK_TYPES directly", () => {
      for (const t of LANDMARK_TYPES) {
        expect(mapLandmarkType(t)).toBe(t);
      }
    });

    it("maps University to college", () => {
      expect(mapLandmarkType("University")).toBe("college");
    });

    it("maps shopping mall to mall", () => {
      expect(mapLandmarkType("shopping mall")).toBe("mall");
    });

    it("maps Bus Stand to station", () => {
      expect(mapLandmarkType("Bus Stand")).toBe("station");
    });

    it("maps tech park to it_park", () => {
      expect(mapLandmarkType("tech park")).toBe("it_park");
    });

    it("maps temple to religious", () => {
      expect(mapLandmarkType("temple")).toBe("religious");
    });

    it("returns null for unmapped type", () => {
      expect(mapLandmarkType("nightclub")).toBeNull();
    });
  });

  describe("dedupeBySlug", () => {
    it("keeps first occurrence per slug", () => {
      expect(
        dedupeBySlug([
          { slug: "a", n: 1 },
          { slug: "b", n: 2 },
          { slug: "a", n: 3 },
        ])
      ).toEqual([
        { slug: "a", n: 1 },
        { slug: "b", n: 2 },
      ]);
    });
  });

  describe("transforms", () => {
    it("toLocalityOut merges fields correctly", () => {
      const result = toLocalityOut(
        "noida",
        {
          slug: "sector-62",
          name_en: "Sector 62",
          name_hi: "सेक्टर 62",
          pincode: "201309",
        },
        {
          canonical_name: "Sector 62",
          lat: 28.6266,
          lng: 77.3723,
        }
      );
      expect(result).toEqual({
        city_slug: "noida",
        slug: "sector-62",
        name_en: "Sector 62",
        name_hi: "सेक्टर 62",
        pincode: "201309",
        lat: 28.6266,
        lng: 77.3723,
      });
    });

    it("toMicroLocalityOut defaults seo_aliases to empty array", () => {
      const result = toMicroLocalityOut(
        {
          slug: "kailash-colony",
          name_en: "Kailash Colony",
          name_hi: "कैलाश कॉलोनी",
        },
        {
          canonical_name: "Kailash Colony",
          lat: 28.5244,
          lng: 77.1855,
        }
      );
      expect(result).toEqual({
        slug: "kailash-colony",
        name_en: "Kailash Colony",
        name_hi: "कैलाश कॉलोनी",
        lat: 28.5244,
        lng: 77.1855,
        seo_aliases: [],
      });
    });

    it("toLandmarkOut defaults aka to empty array and omits primary_locality_slug when absent", () => {
      const result = toLandmarkOut(
        {
          slug: "delhi-airport",
          name_en: "Delhi Airport",
          name_hi: "दिल्ली एयरपोर्ट",
        },
        {
          canonical_name: "Indira Gandhi International Airport",
          lat: 28.5562,
          lng: 77.1197,
        },
        "airport"
      );
      expect(result).toEqual({
        slug: "delhi-airport",
        name_en: "Delhi Airport",
        name_hi: "दिल्ली एयरपोर्ट",
        type: "airport",
        lat: 28.5562,
        lng: 77.1197,
        aka: [],
      });
      expect(result).not.toHaveProperty("primary_locality_slug");
    });

    it("toLandmarkOut includes primary_locality_slug when present", () => {
      const result = toLandmarkOut(
        {
          slug: "aiims-delhi",
          name_en: "AIIMS Delhi",
          name_hi: "एम्स दिल्ली",
          primary_locality_slug: "ansari-nagar",
        },
        {
          canonical_name: "All India Institute of Medical Sciences",
          lat: 28.5676,
          lng: 77.2065,
        },
        "hospital"
      );
      expect(result).toEqual({
        slug: "aiims-delhi",
        name_en: "AIIMS Delhi",
        name_hi: "एम्स दिल्ली",
        type: "hospital",
        lat: 28.5676,
        lng: 77.2065,
        primary_locality_slug: "ansari-nagar",
        aka: [],
      });
    });
  });
});
