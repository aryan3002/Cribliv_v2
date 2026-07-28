import type { Metadata } from "next";
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import {
  fetchEnabledCities,
  fetchListings,
  fetchMetroStation
} from "../../../../../../../lib/seo-api";
import { buildPageMetadata } from "../../../../../../../lib/seo";
import { cityLabel, getIntent, renderIntentTitle } from "../../../../../../../lib/intent-filters";
import { MetroStationIntentView, stationIntentQuery } from "./station-intent-view";

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
  params: { locale: string; citySlug: string; station: string; intent: string };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities({ revalidate });
  if (!enabledCities.has(params.citySlug)) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/metro/${params.station}/${params.intent}`,
      locale,
      noindex: true
    });
  }
  const intent = getIntent(params.intent);
  const data = await fetchMetroStation(params.citySlug, params.station, { revalidate });
  if (!intent || !data || !intent.applies_to.includes("metro")) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/metro/${params.station}/${params.intent}`,
      locale,
      noindex: true
    });
  }
  const city = cityLabel(params.citySlug, locale);
  // Count with the intent filter applied. The station's own 1.5 km total is not
  // the number this page shows, so it must not be the number that gates
  // indexing. `revalidate` keeps this ISR-cached.
  const filtered = await fetchListings(
    {
      ...stationIntentQuery(params.citySlug, data.station.lat, data.station.lng, intent),
      page_size: 1
    },
    { revalidate }
  );
  return buildPageMetadata({
    title: renderIntentTitle(
      intent,
      { name: `${data.station.station_name} Metro`, kind: "metro", city },
      locale
    ),
    description:
      locale === "hi"
        ? `${data.station.station_name} मेट्रो, ${city} के पास ${intent.label_hi}, Cribliv पर सत्यापित लिस्टिंग।`
        : `Verified ${intent.label_en.toLowerCase()} near ${data.station.station_name} Metro, ${city}. Zero brokerage.`,
    pathname: `/city/${params.citySlug}/metro/${params.station}/${params.intent}`,
    locale,
    noindex: filtered.total < INDEXABLE_MIN_LISTINGS
  });
}

export default async function MetroIntentPage({
  params
}: {
  params: { locale: string; citySlug: string; station: string; intent: string };
}) {
  return <MetroStationIntentView params={params} revalidate={revalidate} />;
}
