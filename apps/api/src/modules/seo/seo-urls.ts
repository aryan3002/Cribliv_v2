// Canonical URL helpers for SEO surfaces submitted to Google (Indexing API,
// sitemap). Kept in one place so every enqueue path builds the same URLs the
// public sitemap does, and so the origin is configurable for the v1->v2 cutover.

const DEFAULT_SITE_BASE_URL = "https://cribliv.com";
const SEO_LOCALES = ["en", "hi"] as const;

/**
 * Canonical public origin for SEO URLs. Overridable via `SEO_SITE_BASE_URL`;
 * defaults to the production domain the site cuts over to. Trailing slashes
 * are trimmed so callers can safely concatenate a leading-slash path.
 */
export function seoSiteBaseUrl(): string {
  return (process.env.SEO_SITE_BASE_URL || DEFAULT_SITE_BASE_URL).trim().replace(/\/+$/, "");
}

/**
 * Google's Indexing API rejects site-relative URLs. Callers may enqueue a path
 * (e.g. `/en/city/noida`); normalize it to an absolute URL against the
 * canonical origin. Already-absolute http(s) URLs pass through unchanged.
 */
export function toAbsoluteSeoUrl(url: string): string {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return `${seoSiteBaseUrl()}${path}`;
}

/**
 * Canonical page paths (both locales) for a listing, matching the sitemap:
 * PG listings live at `/{locale}/pg/{city}/{id}`, all others at
 * `/{locale}/listing/{id}`. Returned as site-relative paths; the enqueue layer
 * absolutizes them via {@link toAbsoluteSeoUrl}.
 */
export function listingIndexPaths(
  listingType: string | null | undefined,
  city: string | null | undefined,
  listingId: string
): string[] {
  const path = listingType === "pg" && city ? `/pg/${city}/${listingId}` : `/listing/${listingId}`;
  return SEO_LOCALES.map((locale) => `/${locale}${path}`);
}
