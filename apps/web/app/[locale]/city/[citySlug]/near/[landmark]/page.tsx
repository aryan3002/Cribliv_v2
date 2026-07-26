import type { Metadata } from "next";
import {
  fetchEnabledCities,
  fetchLandmark,
  fetchLandmarkListings
} from "../../../../../../lib/seo-api";
import { buildPageMetadata } from "../../../../../../lib/seo";
import { cityLabel, placeWithCity } from "../../../../../../lib/intent-filters";
import { LandmarkHubView } from "./landmark-view";

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
  params: { locale: string; citySlug: string; landmark: string };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities({ revalidate });
  if (!enabledCities.has(params.citySlug)) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/near/${params.landmark}`,
      locale,
      noindex: true
    });
  }
  const landmark = await fetchLandmark(params.citySlug, params.landmark, { revalidate });
  if (!landmark) {
    return buildPageMetadata({
      title: "Landmark not found",
      description: "This landmark page is not available.",
      pathname: `/city/${params.citySlug}/near/${params.landmark}`,
      locale,
      noindex: true
    });
  }
  const bundle = await fetchLandmarkListings(params.citySlug, params.landmark, {
    radiusKm: 2,
    limit: 24,
    revalidate
  });
  const listingCount = bundle?.items.length ?? 0;
  const name = locale === "hi" ? landmark.name_hi : landmark.name_en;
  const place = placeWithCity(name, cityLabel(params.citySlug, locale));
  const title = locale === "hi" ? `${place} के पास किराये के घर` : `Rentals near ${place}`;
  return buildPageMetadata({
    title,
    description:
      locale === "hi"
        ? `${place} के 2 किमी के दायरे में सत्यापित PG, फ्लैट और मकान। सीधे मालिक से संपर्क।`
        : `Verified PGs, flats, and houses within 2 km of ${place}. Direct owner contact, zero brokerage.`,
    pathname: `/city/${params.citySlug}/near/${params.landmark}`,
    locale,
    noindex: listingCount < 3
  });
}

export default async function LandmarkHubPage({
  params
}: {
  params: { locale: string; citySlug: string; landmark: string };
}) {
  return <LandmarkHubView params={params} revalidate={revalidate} />;
}
