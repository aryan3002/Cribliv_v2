import type { MetadataRoute } from "next";
import lucknowLandmarks from "../../../data/seeds/lucknow/landmarks.json";
import lucknowMicroLocalities from "../../../data/seeds/lucknow/micro-localities.json";
import lucknowMetro from "../../../data/seeds/metro-stations-lucknow.json";
import { buildSearchQuery, getApiBaseUrl } from "../lib/api";
import { ALL_INTENTS } from "../lib/intent-filters";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

const CITIES = [
  "delhi",
  "gurugram",
  "noida",
  "ghaziabad",
  "faridabad",
  "chandigarh",
  "jaipur",
  "lucknow"
];

const LOCALES = ["en", "hi"] as const;

// Parent localities seeded by migration 0012; micro-localities seeded via JSON.
const LUCKNOW_PARENT_LOCALITIES = [
  "gomti-nagar",
  "hazratganj",
  "indira-nagar",
  "alambagh",
  "aliganj",
  "vikas-nagar",
  "rajajipuram",
  "chinhat",
  "mahanagar",
  "lucknow-cantt",
  "aminabad",
  "chowk",
  "kapoorthala",
  "nirala-nagar",
  "sushant-golf-city"
];

const LUCKNOW_LOCALITY_SLUGS = [
  ...LUCKNOW_PARENT_LOCALITIES,
  ...(lucknowMicroLocalities as Array<{ slug: string }>).map((m) => m.slug)
];

const LUCKNOW_METRO_SLUGS = (
  lucknowMetro as {
    lines: Array<{ stations: Array<{ name: string }> }>;
  }
).lines.flatMap((line) =>
  line.stations.map((s) => s.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))
);

const LUCKNOW_LANDMARK_SLUGS = (lucknowLandmarks as Array<{ slug: string }>).map((l) => l.slug);

function altLanguages(path: string) {
  return Object.fromEntries(LOCALES.map((l) => [l, `${BASE_URL}/${l}${path}`]));
}

function entry(
  path: string,
  options: { priority?: number; freq?: MetadataRoute.Sitemap[number]["changeFrequency"] } = {}
): MetadataRoute.Sitemap {
  const priority = options.priority ?? 0.5;
  const freq = options.freq ?? "weekly";
  return LOCALES.map((locale) => ({
    url: `${BASE_URL}/${locale}${path}`,
    lastModified: new Date(),
    changeFrequency: freq,
    priority,
    alternates: { languages: altLanguages(path) }
  }));
}

type SitemapListing = {
  id: string;
  city?: string | null;
  listing_type?: "flat_house" | "pg" | string | null;
};

async function fetchListingEntries(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  const seen = new Set<string>();

  try {
    for (let page = 1; page <= 5; page++) {
      const query = buildSearchQuery({ page, page_size: 60, sort: "newest" });
      const response = await fetch(`${getApiBaseUrl()}/listings/search?${query}`, {
        next: { revalidate: 60 * 60 }
      });
      if (!response.ok) break;

      const payload = (await response.json().catch(() => null)) as {
        data?: { items?: SitemapListing[]; total?: number; page_size?: number };
      } | null;
      const items = payload?.data?.items ?? [];
      if (items.length === 0) break;

      for (const item of items) {
        if (!item.id || seen.has(item.id)) continue;
        seen.add(item.id);
        const path =
          item.listing_type === "pg" && item.city
            ? `/pg/${item.city}/${item.id}`
            : `/listing/${item.id}`;
        entries.push(...entry(path, { priority: 0.72, freq: "daily" }));
      }

      const total = payload?.data?.total ?? 0;
      const pageSize = payload?.data?.page_size ?? 60;
      if (page * pageSize >= total) break;
    }
  } catch {
    return entries;
  }

  return entries;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  // Home & top-level
  entries.push(...entry("", { priority: 1.0, freq: "daily" }));

  // City hubs
  for (const city of CITIES) {
    entries.push(...entry(`/city/${city}`, { priority: 0.8, freq: "daily" }));
  }

  // Search + rent-in guides
  entries.push(...entry("/search", { priority: 0.7, freq: "daily" }));
  entries.push(...entry("/map", { priority: 0.75, freq: "daily" }));
  for (const city of CITIES) {
    entries.push(...entry(`/rent-in/${city}`, { priority: 0.7, freq: "weekly" }));
  }

  // PG search + city landings
  entries.push(...entry("/pg", { priority: 0.7, freq: "daily" }));
  for (const city of CITIES) {
    entries.push(...entry(`/pg/${city}`, { priority: 0.7, freq: "weekly" }));
  }

  // Marketing pages
  const marketingPages: Array<{
    path: string;
    priority: number;
    freq: MetadataRoute.Sitemap[number]["changeFrequency"];
  }> = [
    { path: "/about", priority: 0.6, freq: "monthly" },
    { path: "/contact", priority: 0.5, freq: "monthly" },
    { path: "/how-it-works", priority: 0.7, freq: "monthly" },
    { path: "/become-owner", priority: 0.6, freq: "weekly" },
    { path: "/privacy", priority: 0.3, freq: "yearly" },
    { path: "/terms", priority: 0.3, freq: "yearly" },
    { path: "/faq", priority: 0.7, freq: "monthly" },
    { path: "/pricing", priority: 0.8, freq: "monthly" }
  ];
  for (const mp of marketingPages) {
    entries.push(...entry(mp.path, { priority: mp.priority, freq: mp.freq }));
  }

  // ── Lucknow programmatic SEO surface ───────────────────────────────────────
  const localityIntents = ALL_INTENTS.filter((i) => i.applies_to.includes("locality"));
  const metroIntents = ALL_INTENTS.filter((i) => i.applies_to.includes("metro"));
  const landmarkIntents = ALL_INTENTS.filter((i) => i.applies_to.includes("landmark"));

  // Localities
  for (const slug of LUCKNOW_LOCALITY_SLUGS) {
    entries.push(...entry(`/city/lucknow/${slug}`, { priority: 0.75, freq: "weekly" }));
    for (const intent of localityIntents) {
      entries.push(
        ...entry(`/city/lucknow/${slug}/${intent.slug}`, {
          priority: 0.6,
          freq: "weekly"
        })
      );
    }
  }

  // Metro stations
  for (const slug of LUCKNOW_METRO_SLUGS) {
    entries.push(...entry(`/city/lucknow/metro/${slug}`, { priority: 0.7, freq: "weekly" }));
    for (const intent of metroIntents) {
      entries.push(
        ...entry(`/city/lucknow/metro/${slug}/${intent.slug}`, {
          priority: 0.55,
          freq: "weekly"
        })
      );
    }
  }

  // Landmarks
  for (const slug of LUCKNOW_LANDMARK_SLUGS) {
    entries.push(...entry(`/city/lucknow/near/${slug}`, { priority: 0.7, freq: "weekly" }));
    for (const intent of landmarkIntents) {
      entries.push(
        ...entry(`/city/lucknow/near/${slug}/${intent.slug}`, {
          priority: 0.55,
          freq: "weekly"
        })
      );
    }
  }

  entries.push(...(await fetchListingEntries()));

  return entries;
}
