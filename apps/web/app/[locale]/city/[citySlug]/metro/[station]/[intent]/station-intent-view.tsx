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
import { isValidSlug } from "../../../../../../../lib/seo";
import {
  getIntent,
  intentToSearchParams,
  renderIntentH1
} from "../../../../../../../lib/intent-filters";

/**
 * The metro-intent page's render, extracted out of `page.tsx` so the admin
 * preview route can reuse it. It CANNOT live in page.tsx: Next 14 generates a
 * type constraint restricting a page component's props to `{ params,
 * searchParams }`, so a page cannot accept an `allowUnlisted` flag. And the flag
 * cannot come from `searchParams`, because declaring searchParams forces the
 * route to render per request — the very cost this split removes.
 */

export async function MetroStationIntentView({
  params,
  revalidate,
  allowUnlisted = false
}: {
  params: { locale: string; citySlug: string; station: string; intent: string };
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
  if (!isValidSlug(params.station) || !isValidSlug(params.intent)) notFound();
  const locale: "en" | "hi" = params.locale === "hi" ? "hi" : "en";

  const intent = getIntent(params.intent);
  if (!intent || !intent.applies_to.includes("metro")) notFound();

  const data = await fetchMetroStation(params.citySlug, params.station, { revalidate });
  if (!data) notFound();

  const stationName = data.station.station_name;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);

  const listingsRes = await fetchListings(
    {
      city: params.citySlug,
      lat: data.station.lat,
      lng: data.station.lng,
      radius_km: 1.5,
      page_size: 24,
      ...intentToSearchParams(intent)
    },
    { revalidate }
  );

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
