import { notFound } from "next/navigation";
import { ProgrammaticPage, coalesceCopy } from "../../../../../../components/seo/programmatic-page";
import {
  fetchEnabledCities,
  fetchListings,
  fetchMetroStation,
  fetchCityMetroStations
} from "../../../../../../lib/seo-api";
import { buildBreadcrumb, buildPlace } from "../../../../../../lib/structured-data";
import { isValidSlug } from "../../../../../../lib/seo";

/**
 * The metro station hub page's render, extracted out of `page.tsx` so the admin
 * preview route can reuse it. It CANNOT live in page.tsx: Next 14 generates a
 * type constraint restricting a page component's props to `{ params,
 * searchParams }`, so a page cannot accept an `allowUnlisted` flag. And the flag
 * cannot come from `searchParams`, because declaring searchParams forces the
 * route to render per request — the very cost this split removes.
 */

export async function MetroStationView({
  params,
  revalidate,
  allowUnlisted = false
}: {
  params: { locale: string; citySlug: string; station: string };
  /**
   * ISR window to cache this view's fetches for. The public route passes its own
   * `revalidate`; the admin preview route passes nothing, so its fetches run
   * uncached and an admin always reviews the freshest copy.
   */
  revalidate?: number;
  /**
   * Render even when the city is not `programmatic_enabled`. Never set on the
   * public route — that would leak unpublished pages. It exists so the
   * admin-only preview route under `/[locale]/seo-preview/*` can reuse this
   * component: the preview used to be a `?adminPreview=1` query param, but
   * merely declaring `searchParams` forced this route (and all ~33k URLs under
   * it) into per-request rendering, which is what made it the single largest
   * consumer of Vercel Fluid CPU. Props do not affect cacheability; searchParams
   * do.
   */
  allowUnlisted?: boolean;
}) {
  const enabledCities = await fetchEnabledCities({ revalidate });
  if (!enabledCities.has(params.citySlug) && !allowUnlisted) notFound();
  if (!isValidSlug(params.station)) notFound();
  const locale: "en" | "hi" = params.locale === "hi" ? "hi" : "en";

  const data = await fetchMetroStation(params.citySlug, params.station, { revalidate });
  if (!data) notFound();
  const stationName = data.station.station_name;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);

  const [listingsRes, allMetros] = await Promise.all([
    fetchListings(
      {
        city: params.citySlug,
        lat: data.station.lat,
        lng: data.station.lng,
        radius_km: 1.5,
        page_size: 12
      },
      { revalidate }
    ),
    // The city's OWN stations. /map/metro returned whole lines touching the
    // city, so this rail linked to stations the city does not have — phantom
    // URLs that render as soft 404s. Thin stations are intentionally KEPT here:
    // prev/next is line navigation, and dropping them would gap the sequence.
    fetchCityMetroStations(params.citySlug, { revalidate })
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
      href: `/${locale}/city/${params.citySlug}/metro/${s.slug}`,
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
