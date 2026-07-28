import type { Metadata } from "next";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";
export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * hreflang alternates + canonical for a pathname. `pathname` should be the
 * shared part *after* the locale segment, e.g. "/city/lucknow/gomti-nagar".
 * Canonical always points at the /en variant; /en is also `x-default`.
 */
export function buildAlternates(pathname: string): Metadata["alternates"] {
  const clean = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return {
    canonical: `${SITE_URL}/en${clean}`,
    languages: {
      en: `${SITE_URL}/en${clean}`,
      hi: `${SITE_URL}/hi${clean}`,
      "x-default": `${SITE_URL}/en${clean}`
    }
  };
}

export interface BuildMetadataInput {
  title: string;
  description: string;
  pathname: string; // path after /[locale], starts with /
  locale: Locale;
  image?: string | null;
  noindex?: boolean;
}

export function buildPageMetadata(input: BuildMetadataInput): Metadata {
  const ogImage = input.image ?? `${SITE_URL}/images/og-default.jpg`;
  return {
    title: input.title,
    description: input.description,
    alternates: buildAlternates(input.pathname),
    robots: input.noindex ? { index: false, follow: true } : undefined,
    openGraph: {
      title: input.title,
      description: input.description,
      url: `${SITE_URL}/${input.locale}${input.pathname}`,
      siteName: "Cribliv",
      locale: input.locale === "hi" ? "hi_IN" : "en_IN",
      type: "website",
      images: [{ url: ogImage }]
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [ogImage]
    }
  };
}

/**
 * A trailing separator followed by the bare brand. Requires the brand to be at
 * the very end, so "Cribliv Times" (the publication's own name) and prose like
 * "Why Cribliv verifies owners" are left alone.
 */
const BRAND_SUFFIX_RE = /\s*[|—–\-·]\s*cribliv\s*$/i;

/**
 * Remove a brand suffix a title already carries, because the root layout appends
 * one via `title.template = "%s | Cribliv"` and doing both double-brands the
 * SERP snippet — costing ~10 characters of visible title.
 *
 * This has to happen at render, not just in the generators: the locality page
 * prefers `stored.meta_title` from the `seo_copy` table, and rows written before
 * the title fix end in "— Cribliv". Production served
 * "Rent Flats in Gomti Nagar, Lucknow — Cribliv | Cribliv". Sanitising here
 * repairs every existing row with no prod data migration.
 */
export function stripBrandSuffix(title: string): string {
  let out = title.trim();
  // Loop: a stored title has been seen carrying an em-dash suffix while the
  // template added a pipe one, so a single pass can leave a brand behind.
  for (let i = 0; i < 3; i++) {
    const next = out.replace(BRAND_SUFFIX_RE, "").trim();
    if (next === out) break;
    // A title that is nothing but the brand keeps it — better a branded title
    // than an empty one.
    if (next.length === 0) return out;
    out = next;
  }
  return out;
}

/** Slug validators — kept strict so URL params can't ferry junk into queries. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

export function isValidSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && SLUG_RE.test(slug);
}

/** Canonical kebab-case slug: strips accents, lowercases, removes punctuation. */
export function toSlug(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
