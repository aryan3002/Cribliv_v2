import { notFound } from "next/navigation";
import { ProgrammaticPage, coalesceCopy } from "../../../../../../components/seo/programmatic-page";
import {
  fetchEnabledCities,
  fetchListings,
  fetchLocality,
  fetchSeoCopy
} from "../../../../../../lib/seo-api";
import {
  buildAggregateOffer,
  buildBreadcrumb,
  buildPlace
} from "../../../../../../lib/structured-data";
import { isValidSlug } from "../../../../../../lib/seo";
import {
  getIntent,
  intentToSearchParams,
  renderIntentH1
} from "../../../../../../lib/intent-filters";

/**
 * The locality-intent page's render, extracted out of `page.tsx` so the admin
 * preview route can reuse it. It CANNOT live in page.tsx: Next 14 generates a
 * type constraint restricting a page component's props to `{ params,
 * searchParams }`, so a page cannot accept an `allowUnlisted` flag. And the flag
 * cannot come from `searchParams`, because declaring searchParams forces the
 * route to render per request — the very cost this split removes.
 */

export async function LocalityIntentView({
  params,
  revalidate,
  allowUnlisted = false
}: {
  params: { locale: string; citySlug: string; locality: string; intent: string };
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
  if (!isValidSlug(params.locality) || !isValidSlug(params.intent)) notFound();
  const locale: "en" | "hi" = params.locale === "hi" ? "hi" : "en";

  const intent = getIntent(params.intent);
  if (!intent || !intent.applies_to.includes("locality")) notFound();

  const data = await fetchLocality(params.citySlug, params.locality, { revalidate });
  if (!data) notFound();

  const placeName = locale === "hi" ? data.locality.name_hi : data.locality.name_en;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);

  const listingsRes = await fetchListings(
    {
      city: params.citySlug,
      locality: data.locality.slug,
      page_size: 24,
      ...intentToSearchParams(intent)
    },
    { revalidate }
  );
  const listings = listingsRes.items;

  const intentLabel = {
    en: intent.label_en,
    hi: intent.label_hi
  };

  const copy = await fetchSeoCopy({
    pagePath: `/city/${params.citySlug}/${params.locality}/${params.intent}`,
    locale,
    placeName: { en: data.locality.name_en, hi: data.locality.name_hi },
    placeKind: "locality",
    intentLabel,
    aggregates: { ...data.aggregates, parent_locality: data.locality.parent_locality_slug },
    revalidate
  });

  const h1 = renderIntentH1(intent, placeName, locale);
  const intro =
    locale === "hi"
      ? `${placeName} में ${intent.label_hi} की ${listingsRes.total} सत्यापित लिस्टिंग। Cribliv पर ब्रोकर के बिना सीधे मालिकों से जुड़ें।`
      : `${listingsRes.total} verified ${intent.label_en.toLowerCase()} in ${placeName}, ${cityName}. Direct owner contact, no broker fees.`;
  const faqDefaults = [
    {
      q:
        locale === "hi"
          ? `${placeName} में ${intent.label_hi} कितने उपलब्ध हैं?`
          : `How many ${intent.label_en.toLowerCase()} are available in ${placeName}?`,
      a:
        locale === "hi"
          ? `${listingsRes.total} सक्रिय लिस्टिंग आज उपलब्ध हैं।`
          : `${listingsRes.total} active listings match this filter today on Cribliv.`
    },
    {
      q:
        locale === "hi"
          ? `${intent.label_hi} में बजट कैसा होता है?`
          : `What's the typical budget for ${intent.label_en.toLowerCase()}?`,
      a:
        locale === "hi"
          ? `बजट लिस्टिंग में अलग-अलग है। सभी कीमतें ग्रिड में दिखाई गई हैं।`
          : `Prices vary listing-to-listing. Sort by rent (low → high) to see the most affordable options first.`
    },
    {
      q: locale === "hi" ? "क्या लिस्टिंग वास्तविक हैं?" : "Are these listings genuine?",
      a:
        locale === "hi"
          ? "हाँ, Cribliv पर हर मालिक की Aadhaar और संपत्ति दस्तावेजों से पहचान सत्यापित की जाती है।"
          : "Yes, every Cribliv owner's identity is verified via Aadhaar and property documents before listing goes live."
    }
  ];
  const merged = coalesceCopy(copy, { h1, intro, faqs: faqDefaults });

  const breadcrumbs = [
    { name: locale === "hi" ? "होम" : "Home", href: `/${locale}` },
    { name: cityName, href: `/${locale}/city/${params.citySlug}` },
    { name: placeName, href: `/${locale}/city/${params.citySlug}/${params.locality}` },
    {
      name: locale === "hi" ? intent.label_hi : intent.label_en,
      href: `/${locale}/city/${params.citySlug}/${params.locality}/${params.intent}`
    }
  ];

  const rents = listings.map((l) => l.monthly_rent).filter((n) => n > 0);
  const jsonLd: object[] = [
    buildBreadcrumb(breadcrumbs.map((bc) => ({ name: bc.name, href: bc.href }))),
    buildPlace({
      name: placeName,
      lat: data.locality.lat,
      lng: data.locality.lng,
      parentAreaName: cityName,
      url: `/${locale}/city/${params.citySlug}/${params.locality}/${params.intent}`
    })
  ];
  if (rents.length > 0) {
    jsonLd.push(
      buildAggregateOffer({
        count: listingsRes.total,
        lowPrice: Math.min(...rents),
        highPrice: Math.max(...rents),
        url: `/${locale}/city/${params.citySlug}/${params.locality}/${params.intent}`
      })
    );
  }

  return (
    <ProgrammaticPage
      locale={locale}
      h1={merged.h1}
      intro={merged.intro}
      nearbyBlurb={merged.nearbyBlurb}
      aggregates={{ ...data.aggregates, listing_count: listingsRes.total }}
      listings={listings}
      viewAllHref={`/${locale}/search?city=${params.citySlug}&locality=${data.locality.slug}&${new URLSearchParams(intentToSearchParams(intent)).toString()}`}
      intentBaseHref={`/${locale}/city/${params.citySlug}/${params.locality}`}
      intentSurface="locality"
      relatedSections={[]}
      faqItems={merged.faqs}
      jsonLd={jsonLd}
      ctaHref={`/${locale}/search?city=${params.citySlug}&locality=${data.locality.slug}&${new URLSearchParams(intentToSearchParams(intent)).toString()}`}
      ctaLabel={
        locale === "hi"
          ? `${placeName} में सभी ${intent.label_hi} देखें`
          : `See all ${intent.label_en.toLowerCase()} in ${placeName}`
      }
      breadcrumbs={breadcrumbs}
    />
  );
}
