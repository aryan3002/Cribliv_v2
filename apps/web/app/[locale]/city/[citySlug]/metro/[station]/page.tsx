import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgrammaticPage, coalesceCopy } from "../../../../../../components/seo/programmatic-page";
import {
  fetchEnabledCities,
  fetchListings,
  fetchMetroStation,
  fetchMetroStationsForCity
} from "../../../../../../lib/seo-api";
import { buildBreadcrumb, buildPlace } from "../../../../../../lib/structured-data";
import { buildPageMetadata, isValidSlug } from "../../../../../../lib/seo";
import { isAdminPreview } from "../../../../../../lib/admin-preview";

export const revalidate = 86400;

export async function generateMetadata({
  params,
  searchParams
}: {
  params: { locale: string; citySlug: string; station: string };
  searchParams: { adminPreview?: string | string[] };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities();
  if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/metro/${params.station}`,
      locale,
      noindex: true
    });
  }
  const data = await fetchMetroStation(params.citySlug, params.station);
  if (!data) {
    return buildPageMetadata({
      title: "Metro station not found",
      description: "Station not available.",
      pathname: `/city/${params.citySlug}/metro/${params.station}`,
      locale,
      noindex: true
    });
  }
  const title =
    locale === "hi"
      ? `${data.station.station_name} मेट्रो के पास किराये · Cribliv`
      : `Rentals near ${data.station.station_name} Metro · Cribliv`;
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
  params,
  searchParams
}: {
  params: { locale: string; citySlug: string; station: string };
  searchParams: { adminPreview?: string | string[] };
}) {
  const enabledCities = await fetchEnabledCities();
  if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) notFound();
  if (!isValidSlug(params.station)) notFound();
  const locale: "en" | "hi" = params.locale === "hi" ? "hi" : "en";

  const data = await fetchMetroStation(params.citySlug, params.station);
  if (!data) notFound();
  const stationName = data.station.station_name;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);

  const [listingsRes, allMetros] = await Promise.all([
    fetchListings({
      city: params.citySlug,
      lat: data.station.lat,
      lng: data.station.lng,
      radius_km: 1.5,
      page_size: 12
    }),
    fetchMetroStationsForCity(params.citySlug)
  ]);

  // Find prev/next on same line
  const sameLine = allMetros
    .filter((s) => s.line_name === data.station.line_name)
    .sort((a, b) => a.sequence - b.sequence);
  const idx = sameLine.findIndex((s) => s.station_name === stationName);
  const sameLineLinks = sameLine
    .filter((s) => s.station_name && s.station_name !== stationName)
    .slice(Math.max(0, idx - 3), idx + 4)
    .map((s) => ({
      href: `/${locale}/city/${params.citySlug}/metro/${s.station_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      label: s.station_name,
      sublabel: s.line_name
    }));

  const defaults = {
    h1:
      locale === "hi"
        ? `${stationName} मेट्रो के पास किराये के घर`
        : `Rentals near ${stationName} Metro`,
    intro:
      locale === "hi"
        ? `${stationName} मेट्रो स्टेशन (${data.station.line_name}) के पैदल दायरे में ${data.aggregates.listing_count} सक्रिय लिस्टिंग। मेट्रो की आसान कनेक्टिविटी के साथ रहें।`
        : `${data.aggregates.listing_count} active rentals within walking distance of ${stationName} on the ${data.station.line_name}. Live close to the metro and skip the daily commute.`,
    faqs: [
      {
        q:
          locale === "hi"
            ? `${stationName} मेट्रो के पास PG कितने में मिलता है?`
            : `What does a PG near ${stationName} cost?`,
        a: data.aggregates.median_rent_pg
          ? locale === "hi"
            ? `${stationName} के पास PG का औसत मासिक किराया लगभग ₹${data.aggregates.median_rent_pg.toLocaleString("en-IN")} है।`
            : `Median PG rent near ${stationName} is around ₹${data.aggregates.median_rent_pg.toLocaleString("en-IN")}/month.`
          : locale === "hi"
            ? `इस स्टेशन के पास अभी PG डेटा सीमित है।`
            : `PG data near this station is still being aggregated.`
      },
      {
        q:
          locale === "hi"
            ? `${stationName} किस लाइन पर है?`
            : `Which metro line is ${stationName} on?`,
        a:
          locale === "hi"
            ? `${stationName}, ${data.station.line_name} पर स्थित है।`
            : `${stationName} is on the ${data.station.line_name}.`
      }
    ]
  };
  const merged = coalesceCopy(null, defaults);

  const breadcrumbs = [
    { name: locale === "hi" ? "होम" : "Home", href: `/${locale}` },
    { name: cityName, href: `/${locale}/city/${params.citySlug}` },
    {
      name: locale === "hi" ? "मेट्रो" : "Metro",
      href: `/${locale}/city/${params.citySlug}`
    },
    {
      name: stationName,
      href: `/${locale}/city/${params.citySlug}/metro/${params.station}`
    }
  ];

  const jsonLd: object[] = [
    buildBreadcrumb(breadcrumbs.map((bc) => ({ name: bc.name, href: bc.href }))),
    buildPlace({
      name: `${stationName} Metro`,
      lat: data.station.lat,
      lng: data.station.lng,
      parentAreaName: cityName,
      url: `/${locale}/city/${params.citySlug}/metro/${params.station}`
    })
  ];

  return (
    <ProgrammaticPage
      locale={locale}
      h1={merged.h1}
      placeName={stationName}
      intro={merged.intro}
      aggregates={data.aggregates}
      listings={listingsRes.items}
      viewAllHref={`/${locale}/search?city=${params.citySlug}&lat=${data.station.lat}&lng=${data.station.lng}&radius_km=1.5`}
      intentBaseHref={`/${locale}/city/${params.citySlug}/metro/${params.station}`}
      intentSurface="metro"
      relatedSections={[
        {
          title: locale === "hi" ? "इसी लाइन पर अन्य स्टेशन" : "Other stations on this line",
          items: sameLineLinks,
          emptyHint: locale === "hi" ? "इस लाइन पर डेटा सीमित।" : "Line data limited."
        }
      ]}
      faqItems={merged.faqs}
      jsonLd={jsonLd}
      ctaHref={`/${locale}/search?city=${params.citySlug}&lat=${data.station.lat}&lng=${data.station.lng}&radius_km=1.5`}
      ctaLabel={
        locale === "hi" ? `${stationName} के पास सभी देखें` : `See all rentals near ${stationName}`
      }
      breadcrumbs={breadcrumbs}
    />
  );
}
