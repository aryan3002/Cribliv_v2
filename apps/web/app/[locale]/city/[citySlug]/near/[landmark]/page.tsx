import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProgrammaticPage, coalesceCopy } from "../../../../../../components/seo/programmatic-page";
import {
  fetchEnabledCities,
  fetchLandmark,
  fetchLandmarkListings,
  fetchSeoCopy
} from "../../../../../../lib/seo-api";
import { buildBreadcrumb, buildPlace } from "../../../../../../lib/structured-data";
import { buildPageMetadata, isValidSlug } from "../../../../../../lib/seo";
import { isAdminPreview } from "../../../../../../lib/admin-preview";

export const revalidate = 86400;

const LANDMARK_TYPE_HINT_EN: Record<string, string> = {
  college: "student-friendly housing",
  hospital: "housing for staff and patient families",
  mall: "premium rentals close to shopping & food",
  market: "well-connected, mid-market rentals",
  station: "rentals near the railway / transit hub",
  airport: "long-stay & service-quarter rentals",
  it_park: "working-professional housing",
  office: "rentals within commute distance",
  religious: "family-oriented rentals close by",
  park: "low-density, green-belt rentals",
  stadium: "rentals near the venue",
  monument: "heritage-zone rentals"
};
const LANDMARK_TYPE_HINT_HI: Record<string, string> = {
  college: "छात्रों के लिए उपयुक्त आवास",
  hospital: "स्टाफ और मरीजों के परिवारों के लिए आवास",
  mall: "मॉल के पास प्रीमियम किराये",
  market: "अच्छे कनेक्शन वाले मध्य-बाजार आवास",
  station: "रेलवे / ट्रांज़िट हब के पास किराये",
  airport: "लंबे ठहराव और सर्विस-क्वार्टर किराये",
  it_park: "वर्किंग प्रोफेशनल्स के लिए आवास",
  office: "कम्यूट दूरी पर किराये",
  religious: "पास में परिवार-उन्मुख आवास",
  park: "ग्रीन-बेल्ट किराये",
  stadium: "स्थल के पास किराये",
  monument: "हेरिटेज ज़ोन किराये"
};

export async function generateMetadata({
  params,
  searchParams
}: {
  params: { locale: string; citySlug: string; landmark: string };
  searchParams: { adminPreview?: string | string[] };
}): Promise<Metadata> {
  const locale = params.locale === "hi" ? "hi" : "en";
  const enabledCities = await fetchEnabledCities();
  if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) {
    return buildPageMetadata({
      title: "Not found",
      description: "Page not available.",
      pathname: `/city/${params.citySlug}/near/${params.landmark}`,
      locale,
      noindex: true
    });
  }
  const landmark = await fetchLandmark(params.citySlug, params.landmark);
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
    limit: 24
  });
  const listingCount = bundle?.items.length ?? 0;
  const name = locale === "hi" ? landmark.name_hi : landmark.name_en;
  const title =
    locale === "hi" ? `${name} के पास किराये के घर · Cribliv` : `Rentals near ${name} · Cribliv`;
  return buildPageMetadata({
    title,
    description:
      locale === "hi"
        ? `${name} के 2 किमी के दायरे में सत्यापित PG, फ्लैट और मकान। सीधे मालिक से संपर्क।`
        : `Verified PGs, flats, and houses within 2 km of ${name}. Direct owner contact, zero brokerage.`,
    pathname: `/city/${params.citySlug}/near/${params.landmark}`,
    locale,
    noindex: listingCount < 3
  });
}

