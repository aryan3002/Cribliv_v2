import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgrammaticPage, coalesceCopy } from "../../../../../components/seo/programmatic-page";
import {
  fetchEnabledCities,
  fetchLandmarks,
  fetchListings,
  fetchLocalities,
  fetchLocality,
  fetchMetroStationsForCity,
  fetchSeoCopy
} from "../../../../../lib/seo-api";
import { buildBreadcrumb, buildPlace } from "../../../../../lib/structured-data";
import { buildPageMetadata, isValidSlug } from "../../../../../lib/seo";
import { isAdminPreview } from "../../../../../lib/admin-preview";

// ISR: revalidate every 24h. On-demand revalidation triggered when listings change.
export const revalidate = 86400;

export async function generateMetadata({
  params,
  searchParams
}: {
  params: { locale: string; citySlug: string; locality: string };
  searchParams: { adminPreview?: string | string[] };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities();
  if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) {
    return buildPageMetadata({
      title: "Not found",
      description: "This page is not available.",
      pathname: `/city/${params.citySlug}/${params.locality}`,
      locale,
      noindex: true
    });
  }
  const data = await fetchLocality(params.citySlug, params.locality);
  if (!data) {
    return buildPageMetadata({
      title: "Locality not found",
      description: "This locality is not available on Cribliv.",
      pathname: `/city/${params.citySlug}/${params.locality}`,
      locale,
      noindex: true
    });
  }
  const placeName = locale === "hi" ? data.locality.name_hi : data.locality.name_en;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);
  const title =
    locale === "hi"
      ? `${cityName} के ${placeName} में किराये · Cribliv`
      : `Rentals in ${placeName}, ${cityName} · Cribliv`;
  const desc =
    locale === "hi"
      ? `${placeName}, ${cityName} में ${data.aggregates.listing_count}+ सत्यापित PG और फ्लैट। मासिक किराये और लोकप्रिय इलाके।`
      : `${data.aggregates.listing_count}+ verified PGs and flats in ${placeName}, ${cityName}. Median rents, nearby metros, and direct-owner contact.`;
  return buildPageMetadata({
    title,
    description: desc,
    pathname: `/city/${params.citySlug}/${params.locality}`,
    locale,
    noindex: data.aggregates.listing_count < 3
  });
}

