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
import { isValidSlug } from "../../../../../lib/seo";
import {
  buildLocalityTemplateCopy,
  nearestMetroForLocality
} from "../../../../../lib/seo-template-copy";

/**
 * The locality hub page's render, extracted out of `page.tsx` so the admin
 * preview route can reuse it. It CANNOT live in page.tsx: Next 14 generates a
 * type constraint restricting a page component's props to `{ params,
 * searchParams }`, so a page cannot accept an `allowUnlisted` flag. And the flag
 * cannot come from `searchParams`, because declaring searchParams forces the
 * route to render per request — the very cost this split removes.
 */

export async function LocalityHubView({
  params,
  revalidate,
  allowUnlisted = false
}: {
  params: { locale: string; citySlug: string; locality: string };
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
  if (!isValidSlug(params.locality)) notFound();
  const locale: "en" | "hi" = params.locale === "hi" ? "hi" : "en";

  const data = await fetchLocality(params.citySlug, params.locality, { revalidate });
  if (!data) notFound();
  const placeName = locale === "hi" ? data.locality.name_hi : data.locality.name_en;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);

  const [listings, siblingLocalities, landmarks, metros] = await Promise.all([
    fetchListings(
      {
        city: params.citySlug,
        locality: data.locality.slug,
        page_size: 12
      },
      { revalidate }
    ),
    fetchLocalities(params.citySlug, { revalidate }),
    fetchLandmarks(params.citySlug, undefined, { revalidate }),
    fetchMetroStationsForCity(params.citySlug, { revalidate })
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
    },
    revalidate
  });

  const templateCopy = buildLocalityTemplateCopy({
    locale,
    placeName: { en: data.locality.name_en, hi: data.locality.name_hi },
    cityName,
    aggregates: data.aggregates,
    nearestMetro: nearestMetroForLocality(nearbyMetros, here.lat, here.lng)
  });
  const defaults = {
    h1: templateCopy.h1,
    intro: templateCopy.intro_paragraph,
    faqs: templateCopy.faq_items,
    nearbyBlurb: templateCopy.nearby_blurb || null
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
