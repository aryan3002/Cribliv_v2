import type { MetadataRoute } from "next";

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

const LOCALES = ["en", "hi"];

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  // Home pages per locale
  for (const locale of LOCALES) {
    entries.push({
      url: `${BASE_URL}/${locale}`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1.0,
      alternates: {
        languages: Object.fromEntries(LOCALES.map((l) => [l, `${BASE_URL}/${l}`]))
      }
    });
  }

  // City pages per locale
  for (const locale of LOCALES) {
    for (const city of CITIES) {
      entries.push({
        url: `${BASE_URL}/${locale}/city/${city}`,
        lastModified: new Date(),
        changeFrequency: "daily",
        priority: 0.8,
        alternates: {
          languages: Object.fromEntries(LOCALES.map((l) => [l, `${BASE_URL}/${l}/city/${city}`]))
        }
      });
    }
  }

  // Search pages per locale
  for (const locale of LOCALES) {
    entries.push({
      url: `${BASE_URL}/${locale}/search`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.7
    });
  }

  // Static marketing pages
  const marketingPages = [
    { path: "about", priority: 0.6, freq: "monthly" as const },
    { path: "contact", priority: 0.5, freq: "monthly" as const },
    { path: "how-it-works", priority: 0.7, freq: "monthly" as const },
    { path: "become-owner", priority: 0.6, freq: "weekly" as const },
    { path: "privacy", priority: 0.3, freq: "yearly" as const },
    { path: "terms", priority: 0.3, freq: "yearly" as const },
    { path: "faq", priority: 0.7, freq: "monthly" as const },
    { path: "pricing", priority: 0.8, freq: "monthly" as const }
  ];
  for (const locale of LOCALES) {
    for (const mp of marketingPages) {
      entries.push({
        url: `${BASE_URL}/${locale}/${mp.path}`,
        lastModified: new Date(),
        changeFrequency: mp.freq,
        priority: mp.priority,
        alternates: {
          languages: Object.fromEntries(LOCALES.map((l) => [l, `${BASE_URL}/${l}/${mp.path}`]))
        }
      });
    }
  }

  // Rent-in-city guide pages
  for (const locale of LOCALES) {
    for (const city of CITIES) {
      entries.push({
        url: `${BASE_URL}/${locale}/rent-in/${city}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.7,
        alternates: {
          languages: Object.fromEntries(LOCALES.map((l) => [l, `${BASE_URL}/${l}/rent-in/${city}`]))
        }
      });
    }
  }

  return entries;
}
