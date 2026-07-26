import type { Metadata } from "next";
import { fetchEnabledCities, fetchLandmark, fetchListings } from "../../../../../../../lib/seo-api";
import { buildPageMetadata } from "../../../../../../../lib/seo";
import { cityLabel, getIntent, renderIntentTitle } from "../../../../../../../lib/intent-filters";
import { LandmarkIntentView } from "./landmark-intent-view";

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
  params: { locale: string; citySlug: string; landmark: string; intent: string };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities({ revalidate });
  if (!enabledCities.has(params.citySlug)) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/near/${params.landmark}/${params.intent}`,
      locale,
      noindex: true
    });
  }
  const intent = getIntent(params.intent);
  const landmark = await fetchLandmark(params.citySlug, params.landmark, { revalidate });
  if (!intent || !landmark || !intent.applies_to.includes("landmark")) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/near/${params.landmark}/${params.intent}`,
      locale,
      noindex: true
    });
  }
  const parentCount = await fetchListings(
    {
      city: params.citySlug,
      lat: landmark.lat,
      lng: landmark.lng,
      radius_km: 2,
      page_size: 1
    },
    { revalidate }
  );
  const name = locale === "hi" ? landmark.name_hi : landmark.name_en;
  const city = cityLabel(params.citySlug, locale);
  return buildPageMetadata({
    title: renderIntentTitle(intent, { name, kind: "landmark", city }, locale),
    description:
      locale === "hi"
        ? `${name}, ${city} के पास ${intent.label_hi}, Cribliv पर सत्यापित लिस्टिंग।`
        : `${intent.label_en} near ${name}, ${city}. Verified listings, direct owner contact, no broker fees.`,
    pathname: `/city/${params.citySlug}/near/${params.landmark}/${params.intent}`,
    locale,
    noindex: parentCount.total < 3
  });
}

export default async function LandmarkIntentPage({
  params
}: {
  params: { locale: string; citySlug: string; landmark: string; intent: string };
}) {
  return <LandmarkIntentView params={params} revalidate={revalidate} />;
}