export default async function LandmarkHubPage({
  params,
  searchParams
}: {
  params: { locale: string; citySlug: string; landmark: string };
  searchParams: { adminPreview?: string | string[] };
}) {
  const enabledCities = await fetchEnabledCities();
  if (!enabledCities.has(params.citySlug) && !(await isAdminPreview(searchParams))) notFound();
  if (!isValidSlug(params.landmark)) notFound();
  const locale: "en" | "hi" = params.locale === "hi" ? "hi" : "en";

  const [landmark, listingsBundle] = await Promise.all([
    fetchLandmark(params.citySlug, params.landmark),
    fetchLandmarkListings(params.citySlug, params.landmark, { radiusKm: 2, limit: 24 })
  ]);
  if (!landmark) notFound();
  const name = locale === "hi" ? landmark.name_hi : landmark.name_en;
  const cityName = params.citySlug.charAt(0).toUpperCase() + params.citySlug.slice(1);
  const items = listingsBundle?.items ?? [];
  const listingCount = items.length;
  const typeHint =
    (locale === "hi"
      ? LANDMARK_TYPE_HINT_HI[landmark.type]
      : LANDMARK_TYPE_HINT_EN[landmark.type]) ?? "";

  const aggregates = {
    listing_count: listingCount,
    pg_count: items.filter((i) => i.listing_type === "pg").length,
    flat_count: items.filter((i) => i.listing_type === "flat_house").length,
    median_rent_pg: null,
    median_rent_1bhk: null,
    median_rent_2bhk: null,
    median_rent_3bhk: null
  };

  // AI copy keyed off the landmark + nearby aggregates
  const copy = await fetchSeoCopy({
    pagePath: `/city/${params.citySlug}/near/${params.landmark}`,
    locale,
    placeName: { en: landmark.name_en, hi: landmark.name_hi },
    placeKind: "landmark",
    aggregates: { ...aggregates, parent_locality: landmark.primary_locality_slug }
  });

  const defaults = {
    h1: locale === "hi" ? `${name} के पास किराये के घर` : `Rentals near ${name}`,
    intro:
      locale === "hi"
        ? `${name} के 2 किमी के दायरे में ${listingCount} सक्रिय लिस्टिंग। ${typeHint}.`
        : `${listingCount} active rentals within 2 km of ${name}. Ideal for ${typeHint}.`,
    faqs: [
      {
        q:
          locale === "hi"
            ? `${name} के पास कौन से इलाके आते हैं?`
            : `Which areas are close to ${name}?`,
        a: landmark.primary_locality_name_en
          ? locale === "hi"
            ? `${name} ${landmark.primary_locality_name_en} में स्थित है।`
            : `${name} is located in ${landmark.primary_locality_name_en}.`
          : locale === "hi"
            ? "नजदीकी इलाकों की जानकारी ऊपर लिस्ट में देखें।"
            : "See the listings grid above for the surrounding areas covered."
      },
      {
        q:
          locale === "hi"
            ? `क्या यहाँ बजट PG उपलब्ध हैं?`
            : `Are there budget options near ${name}?`,
        a:
          locale === "hi"
            ? "हाँ, किराये के अनुसार छाँटने के लिए नीचे लिस्टिंग को सॉर्ट करें।"
            : "Yes, sort the listings by rent (low → high) to surface the most affordable PGs and rooms."
      }
    ]
  };
  const merged = coalesceCopy(copy, defaults);

  const breadcrumbs = [
    { name: locale === "hi" ? "होम" : "Home", href: `/${locale}` },
    { name: cityName, href: `/${locale}/city/${params.citySlug}` },
    {
      name: locale === "hi" ? "नजदीकी" : "Near",
      href: `/${locale}/city/${params.citySlug}`
    },
    {
      name,
      href: `/${locale}/city/${params.citySlug}/near/${params.landmark}`
    }
  ];

  const jsonLd: object[] = [
    buildBreadcrumb(breadcrumbs.map((bc) => ({ name: bc.name, href: bc.href }))),
    buildPlace({
      name,
      lat: landmark.lat,
      lng: landmark.lng,
      parentAreaName: cityName,
      url: `/${locale}/city/${params.citySlug}/near/${params.landmark}`
    })
  ];

  return (
    <ProgrammaticPage
      locale={locale}
      h1={merged.h1}
      intro={merged.intro}
      nearbyBlurb={merged.nearbyBlurb}
      aggregates={aggregates}
      listings={items.map((i) => ({
        id: String(i.id),
        title: String(i.title ?? "Listing"),
        city: String(i.city ?? params.citySlug),
        locality: (i.locality as string | null) ?? null,
        listing_type: i.listing_type as "flat_house" | "pg",
        monthly_rent: Number(i.monthly_rent ?? 0),
        bhk: (i.bhk as number | null) ?? null,
        furnishing: (i.furnishing as string | null) ?? null,
        area_sqft: (i.area_sqft as number | null) ?? null,
        verification_status: i.verification_status as
          | "unverified"
          | "pending"
          | "verified"
          | "failed",
        cover_photo: (i.cover_photo as string | null) ?? null
      }))}
      viewAllHref={`/${locale}/search?city=${params.citySlug}&lat=${landmark.lat}&lng=${landmark.lng}&radius_km=2`}
      intentBaseHref={`/${locale}/city/${params.citySlug}/near/${params.landmark}`}
      intentSurface="landmark"
      relatedSections={
        landmark.primary_locality_slug
          ? [
              {
                title: locale === "hi" ? "मुख्य इलाका" : "Primary locality",
                items: [
                  {
                    href: `/${locale}/city/${params.citySlug}/${landmark.primary_locality_slug}`,
                    label: landmark.primary_locality_name_en ?? landmark.primary_locality_slug,
                    sublabel: locale === "hi" ? "लोकालिटी हब" : "Locality hub"
                  }
                ]
              }
            ]
          : []
      }
      faqItems={merged.faqs}
      jsonLd={jsonLd}
      ctaHref={`/${locale}/search?city=${params.citySlug}&lat=${landmark.lat}&lng=${landmark.lng}&radius_km=2`}
      ctaLabel={locale === "hi" ? `${name} के पास सभी देखें` : `See all rentals near ${name}`}
      breadcrumbs={breadcrumbs}
    />
  );
}
