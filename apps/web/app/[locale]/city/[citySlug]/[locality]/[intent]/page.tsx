import type { Metadata } from "next";
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { fetchEnabledCities, fetchListings, fetchLocality } from "../../../../../../lib/seo-api";
import { buildPageMetadata } from "../../../../../../lib/seo";
import { cityLabel, getIntent, renderIntentTitle } from "../../../../../../lib/intent-filters";
import { localityIntentQuery, LocalityIntentView } from "./intent-view";

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
  params: { locale: string; citySlug: string; locality: string; intent: string };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities({ revalidate });
  if (!enabledCities.has(params.citySlug)) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/${params.locality}/${params.intent}`,
      locale,
      noindex: true
    });
  }
  const intent = getIntent(params.intent);
  const data = await fetchLocality(params.citySlug, params.locality, { revalidate });
  if (!intent || !data || !intent.applies_to.includes("locality")) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/${params.locality}/${params.intent}`,
      locale,
      noindex: true
    });
  }
  const placeName = locale === "hi" ? data.locality.name_hi : data.locality.name_en;
  const city = cityLabel(params.citySlug, locale);
  // Count with the intent filter applied. The locality's own total is not the
  // number this page shows, so it must not be the number that gates indexing.
  // `revalidate` is passed so this stays ISR-cached — a no-store fetch here
  // would opt all ~33k programmatic routes back into per-request rendering.
  const filtered = await fetchListings(
    { ...localityIntentQuery(params.citySlug, data.locality.slug, intent), page_size: 1 },
    { revalidate }
  );
  return buildPageMetadata({
    title: renderIntentTitle(intent, { name: placeName, kind: "locality", city }, locale),
    description:
      locale === "hi"
        ? `${placeName}, ${city} में ${intent.label_hi}, Cribliv पर सत्यापित लिस्टिंग।`
        : `Verified ${intent.label_en.toLowerCase()} in ${placeName}, ${city}. Direct-owner contact, zero brokerage.`,
    pathname: `/city/${params.citySlug}/${params.locality}/${params.intent}`,
    locale,
    noindex: filtered.total < INDEXABLE_MIN_LISTINGS
  });
}

export default async function LocalityIntentPage({
  params
}: {
  params: { locale: string; citySlug: string; locality: string; intent: string };
}) {
  return <LocalityIntentView params={params} revalidate={revalidate} />;
}
