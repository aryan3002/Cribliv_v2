import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  ProgrammaticPage,
  coalesceCopy
} from "../../../../../../../components/seo/programmatic-page";
import {
  fetchEnabledCities,
  fetchListings,
  fetchMetroStation
} from "../../../../../../../lib/seo-api";
import {
  buildAggregateOffer,
  buildBreadcrumb,
  buildPlace
} from "../../../../../../../lib/structured-data";
import { buildPageMetadata, isValidSlug } from "../../../../../../../lib/seo";
import {
  cityLabel,
  getIntent,
  type IntentDefinition,
  intentToSearchParams,
  renderIntentH1,
  renderIntentTitle
} from "../../../../../../../lib/intent-filters";
import { INDEXABLE_MIN_LISTINGS } from "@cribliv/shared-types";
import { isAdminPreview } from "../../../../../../../lib/admin-preview";

export const revalidate = 86400;

const RADIUS_KM = 1.5;

/**
 * The one query that defines this page's result set. `generateMetadata` (noindex
 * decision) and the page body (rendered grid) both build from it, so the
 * metadata cannot contradict the content. The station's own unfiltered 1.5 km
 * total is not what this page shows and must not gate indexing.
 */
function intentListingQuery(
  citySlug: string,
  lat: number,
  lng: number,
  intent: IntentDefinition
): Record<string, string | number> {
  return {
    city: citySlug,
    lat,
    lng,
    radius_km: RADIUS_KM,
    ...intentToSearchParams(intent)
  };
}

export async function generateMetadata({
  params,
  searchParams
}: {
  params: { locale: string; citySlug: string; station: string; intent: string };
  searchParams: { adminPreview?: string | string[] };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities();
  if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/metro/${params.station}/${params.intent}`,
      locale,
      noindex: true
    });
  }
  const intent = getIntent(params.intent);
  const data = await fetchMetroStation(params.citySlug, params.station);
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
  // Count with the intent filter applied, not the station's unfiltered radius
  // total — otherwise an empty intent page still claims to be indexable.
  const filtered = await fetchListings({
    ...intentListingQuery(params.citySlug, data.station.lat, data.station.lng, intent),
    page_size: 1
  });
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
  params,
  searchParams
}: {
  params: { locale: string; citySlug: string; station: string; intent: string };
  searchParams: { adminPreview?: string | string[] };
}) {
  const enabledCities = await fetchEnabledCities();
  if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) notFound();
  if (!isValidSlug(params.station) || !isValidSlug(params.intent)) notFound();
  const locale: "en" | "hi" = params.locale === "hi" ? "hi" : "en";

  const intent = getIntent(params.intent);
  if (!intent || !intent.applies_to.includes("metro")) notFound();

  const data = await fetchMetroStation(params.citySlug, params.station);
  if (!data) notFound();

  const stationName = data.station.station_name;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);

  const listingsRes = await fetchListings({
    ...intentListingQuery(params.citySlug, data.station.lat, data.station.lng, intent),
    page_size: 24
  });

  const h1 = renderIntentH1(intent, `${stationName} Metro`, locale);
  const intro =
    locale === "hi"
      ? `${stationName} मेट्रो के 1.5 किमी के दायरे में ${listingsRes.total} ${intent.label_hi} लिस्टिंग।`
      : `${listingsRes.total} ${intent.label_en.toLowerCase()} listings within 1.5 km of ${stationName} Metro.`;
  const merged = coalesceCopy(null, {
    h1,
    intro,
    faqs: [
      {
        q:
          locale === "hi"
            ? `${stationName} के पास ${intent.label_hi} कितने हैं?`
            : `How many ${intent.label_en.toLowerCase()} near ${stationName}?`,
        a:
          locale === "hi"
            ? `${listingsRes.total} सक्रिय लिस्टिंग आज उपलब्ध हैं।`
            : `${listingsRes.total} active listings today.`
      }
    ]
  });

  const breadcrumbs = [
    { name: locale === "hi" ? "होम" : "Home", href: `/${locale}` },
    { name: cityName, href: `/${locale}/city/${params.citySlug}` },
    {
      name: stationName,
      href: `/${locale}/city/${params.citySlug}/metro/${params.station}`
    },
    {
      name: locale === "hi" ? intent.label_hi : intent.label_en,
      href: `/${locale}/city/${params.citySlug}/metro/${params.station}/${params.intent}`
    }
  ];

  const rents = listingsRes.items.map((l) => l.monthly_rent).filter((n) => n > 0);
  const jsonLd: object[] = [
    buildBreadcrumb(breadcrumbs.map((bc) => ({ name: bc.name, href: bc.href }))),
    buildPlace({
      name: `${stationName} Metro`,
      lat: data.station.lat,
      lng: data.station.lng,
      parentAreaName: cityName,
      url: `/${locale}/city/${params.citySlug}/metro/${params.station}/${params.intent}`
    })
  ];
  if (rents.length > 0) {
    jsonLd.push(
      buildAggregateOffer({
        count: listingsRes.total,
        lowPrice: Math.min(...rents),
        highPrice: Math.max(...rents),
        url: `/${locale}/city/${params.citySlug}/metro/${params.station}/${params.intent}`
      })
    );
  }

  return (
    <ProgrammaticPage
      locale={locale}
      h1={merged.h1}
      intro={merged.intro}
      aggregates={{ ...data.aggregates, listing_count: listingsRes.total }}
      listings={listingsRes.items}
      viewAllHref={`/${locale}/search?city=${params.citySlug}&lat=${data.station.lat}&lng=${data.station.lng}&radius_km=1.5&${new URLSearchParams(intentToSearchParams(intent)).toString()}`}
      intentBaseHref={`/${locale}/city/${params.citySlug}/metro/${params.station}`}
      intentSurface="metro"
      relatedSections={[]}
      faqItems={merged.faqs}
      jsonLd={jsonLd}
      ctaHref={`/${locale}/search?city=${params.citySlug}&lat=${data.station.lat}&lng=${data.station.lng}&radius_km=1.5&${new URLSearchParams(intentToSearchParams(intent)).toString()}`}
      ctaLabel={
        locale === "hi"
          ? `${stationName} के पास सभी ${intent.label_hi} देखें`
          : `See all ${intent.label_en.toLowerCase()} near ${stationName}`
      }
      breadcrumbs={breadcrumbs}
    />
  );
}