export default async function LocalityHubPage({
  params,
  searchParams
}: {
  params: { locale: string; citySlug: string; locality: string };
  searchParams: { adminPreview?: string | string[] };
}) {
  const enabledCities = await fetchEnabledCities();
  if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) notFound();
  if (!isValidSlug(params.locality)) notFound();
  const locale: "en" | "hi" = params.locale === "hi" ? "hi" : "en";

  const data = await fetchLocality(params.citySlug, params.locality);
  if (!data) notFound();
  const placeName = locale === "hi" ? data.locality.name_hi : data.locality.name_en;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);

  const [listings, siblingLocalities, landmarks, metros] = await Promise.all([
    fetchListings({
      city: params.citySlug,
      locality: data.locality.slug,
      page_size: 12
    }),
    fetchLocalities(params.citySlug),
    fetchLandmarks(params.citySlug),
    fetchMetroStationsForCity(params.citySlug)
  ]);

  // Compute simple distance ordering for related items (cheap, server-side).
  const haversine = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371;
    const toRad = (n: number) => (n * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const here = { lat: data.locality.lat ?? 0, lng: data.locality.lng ?? 0 };
  const nearbyMetros = (metros || [])
    .filter((m) => m.station_name)
    .map((m) => ({ ...m, dist: haversine(here.lat, here.lng, m.lat, m.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 5);
  const nearbyLandmarks = (landmarks || [])
    .map((l) => ({ ...l, dist: haversine(here.lat, here.lng, l.lat, l.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 6);
  const nearbyLocalities = (siblingLocalities || [])
    .filter((l) => l.slug !== data.locality.slug && l.lat != null && l.lng != null)
    .map((l) => ({ ...l, dist: haversine(here.lat, here.lng, l.lat ?? 0, l.lng ?? 0) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 6);

  // AI copy (best effort)
  const copy = await fetchSeoCopy({
    pagePath: `/city/${params.citySlug}/${params.locality}`,
    locale,
    placeName: { en: data.locality.name_en, hi: data.locality.name_hi },
    placeKind: "locality",
    aggregates: {
      ...data.aggregates,
      nearest_metro: nearbyMetros[0]
        ? {
            name: nearbyMetros[0].station_name,
            walk_minutes: Math.round(nearbyMetros[0].dist * 12)
          }
        : null,
      parent_locality: data.locality.parent_locality_slug
    }
  });

  const defaults = {
    h1:
      locale === "hi"
        ? `${placeName} में किराये के लिए घर`
        : `Verified Rentals in ${placeName}, ${cityName}`,
    intro:
      locale === "hi"
        ? `${cityName} के ${placeName} में Cribliv पर ${data.aggregates.listing_count} सत्यापित किराये — PG, 1/2/3 BHK फ्लैट और स्वतंत्र मकान।${data.aggregates.median_rent_1bhk ? ` यहाँ 1BHK का किराया लगभग ₹${data.aggregates.median_rent_1bhk.toLocaleString("en-IN")}/माह${data.aggregates.median_rent_2bhk ? `, 2BHK लगभग ₹${data.aggregates.median_rent_2bhk.toLocaleString("en-IN")}/माह` : ""} है।` : ""} हर मालिक सत्यापित है, कोई ब्रोकरेज नहीं।`
        : `${placeName} in ${cityName} has ${data.aggregates.listing_count} verified ${data.aggregates.listing_count === 1 ? "rental" : "rentals"} on Cribliv — PGs, 1/2/3 BHK flats and independent houses.${data.aggregates.median_rent_1bhk ? ` 1BHK homes here rent for around ₹${data.aggregates.median_rent_1bhk.toLocaleString("en-IN")}/mo${data.aggregates.median_rent_2bhk ? `, 2BHKs around ₹${data.aggregates.median_rent_2bhk.toLocaleString("en-IN")}/mo` : ""}.` : ""} Every owner is verified and you pay zero brokerage.`,
    faqs: [
      {
        q:
          locale === "hi"
            ? `${placeName} में 1BHK फ्लैट का औसत किराया क्या है?`
            : `What's the average rent for a 1BHK in ${placeName}?`,
        a: data.aggregates.median_rent_1bhk
          ? locale === "hi"
            ? `${placeName} में 1BHK फ्लैट का औसत मासिक किराया लगभग ₹${data.aggregates.median_rent_1bhk.toLocaleString("en-IN")} है।`
            : `The median rent for a 1BHK in ${placeName} is around ₹${data.aggregates.median_rent_1bhk.toLocaleString("en-IN")} per month.`
          : locale === "hi"
            ? `${placeName} में अभी 1BHK डेटा उपलब्ध नहीं है।`
            : `Not enough 1BHK data for ${placeName} yet. Check the listings tab.`
      },
      {
        q:
          locale === "hi"
            ? `${placeName} में PG किस बजट से शुरू होते हैं?`
            : `What do PGs in ${placeName} cost?`,
        a: data.aggregates.median_rent_pg
          ? locale === "hi"
            ? `${placeName} में PG का औसत मासिक किराया लगभग ₹${data.aggregates.median_rent_pg.toLocaleString("en-IN")} है।`
            : `The median PG rent in ${placeName} is around ₹${data.aggregates.median_rent_pg.toLocaleString("en-IN")} per month, with budget options often available from ₹3,500.`
          : locale === "hi"
            ? `${placeName} में अभी PG डेटा सीमित है।`
            : `PG data for ${placeName} is still being aggregated.`
      },
      {
        q:
          locale === "hi"
            ? `${placeName} के पास सबसे नजदीकी मेट्रो स्टेशन कौन सा है?`
            : `What's the nearest metro station to ${placeName}?`,
        a: nearbyMetros[0]
          ? locale === "hi"
            ? `सबसे नजदीकी मेट्रो ${nearbyMetros[0].station_name} है (${nearbyMetros[0].line_name}), लगभग ${nearbyMetros[0].dist.toFixed(1)} किमी की दूरी पर।`
            : `The nearest metro is ${nearbyMetros[0].station_name} on the ${nearbyMetros[0].line_name}, about ${nearbyMetros[0].dist.toFixed(1)} km away.`
          : locale === "hi"
            ? `${placeName} के पास अभी कोई मेट्रो डेटा उपलब्ध नहीं है।`
            : `No metro data within range of ${placeName} yet.`
      },
      {
        q: locale === "hi" ? "क्या ब्रोकर फीस है?" : "Are there any broker fees?",
        a:
          locale === "hi"
            ? `नहीं। Cribliv पर सभी लिस्टिंग सीधे मालिक की होती हैं, कोई ब्रोकरेज नहीं।`
            : `No, every Cribliv listing connects you directly to a verified owner with zero brokerage.`
      }
    ]
  };
  const merged = coalesceCopy(copy, defaults);

  const breadcrumbs = [
    { name: locale === "hi" ? "होम" : "Home", href: `/${locale}` },
    { name: cityName, href: `/${locale}/city/${params.citySlug}` },
    { name: placeName, href: `/${locale}/city/${params.citySlug}/${params.locality}` }
  ];

  const jsonLd: object[] = [
    buildBreadcrumb(breadcrumbs.map((bc) => ({ name: bc.name, href: bc.href }))),
    buildPlace({
      name: placeName,
      description: merged.intro,
      lat: data.locality.lat,
      lng: data.locality.lng,
      parentAreaName: cityName,
      url: `/${locale}/city/${params.citySlug}/${params.locality}`
    })
  ];

  return (
    <ProgrammaticPage
      locale={locale}
      h1={merged.h1}
      intro={merged.intro}
      placeName={placeName}
      nearbyBlurb={merged.nearbyBlurb}
      aggregates={data.aggregates}
      listings={listings.items}
      viewAllHref={`/${locale}/search?city=${params.citySlug}&locality=${data.locality.slug}`}
      intentBaseHref={`/${locale}/city/${params.citySlug}/${params.locality}`}
      intentSurface="locality"
      relatedSections={[
        {
          title: locale === "hi" ? "नजदीकी मेट्रो स्टेशन" : "Nearby metro stations",
          items: nearbyMetros.map((m) => ({
            href: `/${locale}/city/${params.citySlug}/metro/${m.station_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
            label: m.station_name,
            sublabel: `${m.line_name} • ${m.dist.toFixed(1)} km`
          })),
          emptyHint: locale === "hi" ? "अभी कोई मेट्रो डेटा नहीं।" : "No metro data yet."
        },
        {
          title: locale === "hi" ? "नजदीकी जगहें" : "Nearby landmarks",
          items: nearbyLandmarks.map((l) => ({
            href: `/${locale}/city/${params.citySlug}/near/${l.slug}`,
            label: locale === "hi" ? l.name_hi : l.name_en,
            sublabel: `${l.dist.toFixed(1)} km`
          }))
        },
        {
          title: locale === "hi" ? "अन्य इलाके" : "Other localities nearby",
          items: nearbyLocalities.map((l) => ({
            href: `/${locale}/city/${params.citySlug}/${l.slug}`,
            label: locale === "hi" ? l.name_hi : l.name_en,
            sublabel: `${l.dist.toFixed(1)} km`
          }))
        }
      ]}
      faqItems={merged.faqs}
      jsonLd={jsonLd}
      ctaHref={`/${locale}/search?city=${params.citySlug}&locality=${data.locality.slug}`}
      ctaLabel={
        locale === "hi" ? `${placeName} में सभी लिस्टिंग देखें` : `See all rentals in ${placeName}`
      }
      breadcrumbs={breadcrumbs}
    />
  );
}
