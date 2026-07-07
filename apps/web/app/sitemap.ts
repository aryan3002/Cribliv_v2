import type { MetadataRoute } from "next";

import { buildSearchQuery, getApiBaseUrl } from "../lib/api";
import { fetchAllBlogSlugs } from "../lib/blog-api";
import {
  fetchEnabledCities,
  fetchLandmarks,
  fetchLocalities,
  fetchMetroStationsForCity,
  type LandmarkRow,
  type LocalityRow,
  type MetroStationRow
} from "../lib/seo-api";
import {
  buildCityLandmarkEntries,
  buildCityLocalityEntries,
  buildCityMetroEntries,
  entry
} from "./sitemap-chunks";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";
const FALLBACK_CITIES = ["lucknow"];

const HUB_CITIES = [
  "delhi",
  "gurugram",
  "noida",
  "ghaziabad",
  "faridabad",
  "chandigarh",
  "jaipur",
  "lucknow"
];

type ChunkDescriptor =
  | { kind: "core" }
  | { kind: "listings" }
  | { kind: "blog" }
  | { kind: "city"; citySlug: string };

type SitemapListing = {
  id: string;
  city?: string | null;
  listing_type?: "flat_house" | "pg" | string | null;
};

export async function resolveChunks(): Promise<ChunkDescriptor[]> {
  let cities: string[];
  try {
    const enabled = [...(await fetchEnabledCities())];
    cities = enabled.length > 0 ? enabled : FALLBACK_CITIES;
  } catch {
    cities = FALLBACK_CITIES;
  }

  return [
    { kind: "core" },
    { kind: "listings" },
    ...cities.map((citySlug) => ({ kind: "city" as const, citySlug })),
    { kind: "blog" }
  ];
}

export async function resolveChunkCount(): Promise<number> {
  return (await resolveChunks()).length;
}

export async function generateSitemaps(): Promise<Array<{ id: number }>> {
  const chunks = await resolveChunks();
  return chunks.map((_, id) => ({ id }));
}

function buildCoreChunk(): MetadataRoute.Sitemap {
  const rows: MetadataRoute.Sitemap = [];

  rows.push(...entry(BASE_URL, "", { priority: 1.0, freq: "daily" }));

  for (const city of HUB_CITIES) {
    rows.push(...entry(BASE_URL, `/city/${city}`, { priority: 0.8, freq: "daily" }));
  }

  rows.push(...entry(BASE_URL, "/search", { priority: 0.7, freq: "daily" }));
  rows.push(...entry(BASE_URL, "/map", { priority: 0.75, freq: "daily" }));
  for (const city of HUB_CITIES) {
    rows.push(...entry(BASE_URL, `/rent-in/${city}`, { priority: 0.7 }));
  }

  rows.push(...entry(BASE_URL, "/pg", { priority: 0.7, freq: "daily" }));
  for (const city of HUB_CITIES) {
    rows.push(...entry(BASE_URL, `/pg/${city}`, { priority: 0.7 }));
  }

  const marketingPages: Array<{
    path: string;
    priority: number;
    freq: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
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

  for (const page of marketingPages) {
    rows.push(...entry(BASE_URL, page.path, { priority: page.priority, freq: page.freq }));
  }

  return rows;
}

async function buildListingsChunk(): Promise<MetadataRoute.Sitemap> {
  const rows: MetadataRoute.Sitemap = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 5; page++) {
    try {
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
        rows.push(...entry(BASE_URL, path, { priority: 0.72, freq: "daily" }));
      }

      const total = payload?.data?.total ?? 0;
      const pageSize = payload?.data?.page_size ?? 60;
      if (page * pageSize >= total) break;
    } catch {
      return rows;
    }
  }

  return rows;
}

async function buildCityChunk(citySlug: string): Promise<MetadataRoute.Sitemap> {
  const [localities, landmarks, stations] = await Promise.all([
    fetchLocalities(citySlug).catch((): LocalityRow[] => []),
    fetchLandmarks(citySlug).catch((): LandmarkRow[] => []),
    fetchMetroStationsForCity(citySlug).catch((): MetroStationRow[] => [])
  ]);

  return [
    ...buildCityLocalityEntries(
      BASE_URL,
      citySlug,
      localities.map((locality) => ({
        slug: locality.slug,
        listing_count: locality.listing_count ?? 0
      }))
    ),
    ...buildCityMetroEntries(BASE_URL, citySlug, stations),
    ...buildCityLandmarkEntries(BASE_URL, citySlug, landmarks)
  ];
}

const BLOG_DESKS = ["data-reports", "local-guides", "tenancy", "market-updates"];

async function buildBlogChunk(): Promise<MetadataRoute.Sitemap> {
  const rows: MetadataRoute.Sitemap = [];
  rows.push(...entry(BASE_URL, "/blog", { priority: 0.8, freq: "daily" }));
  for (const desk of BLOG_DESKS) {
    rows.push(...entry(BASE_URL, `/blog/category/${desk}`, { priority: 0.6, freq: "weekly" }));
  }
  rows.push(...entry(BASE_URL, "/blog/author/aditi-sharma", { priority: 0.4, freq: "monthly" }));
  try {
    for (const slug of await fetchAllBlogSlugs()) {
      rows.push(...entry(BASE_URL, `/blog/${slug}`, { priority: 0.7, freq: "weekly" }));
    }
  } catch {
    // best-effort — published posts are added when the API is reachable
  }
  return rows;
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const chunks = await resolveChunks();
  const chunk = chunks[id];
  if (!chunk) return [];

  if (chunk.kind === "core") return buildCoreChunk();
  if (chunk.kind === "listings") return buildListingsChunk();
  if (chunk.kind === "blog") return buildBlogChunk();
  return buildCityChunk(chunk.citySlug);
}
