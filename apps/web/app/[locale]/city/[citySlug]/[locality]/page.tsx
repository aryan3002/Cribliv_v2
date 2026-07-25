import type { Metadata } from "next";
import { fetchEnabledCities, fetchLocality, fetchSeoCopy } from "../../../../../lib/seo-api";
import { buildPageMetadata } from "../../../../../lib/seo";
import { buildLocalityTemplateCopy } from "../../../../../lib/seo-template-copy";
import { LocalityHubView } from "./locality-view";

// ISR: revalidate every 24h. On-demand revalidation triggered when listings change.
export const revalidate = 86400;

// Required for the `revalidate` above to cache the PAGE rather than just its
// fetches: without generateStaticParams a route under a dynamic segment renders
// per request, so all ~33k programmatic URLs cost a serverless invocation each.
// Returning [] is deliberate and costs nothing at build time — every path is
// generated on first request and then served from the ISR cache.
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; citySlug: string; locality: string };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities({ revalidate });
  if (!enabledCities.has(params.citySlug)) {
    return buildPageMetadata({
      title: "Not found",
      description: "This page is not available.",
      pathname: `/city/${params.citySlug}/${params.locality}`,
      locale,
      noindex: true
    });
  }
  const data = await fetchLocality(params.citySlug, params.locality, { revalidate });
  if (!data) {
    return buildPageMetadata({
      title: "Locality not found",
      description: "This locality is not available on Cribliv.",
      pathname: `/city/${params.citySlug}/${params.locality}`,
      locale,
      noindex: true
    });
  }
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);
  const template = buildLocalityTemplateCopy({
    locale,
    placeName: { en: data.locality.name_en, hi: data.locality.name_hi },
    cityName,
    aggregates: data.aggregates,
    nearestMetro: null
  });

  // Prefer admin-controlled meta (override, else AI) over the template so edits
  // in the SEO admin actually change the page <title>/<meta description>.
  const stored = await fetchSeoCopy({
    pagePath: `/city/${params.citySlug}/${params.locality}`,
    locale,
    placeName: { en: data.locality.name_en, hi: data.locality.name_hi },
    placeKind: "locality",
    aggregates: {
      ...data.aggregates,
      nearest_metro: null,
      parent_locality: data.locality.parent_locality_slug
    },
    revalidate
  });

  return buildPageMetadata({
    title: stored?.meta_title?.trim() || template.meta_title,
    description: stored?.meta_description?.trim() || template.meta_description,
    pathname: `/city/${params.citySlug}/${params.locality}`,
    locale,
    noindex: data.aggregates.listing_count < 3
  });
}

export default async function LocalityHubPage({
  params
}: {
  params: { locale: string; citySlug: string; locality: string };
}) {
  return <LocalityHubView params={params} revalidate={revalidate} />;
}
