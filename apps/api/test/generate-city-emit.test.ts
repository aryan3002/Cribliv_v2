import { describe, it, expect, vi } from "vitest";
import {
  buildCityFiles,
  type DraftResult,
  type VerifiedPlace,
} from "../../../data/seeds/generate-city-helpers";

const DRAFT: DraftResult = {
  localities: [
    {
      slug: "sector-62",
      name_en: "Sector 62",
      name_hi: "सेक्टर 62",
      pincode: "201309",
    },
    {
      slug: "ghost-area",
      name_en: "Ghost Area",
      name_hi: "भूत क्षेत्र",
    },
    {
      // duplicate slug of a verified locality — should collapse to one
      slug: "sector-62",
      name_en: "Sector 62 Duplicate",
      name_hi: "सेक्टर 62 डुप्लिकेट",
    },
  ],
  micro_localities: [
    {
      slug: "amrapali-society",
      name_en: "Amrapali Society",
      name_hi: "आम्रपाली सोसाइटी",
      parent_slug: "sector-62",
      seo_aliases: ["amrapali"],
    },
    {
      // parent_slug points at a locality that failed verification (ghost-area)
      // -> ghost-area never makes it into keptLocalitySlugs -> dropped
      slug: "orphan-micro",
      name_en: "Orphan Micro",
      name_hi: "अनाथ माइक्रो",
      parent_slug: "ghost-area",
      seo_aliases: [],
    },
  ],
  landmarks: [
    {
      slug: "amity-university",
      name_en: "Amity University",
      name_hi: "एमिटी विश्वविद्यालय",
      type: "college",
      primary_locality_slug: "sector-62",
      aka: ["Amity"],
    },
  ],
};

/** Verified places keyed by the exact query string the test expects. */
const VERIFIED: Record<string, VerifiedPlace> = {
  "Sector 62, Uttar Pradesh, India": {
    canonical_name: "Sector 62, Noida, UP 201309, India",
    lat: 28.6266,
    lng: 77.3723,
  },
  "Amrapali Society, Uttar Pradesh, India": {
    canonical_name: "Amrapali Society, Noida",
    lat: 28.6111,
    lng: 77.3688,
  },
  "Amity University, Uttar Pradesh, India": {
    canonical_name: "Amity University, Noida",
    lat: 28.5453,
    lng: 77.3238,
  },
};

function makeFakeVerify() {
  const calls: string[] = [];
  const verify = vi.fn(async (query: string) => {
    calls.push(query);
    return VERIFIED[query] ?? null; // ghost-area / duplicates not in map -> null
  });
  return { verify, calls };
}

describe("generate-city-emit", () => {
  it("queries verify with '<name_en>, <stateName>, India'", async () => {
    const { verify, calls } = makeFakeVerify();
    await buildCityFiles("Noida", "Uttar Pradesh", "noida", DRAFT, verify);

    expect(calls).toContain("Sector 62, Uttar Pradesh, India");
    expect(calls).toContain("Amrapali Society, Uttar Pradesh, India");
    expect(calls).toContain("Amity University, Uttar Pradesh, India");
    // never queries by slug
    expect(calls.some((c) => c.includes("sector-62,"))).toBe(false);
  });

  it("drops an unverifiable locality and records it in dropped", async () => {
    const { verify } = makeFakeVerify();
    const result = await buildCityFiles(
      "Noida",
      "Uttar Pradesh",
      "noida",
      DRAFT,
      verify
    );
    expect(result.dropped).toContain("locality:ghost-area");
    expect(result.localities.find((l) => l.slug === "ghost-area")).toBeUndefined();
  });

  it("drops a micro whose parent_slug was not among surviving localities", async () => {
    const { verify } = makeFakeVerify();
    const result = await buildCityFiles(
      "Noida",
      "Uttar Pradesh",
      "noida",
      DRAFT,
      verify
    );
    expect(result.dropped).toContain("micro:orphan-micro");
    expect(
      result.micro_localities.find((m) => m.slug === "orphan-micro")
    ).toBeUndefined();
  });

  it("emits loader-shaped locality/micro/landmark objects with verified lat/lng", async () => {
    const { verify } = makeFakeVerify();
    const result = await buildCityFiles(
      "Noida",
      "Uttar Pradesh",
      "noida",
      DRAFT,
      verify
    );

    const locality = result.localities.find((l) => l.slug === "sector-62");
    expect(locality).toMatchObject({
      city_slug: "noida",
      slug: "sector-62",
      name_en: "Sector 62",
      name_hi: "सेक्टर 62",
      pincode: "201309",
      lat: 28.6266,
      lng: 77.3723,
    });

    const micro = result.micro_localities.find(
      (m) => m.slug === "amrapali-society"
    );
    expect(micro).toMatchObject({
      slug: "amrapali-society",
      name_en: "Amrapali Society",
      name_hi: "आम्रपाली सोसाइटी",
      lat: 28.6111,
      lng: 77.3688,
      seo_aliases: ["amrapali"],
    });

    const landmark = result.landmarks.find((l) => l.slug === "amity-university");
    expect(landmark).toMatchObject({
      slug: "amity-university",
      name_en: "Amity University",
      type: "college",
      lat: 28.5453,
      lng: 77.3238,
      aka: ["Amity"],
    });
  });

  it("defaults seo_aliases:[] and aka:[] when not provided by the candidate", async () => {
    const draftNoDefaults: DraftResult = {
      localities: [
        {
          slug: "sector-62",
          name_en: "Sector 62",
          name_hi: "सेक्टर 62",
        },
      ],
      micro_localities: [
        {
          slug: "amrapali-society",
          name_en: "Amrapali Society",
          name_hi: "आम्रपाली सोसाइटी",
          parent_slug: "sector-62",
        },
      ],
      landmarks: [
        {
          slug: "amity-university",
          name_en: "Amity University",
          name_hi: "एमिटी विश्वविद्यालय",
          type: "college",
        },
      ],
    };
    const { verify } = makeFakeVerify();
    const result = await buildCityFiles(
      "Noida",
      "Uttar Pradesh",
      "noida",
      draftNoDefaults,
      verify
    );
    expect(result.micro_localities[0].seo_aliases).toEqual([]);
    expect(result.landmarks[0].aka).toEqual([]);
  });

  it("is idempotent on slug (duplicate verified localities collapse to one)", async () => {
    const { verify } = makeFakeVerify();
    const result = await buildCityFiles(
      "Noida",
      "Uttar Pradesh",
      "noida",
      DRAFT,
      verify
    );
    const matches = result.localities.filter((l) => l.slug === "sector-62");
    expect(matches).toHaveLength(1);
  });
});
