/**
 * JSON-LD builders for programmatic SEO pages. Each function returns a
 * plain object ready for JSON.stringify into a <script type="application/ld+json">.
 *
 * Keep helpers small and composable; pages typically render 2–4 schemas
 * (Place + Breadcrumb + FAQ + optional AggregateOffer).
 */

import { SITE_URL } from "./seo";

type JsonLd = Record<string, unknown>;

export function buildBreadcrumb(items: Array<{ name: string; href: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.href.startsWith("http") ? item.href : `${SITE_URL}${item.href}`
    }))
  };
}

export function buildFaqPage(items: Array<{ q: string; a: string }>): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a }
    }))
  };
}

export interface PlaceInput {
  name: string;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  parentAreaName?: string | null;
  url: string;
}

export function buildPlace(input: PlaceInput): JsonLd {
  const out: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Place",
    name: input.name,
    url: input.url.startsWith("http") ? input.url : `${SITE_URL}${input.url}`
  };
  if (input.description) out.description = input.description;
  if (input.parentAreaName) {
    out.containedInPlace = {
      "@type": "AdministrativeArea",
      name: input.parentAreaName
    };
  }
  if (input.lat != null && input.lng != null) {
    out.geo = {
      "@type": "GeoCoordinates",
      latitude: input.lat,
      longitude: input.lng
    };
  }
  return out;
}

export interface AggregateOfferInput {
  count: number;
  lowPrice: number;
  highPrice: number;
  url: string;
}

export function buildAggregateOffer(input: AggregateOfferInput): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Accommodation",
    name: "Available rentals",
    url: input.url.startsWith("http") ? input.url : `${SITE_URL}${input.url}`,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "INR",
      lowPrice: input.lowPrice,
      highPrice: input.highPrice,
      offerCount: input.count,
      availability: "https://schema.org/InStock"
    }
  };
}

export interface ListingInput {
  /** Canonical page URL — absolute, or a path resolved against SITE_URL. */
  url: string;
  name: string;
  description?: string | null;
  /** Monthly rent, in rupees. Omit to render a listing with no Offer. */
  price?: number | null;
  /** Photo URLs. Only absolute http(s) URLs are emitted (schema.org requires them). */
  images?: string[] | null;
  addressLocality?: string | null;
  /** City — mapped to addressRegion. */
  addressRegion?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** Defaults to available (InStock). */
  available?: boolean;
}

/**
 * schema.org RealEstateListing for a single rental/PG detail page.
 *
 * The Offer carries a per-month UnitPriceSpecification (unitCode "MON") so the
 * rent reads as a recurring monthly price rather than a one-off sale price, plus
 * PostalAddress + GeoCoordinates for local-search understanding. Every optional
 * field is omitted when its source data is missing rather than emitted empty.
 */
export function buildListing(input: ListingInput): JsonLd {
  const abs = (p: string) => (p.startsWith("http") ? p : `${SITE_URL}${p}`);

  const out: JsonLd = {
    "@context": "https://schema.org",
    "@type": "RealEstateListing",
    name: input.name,
    url: abs(input.url)
  };

  if (input.description) out.description = input.description;

  const images = (input.images ?? []).filter((url) => /^https?:\/\//i.test(url));
  if (images.length > 0) out.image = images;

  if (input.addressLocality || input.addressRegion) {
    const address: JsonLd = { "@type": "PostalAddress", addressCountry: "IN" };
    if (input.addressLocality) address.addressLocality = input.addressLocality;
    if (input.addressRegion) address.addressRegion = input.addressRegion;
    out.address = address;
  }

  if (input.lat != null && input.lng != null) {
    out.geo = { "@type": "GeoCoordinates", latitude: input.lat, longitude: input.lng };
  }

  if (input.price != null) {
    out.offers = {
      "@type": "Offer",
      price: input.price,
      priceCurrency: "INR",
      availability:
        input.available === false ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: input.price,
        priceCurrency: "INR",
        unitCode: "MON"
      }
    };
  }

  return out;
}

export function buildOrganization(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Cribliv",
    url: SITE_URL,
    sameAs: []
  };
}

export function buildWebSiteSearch(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Cribliv",
    url: SITE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE_URL}/en/search?q={search_term_string}`,
      "query-input": "required name=search_term_string"
    }
  };
}

export interface ArticleInput {
  headline: string;
  description?: string | null;
  authorName: string;
  authorUrl: string;
  /** "Organization" for the house data desk byline; defaults to "Person". */
  authorType?: "Person" | "Organization";
  datePublished?: string | null;
  dateModified?: string | null;
  image?: string | null;
  url: string;
}

/** schema.org Article for blog posts — carries the byline (Person) + publisher
 *  (Organization) that drive E-E-A-T signals. */
export function buildArticle(input: ArticleInput): JsonLd {
  const abs = (p: string) => (p.startsWith("http") ? p : `${SITE_URL}${p}`);
  const out: JsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    mainEntityOfPage: abs(input.url),
    author: {
      "@type": input.authorType ?? "Person",
      name: input.authorName,
      url: abs(input.authorUrl)
    },
    publisher: {
      "@type": "Organization",
      name: "Cribliv",
      url: SITE_URL,
      logo: { "@type": "ImageObject", url: `${SITE_URL}/cribliv.png` }
    }
  };
  if (input.description) out.description = input.description;
  if (input.datePublished) out.datePublished = input.datePublished;
  if (input.dateModified ?? input.datePublished)
    out.dateModified = input.dateModified ?? input.datePublished;
  if (input.image) out.image = abs(input.image);
  return out;
}

/** Inline script-tag string for embedding multiple schemas in one block. */
export function renderJsonLd(...nodes: JsonLd[]): string {
  return JSON.stringify(nodes.length === 1 ? nodes[0] : nodes);
}
