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

  // Static pages
  for (const locale of LOCALES) {
    entries.push({
      url: `${BASE_URL}/${locale}/become-owner`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5
    });
  }

  return entries;
}
