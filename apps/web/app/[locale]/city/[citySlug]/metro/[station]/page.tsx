import type { Metadata } from "next";
import { fetchEnabledCities, fetchMetroStation } from "../../../../../../lib/seo-api";
import { buildPageMetadata } from "../../../../../../lib/seo";
import { cityLabel, placeWithCity } from "../../../../../../lib/intent-filters";
import { MetroStationView } from "./station-view";

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
  params: { locale: string; citySlug: string; station: string };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities({ revalidate });
  if (!enabledCities.has(params.citySlug)) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/metro/${params.station}`,
      locale,
      noindex: true
    });
  }
  const data = await fetchMetroStation(params.citySlug, params.station, { revalidate });
  if (!data) {
    return buildPageMetadata({
      title: "Metro station not found",
      description: "Station not available.",
      pathname: `/city/${params.citySlug}/metro/${params.station}`,
      locale,
      noindex: true
    });
  }
  const stationPlace = placeWithCity(
    locale === "hi" ? `${data.station.station_name} मेट्रो` : `${data.station.station_name} Metro`,
    cityLabel(params.citySlug, locale)
  );
  const title = locale === "hi" ? `${stationPlace} के पास किराये` : `Rentals near ${stationPlace}`;
  const desc =
    locale === "hi"
      ? `${data.station.station_name} मेट्रो (${data.station.line_name}) के 1.5 किमी के दायरे में ${data.aggregates.listing_count}+ सत्यापित लिस्टिंग।`
      : `${data.aggregates.listing_count}+ verified rentals within 1.5 km of ${data.station.station_name} on the ${data.station.line_name}.`;
  return buildPageMetadata({
    title,
    description: desc,
    pathname: `/city/${params.citySlug}/metro/${params.station}`,
    locale,
    noindex: data.aggregates.listing_count < 3
  });
}

export default async function MetroHubPage({
  params
}: {
  params: { locale: string; citySlug: string; station: string };
}) {
  return <MetroStationView params={params} revalidate={revalidate} />;
}
