import type { Metadata, Route } from "next";
import dynamic from "next/dynamic";
import { t, type Locale } from "../../lib/i18n";
import { fetchApi } from "../../lib/api";
import Link from "next/link";
import {
  ShieldCheck,
  Clock,
  BadgeIndianRupee,
  Search,
  CheckCircle2,
  KeyRound,
  Building2,
  Landmark,
  Building,
  Home,
  MapPin,
  TreePine,
  Castle,
  Star,
  Sunrise,
  Sofa,
  ArrowRight,
  Sparkles,
  Mic,
  TrendingUp
} from "lucide-react";
import { ListingCarousel } from "../../components/listing-carousel";
import { ListingCardItem, type ListingCardData } from "../../components/listing-card";
import { ListeningHomePage } from "./listening-home";

/* City photos: Unsplash free license — unsplash.com/license */

const SearchHero = dynamic(
  () => import("../../components/search-hero").then((mod) => mod.SearchHero),
  {
    loading: () => (
      <div
        style={{
          height: 56,
          borderRadius: "var(--radius-full)",
          background: "rgba(255,255,255,0.1)",
          border: "1px solid rgba(255,255,255,0.15)"
        }}
      />
    ),
    ssr: false
  }
);

// SSR-render these so the layout reserves their space at first paint.
// Disabling SSR caused the CTA banner to shift down by hundreds of pixels
// on hydration (CLS 0.438 in Lighthouse).
const AnimateOnScroll = dynamic(
  () => import("../../components/scroll-animations").then((mod) => mod.AnimateOnScroll),
  { ssr: false }
);

const CountUp = dynamic(
  () => import("../../components/scroll-animations").then((mod) => mod.CountUp),
  { ssr: false }
);

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: Locale };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi ? "तेज, भरोसेमंद घर खोज" : "Fast, Trustworthy Home Search in North India";
  const description = isHindi
    ? "AI-संचालित किराये की खोज, लाइव लिस्टिंग, फोटो, किराया, लोकेलिटी और वेरिफिकेशन संकेतों के साथ।"
    : "AI-powered rental search with live listings, photos, rent, locality, and verification signals across North India.";

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en`,
      languages: { en: `${BASE_URL}/en`, hi: `${BASE_URL}/hi` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}`,
      siteName: "Cribliv",
      locale: params.locale === "hi" ? "hi_IN" : "en_IN",
      type: "website"
    },
    twitter: {
      card: "summary_large_image",
      title,
      description
    }
  };
}

const CITIES = [
  {
    name: "Lucknow",
    photo: "lucknow",
    icon: Landmark,
    gradient: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)"
  },
  {
    name: "Delhi",
    photo: "delhi",
    icon: Landmark,
    gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)"
  },
  {
    name: "Gurugram",
    photo: "gurugram",
    icon: Building2,
    gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
  },
  {
    name: "Noida",
    photo: "noida",
    icon: Building,
    gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)"
  },
  {
    name: "Ghaziabad",
    photo: "ghaziabad",
    icon: Home,
    gradient: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)"
  },
  {
    name: "Faridabad",
    photo: "faridabad",
    icon: MapPin,
    gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)"
  },
  {
    name: "Chandigarh",
    photo: "chandigarh",
    icon: TreePine,
    gradient: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)"
  },
  {
    name: "Jaipur",
    photo: "jaipur",
    icon: Castle,
    gradient: "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)"
  },
  {
    name: "Varanasi",
    photo: "varanasi",
    icon: Sunrise,
    gradient: "linear-gradient(135deg, #dfe6ee 0%, #c6d1de 100%)"
  }
];

const HOW_IT_WORKS = [
  {
    icon: Search,
    title: "Search Naturally",
    titleHi: "स्वाभाविक रूप से खोजें",
    desc: "Type or speak what you need. Our AI understands context, budget, and preferences.",
    descHi: "अपनी जरूरत टाइप करें या बोलें। हमारा AI संदर्भ, बजट और प्राथमिकताएं समझता है।",
    color: "brand" as const
  },
  {
    icon: CheckCircle2,
    title: "Verified Listings",
    titleHi: "सत्यापित लिस्टिंग",
    desc: "See live verification status, photos, rent, locality, and owner-first listing details before you open a contact.",
    descHi:
      "संपर्क खोलने से पहले लाइव वेरिफिकेशन स्टेटस, फोटो, किराया, लोकेलिटी और मालिक की जानकारी देखें।",
    color: "brand" as const
  },
  {
    icon: KeyRound,
    title: "Connect & Move",
    titleHi: "जुड़ें और शिफ्ट करें",
    desc: "Open the listing, review the available owner/contact flow, and continue only when the details work for you.",
    descHi: "लिस्टिंग खोलें, उपलब्ध मालिक/कॉन्टैक्ट फ्लो देखें, और विवरण सही लगने पर ही आगे बढ़ें।",
    color: "brand" as const
  }
];

function formatCompactCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 100000) {
    return `${(value / 100000).toFixed(value % 100000 === 0 ? 0 : 1)}L`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`;
  }
  return String(value);
}

export default async function HomePage({ params }: { params: { locale: Locale } }) {
  const listeningHeroEnabled =
    process.env.NEXT_PUBLIC_FF_LISTENING_HERO === "1" ||
    process.env.NEXT_PUBLIC_FF_LISTENING_HERO === "true";
  if (listeningHeroEnabled) {
    return <ListeningHomePage locale={params.locale} />;
  }
  const isHindi = params.locale === "hi";

  // Fetch popular localities for the bar
  let popularLocalities: Array<{
    locality_id: number;
    locality_name: string;
    listing_count: number;
    city_slug: string;
  }> = [];
  try {
    popularLocalities = await fetchApi<typeof popularLocalities>(
      "/listings/search/popular-localities?city=lucknow&limit=10",
      undefined,
      { server: true }
    );
  } catch {
    /* silent */
  }

  // Fetch real Lucknow listings (3 buckets) for the homepage carousels.
  // All endpoints already exist on the backend; we tolerate failures silently.
  type ListingsSearchResponse = {
    items: ListingCardData[];
    total: number;
    page: number;
    page_size: number;
  };

  type ListingBucket = {
    items: ListingCardData[];
    total: number;
  };

  async function safeFetchListingBucket(qs: string): Promise<ListingBucket> {
    try {
      const res = await fetchApi<ListingsSearchResponse>(`/listings/search?${qs}`, undefined, {
        server: true
      });
      return {
        items: res.items ?? [],
        total: Number.isFinite(res.total) ? res.total : (res.items?.length ?? 0)
      };
    } catch {
      return { items: [], total: 0 };
    }
  }

  const [popularHomesBucket, trendingPgsBucket, furnishedHomesBucket] = await Promise.all([
    safeFetchListingBucket("city=lucknow&listing_type=flat_house&sort=verified&page=1"),
    safeFetchListingBucket("city=lucknow&listing_type=pg&sort=newest&page=1"),
    safeFetchListingBucket("city=lucknow&listing_type=flat_house&furnishing=fully_furnished&page=1")
  ]);
  const [allLucknowBucket, verifiedLucknowBucket, cityBuckets] = await Promise.all([
    safeFetchListingBucket("city=lucknow&page_size=1&page=1"),
    safeFetchListingBucket("city=lucknow&verified_only=true&page_size=1&page=1"),
    Promise.all(
      CITIES.map(async (city) => {
        const slug = city.name.toLowerCase();
        const bucket = await safeFetchListingBucket(`city=${slug}&page_size=1&page=1`);
        return { slug, total: bucket.total };
      })
    )
  ]);
  const popularHomes = popularHomesBucket.items;
  const trendingPgs = trendingPgsBucket.items;
  const furnishedHomes = furnishedHomesBucket.items;
  const visibleLocalities = popularLocalities.filter((loc) => loc.city_slug && loc.locality_name);
  const localitiesForDisplay = visibleLocalities;
  const cityTotals = new Map(cityBuckets.map((city) => [city.slug, city.total]));
  const activeCityCount = cityBuckets.filter((city) => city.total > 0).length;
  const liveProofListings = Array.from(
    new Map(
      [...popularHomes, ...trendingPgs, ...furnishedHomes]
        .filter((listing) => listing.id)
        .map((listing) => [listing.id, listing])
    ).values()
  ).slice(0, 3);
  const liveRents = liveProofListings
    .map((listing) => listing.monthly_rent ?? 0)
    .filter((rent) => rent > 0)
    .sort((a, b) => a - b);
  const heroLowRent = liveRents[0] ? formatCompactCount(liveRents[0]) : null;
  const heroHighRent = liveRents.at(-1) ? formatCompactCount(liveRents.at(-1) ?? 0) : null;
  // Two live listings (with photos) power the hero visual cluster. If we can't
  // get two with cover photos, the hero falls back to a centered layout so it
  // never renders an empty right column.
  // Prefer listings with photos, but fall back to any live listing (rendered
  // with a branded placeholder) so the cluster still shows when photos are
  // sparse. Only the genuinely empty market falls back to the centered hero.
  const heroPhotoListings = [...furnishedHomes, ...popularHomes, ...trendingPgs].filter(
    (listing) => listing.id && listing.cover_photo
  );
  const heroAnyListings = [...popularHomes, ...furnishedHomes, ...trendingPgs].filter(
    (listing) => listing.id
  );
  const heroListings = Array.from(
    new Map(
      [...heroPhotoListings, ...heroAnyListings].map((listing) => [listing.id, listing])
    ).values()
  ).slice(0, 2);
  const heroHasVisual = heroListings.length >= 2;
  const listingHref = (listing: ListingCardData) =>
    listing.listing_type === "pg" && listing.city
      ? `/${params.locale}/pg/${listing.city}/${listing.id}`
      : `/${params.locale}/listing/${listing.id}`;

  // Stat band: only ever surface non-zero, non-duplicate proof numbers.
  const listingsTotal = allLucknowBucket.total;
  const verifiedTotal = verifiedLucknowBucket.total;
  const verifiedPct = listingsTotal > 0 ? Math.round((verifiedTotal / listingsTotal) * 100) : null;
  const distinctLocalities = new Set(
    [...popularHomes, ...furnishedHomes, ...trendingPgs]
      .map((listing) => (listing.locality ?? "").trim().toLowerCase())
      .filter(Boolean)
  ).size;
  const localitiesCount = distinctLocalities || visibleLocalities.length;
  const marketStatCandidates = [
    {
      icon: ShieldCheck,
      raw: listingsTotal,
      value: formatCompactCount(listingsTotal),
      label: isHindi ? "लखनऊ लिस्टिंग" : "Live Lucknow listings",
      note: isHindi ? "बैकएंड से लाइव" : "Pulled from the search API"
    },
    {
      icon: CheckCircle2,
      raw: verifiedTotal,
      value: verifiedPct != null ? `${verifiedPct}%` : formatCompactCount(verifiedTotal),
      label: isHindi ? "वेरिफाइड इन्वेंट्री" : "Verified inventory",
      note: isHindi ? "हर लाइव लिस्टिंग जांची गई" : "Every live listing, checked"
    },
    {
      icon: MapPin,
      raw: localitiesCount,
      value: formatCompactCount(localitiesCount),
      label: isHindi ? "लोकैलिटी कवर" : "Localities covered",
      note: isHindi ? "लाइव लखनऊ डेटा से" : "From live Lucknow data"
    },
    {
      icon: TrendingUp,
      raw: activeCityCount,
      value: formatCompactCount(activeCityCount),
      label: isHindi ? "लाइव शहर" : "Cities live",
      note: isHindi ? "कोई हार्डकोड नहीं" : "Real inventory, not hardcoded"
    },
    {
      icon: Sofa,
      raw: furnishedHomesBucket.total,
      value: formatCompactCount(furnishedHomesBucket.total),
      label: isHindi ? "फर्निश्ड घर" : "Furnished homes",
      note: isHindi ? "मूव-इन रेडी" : "Move-in ready"
    }
  ];
  const liveMarketStats = marketStatCandidates.filter((stat) => stat.raw > 0).slice(0, 4);
  const impactStats = [
    {
      value: allLucknowBucket.total,
      suffix: "",
      label: isHindi ? "लखनऊ लिस्टिंग" : "Lucknow listings"
    },
    {
      value: verifiedLucknowBucket.total,
      suffix: "",
      label: isHindi ? "वेरिफाइड लिस्टिंग" : "Verified listings"
    },
    {
      value: visibleLocalities.length,
      suffix: "",
      label: isHindi ? "लाइव लोकैलिटी" : "Live localities"
    },
    {
      value: activeCityCount,
      suffix: "",
      label: isHindi ? "इन्वेंट्री वाले शहर" : "Cities with inventory"
    }
  ];

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Cribliv",
    url: BASE_URL,
    logo: `${BASE_URL}/cribliv.png`,
    description:
      "AI-powered rental search platform for North India with live listings, photos, rent, locality, and verification signals.",
    foundingDate: "2025",
    areaServed: { "@type": "Country", name: "India" },
    contactPoint: {
      "@type": "ContactPoint",
      email: "help@cribliv.com",
      contactType: "customer service",
      availableLanguage: ["English", "Hindi"]
    }
  };

  const websiteJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Cribliv",
    url: BASE_URL,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${BASE_URL}/${params.locale}/search?q={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    }
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
      />

      {/* ── Claude design-system homepage hero ── */}
      <section
        className={`hero--landing hero--home-prototype ${
          heroHasVisual ? "hero--has-visual" : "hero--centered"
        }`}
      >
        <div className="home-hero__wash" aria-hidden="true" />
        <div className="home-hero__glow" aria-hidden="true" />

        <div className="container home-hero__inner">
          <div className="home-hero__copy">
            <p className="home-hero__eyebrow animate-in">
              <Sparkles size={16} aria-hidden="true" />
              {isHindi ? "AI-संचालित किराया खोज" : "AI-Powered Rental Search"}
            </p>
            <h1 className="home-hero__title animate-in animate-in-delay-1">
              {isHindi ? (
                <>
                  अपना सही घर खोजें, <span>सत्यापित</span> और आसान
                </>
              ) : (
                <>
                  Find your perfect home, <span>verified</span> &amp; hassle-free
                </>
              )}
            </h1>
            <p className="home-hero__subtitle animate-in animate-in-delay-2">
              {isHindi
                ? "AI आपको दिल्ली NCR और उत्तर भारत की लाइव किराये की लिस्टिंग से मिलाता है, फोटो, किराया, लोकेलिटी और वेरिफिकेशन स्टेटस के साथ।"
                : "AI matches you with live rental listings across Delhi NCR and North India, with photos, rent, locality, and verification status up front."}
            </p>

            <div
              className="home-hero__intelligence animate-in animate-in-delay-3"
              aria-hidden="true"
            >
              <span>
                <Sparkles size={13} />
                Natural language
              </span>
              <span>Live locality preview</span>
              <span>Voice in Hindi + English</span>
            </div>

            <div className="home-hero__search-shell animate-in animate-in-delay-3">
              <div
                className="home-hero__search-glow home-hero__search-glow--warm"
                aria-hidden="true"
              />
              <div
                className="home-hero__search-glow home-hero__search-glow--cool"
                aria-hidden="true"
              />
              <SearchHero locale={params.locale} />
            </div>

            <div className="trust-strip home-hero__trust animate-in animate-in-delay-4">
              <span className="trust-strip__item">
                <ShieldCheck size={16} aria-hidden="true" />
                {isHindi ? "वेरिफिकेशन स्टेटस" : "Verification Status"}
              </span>
              <span className="home-hero__trust-dot" aria-hidden="true" />
              <span className="trust-strip__item">
                <Clock size={16} aria-hidden="true" />
                {isHindi ? "लाइव लिस्टिंग" : "Live Listings"}
              </span>
              <span className="home-hero__trust-dot" aria-hidden="true" />
              <span className="trust-strip__item">
                <BadgeIndianRupee size={16} aria-hidden="true" />
                {isHindi ? "स्पष्ट किराया" : "Clear Rent"}
              </span>
            </div>
          </div>

          {heroHasVisual && (
            <aside
              className="home-hero__visual"
              aria-label={isHindi ? "लखनऊ में लाइव घर" : "Live homes in Lucknow"}
            >
              <div className="home-hero__visual-head">
                <span>{isHindi ? "लखनऊ में लाइव घर" : "Live homes in Lucknow"}</span>
                <Link
                  href={`/${params.locale}/search?city=lucknow` as Route}
                  className="home-hero__visual-all"
                >
                  {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={13} />
                </Link>
              </div>
              <div className="home-hero__cards">
                {heroListings.map((listing) => {
                  const verified = listing.verification_status === "verified";
                  const rent =
                    listing.monthly_rent && listing.monthly_rent > 0
                      ? `₹${listing.monthly_rent.toLocaleString("en-IN")}`
                      : isHindi
                        ? "किराया पूछें"
                        : "On request";
                  const cityLabel = listing.city_name ?? listing.city ?? "Lucknow";
                  const typeLabel =
                    listing.listing_type === "pg"
                      ? isHindi
                        ? "पीजी"
                        : "PG"
                      : listing.bhk
                        ? `${listing.bhk} BHK`
                        : isHindi
                          ? "घर"
                          : "Home";
                  const CardIcon = listing.listing_type === "pg" ? Home : Building2;
                  return (
                    <Link
                      key={listing.id}
                      href={listingHref(listing) as Route}
                      className="home-hero__card"
                    >
                      <span
                        className={`home-hero__card-media${
                          listing.cover_photo ? "" : " home-hero__card-media--empty"
                        }`}
                        style={
                          listing.cover_photo
                            ? { backgroundImage: `url('${listing.cover_photo}')` }
                            : undefined
                        }
                        aria-hidden="true"
                      >
                        {!listing.cover_photo && <CardIcon size={26} aria-hidden="true" />}
                        {verified && (
                          <span className="home-hero__card-badge">
                            <CheckCircle2 size={11} aria-hidden="true" />
                            {isHindi ? "वेरिफाइड" : "Verified"}
                          </span>
                        )}
                      </span>
                      <span className="home-hero__card-body">
                        <span className="home-hero__card-rent">{rent}</span>
                        <span className="home-hero__card-title">{typeLabel}</span>
                        <span className="home-hero__card-loc">
                          <MapPin size={11} aria-hidden="true" />
                          {[listing.locality, cityLabel].filter(Boolean).join(", ")}
                        </span>
                      </span>
                    </Link>
                  );
                })}
              </div>
              {heroLowRent && (
                <span className="home-hero__price home-hero__price--low" aria-hidden="true">
                  <span />₹{heroLowRent}
                </span>
              )}
              {heroHighRent && heroHighRent !== heroLowRent && (
                <span className="home-hero__price home-hero__price--high" aria-hidden="true">
                  ₹{heroHighRent}
                </span>
              )}
            </aside>
          )}
        </div>
      </section>

      <section className="home-market-band" aria-label={isHindi ? "लाइव मार्केट" : "Live market"}>
        <div className="container">
          <div className="home-market-grid">
            {liveMarketStats.map((stat, index) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className="home-market-card">
                  <span className={`home-market-card__icon home-market-card__icon--${index + 1}`}>
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="home-market-card__value">{stat.value}</span>
                  <span className="home-market-card__label">{stat.label}</span>
                  <span className="home-market-card__note">{stat.note}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Top Cities ── */}
      <AnimateOnScroll>
        <section className="home-section home-section--cities">
          <div className="container">
            <div className="home-section__head">
              <div>
                <span className="home-section__eyebrow">
                  {isHindi ? "शहर खोजें" : "Top Locations"}
                </span>
                <h2 className="home-section__title">
                  {isHindi ? "लोकप्रिय शहर" : "Explore Top Cities"}
                </h2>
                <p className="home-section__lede">
                  {isHindi
                    ? "उत्तर भारत के प्रमुख शहरों में लाइव किराये के परिणाम।"
                    : "Live rental results across North India, organized by where people search."}
                </p>
              </div>
              <Link href={`/${params.locale}/search` as Route} className="home-section__action">
                {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={14} />
              </Link>
            </div>

            <div className="home-city-grid">
              {CITIES.map((city) => {
                const Icon = city.icon;
                const isFeatured = city.name === "Lucknow";
                const total = cityTotals.get(city.name.toLowerCase()) ?? 0;
                const hasLiveInventory = total > 0;
                const countLabel = hasLiveInventory
                  ? `${formatCompactCount(total)} live rentals`
                  : "Browse city";
                return (
                  <Link
                    key={city.name}
                    href={`/${params.locale}/city/${city.name.toLowerCase()}` as Route}
                    className={`home-city-card ${
                      hasLiveInventory ? "home-city-card--live" : "home-city-card--empty"
                    }${isFeatured ? " home-city-card--featured" : ""}`}
                  >
                    <div className="home-city-card__art">
                      <span
                        className="home-city-card__map"
                        style={{
                          backgroundImage: `url('/images/cities/${city.photo}-map.jpg'), ${city.gradient}`
                        }}
                        aria-hidden="true"
                      />
                      <div className="home-city-card__grid" aria-hidden="true" />
                      <span className="home-city-card__shape" aria-hidden="true" />
                      <span
                        className={`home-city-card__pin home-city-card__status-dot ${
                          hasLiveInventory
                            ? "home-city-card__status-dot--live"
                            : "home-city-card__status-dot--muted"
                        }`}
                        aria-hidden="true"
                      >
                        <Icon size={13} />
                      </span>
                      <span className="home-city-card__arrow" aria-hidden="true">
                        <ArrowRight size={20} />
                      </span>
                      <span className="home-city-card__map-label">Cribliv</span>
                    </div>
                    <div className="home-city-card__body">
                      {isFeatured && (
                        <span className="home-city-card__flag">
                          <Star size={13} aria-hidden="true" />
                          {isHindi ? "प्रमुख शहर" : "Flagship city"}
                        </span>
                      )}
                      <span className="home-city-card__name">{city.name}</span>
                      <span className="home-city-card__count">{countLabel}</span>
                      {isFeatured && (
                        <>
                          <span className="home-city-card__tagline">
                            {isHindi
                              ? "हमारा सबसे बड़ा बाज़ार — Cribliv पर सबसे ज़्यादा लाइव घर।"
                              : "Our biggest market — the most live homes on Cribliv."}
                          </span>
                          <span className="home-city-card__cta">
                            {isHindi ? "लखनऊ देखें" : "Explore Lucknow"}
                            <ArrowRight size={15} aria-hidden="true" />
                          </span>
                        </>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Popular Localities ── */}
      <AnimateOnScroll>
        <section className="home-section home-section--localities">
          <div className="container">
            <div className="home-section__head home-section__head--compact">
              <div>
                <span className="home-section__eyebrow">
                  {isHindi ? "लाइव मांग" : "Popular in Lucknow"}
                </span>
                <h2 className="home-section__title">
                  {isHindi ? "लोग अभी यहां खोज रहे हैं" : "Where people are searching now"}
                </h2>
              </div>
              <Link
                href={`/${params.locale}/search?city=lucknow` as Route}
                className="home-section__action"
              >
                {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={14} />
              </Link>
            </div>
            <div className="home-locality-strip">
              {localitiesForDisplay.length > 0 ? (
                localitiesForDisplay.map((loc) => (
                  <Link
                    key={loc.locality_id}
                    href={
                      `/${params.locale}/search?city=${loc.city_slug ?? "lucknow"}&q=${encodeURIComponent(loc.locality_name ?? "")}` as Route
                    }
                    className="home-locality-pill"
                  >
                    <MapPin size={13} />
                    {loc.locality_name}
                    <span>{loc.listing_count}</span>
                  </Link>
                ))
              ) : (
                <div className="home-locality-empty">
                  {isHindi
                    ? "लाइव लोकेलिटी डेटा अभी उपलब्ध नहीं है।"
                    : "Live locality data is unavailable right now."}
                </div>
              )}
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Lucknow listing carousels (Airbnb-style rows) ── */}
      {popularHomes.length > 0 || trendingPgs.length > 0 || furnishedHomes.length > 0 ? (
        <AnimateOnScroll delay={100}>
          <section className="home-section home-section--listings">
            <div className="container home-carousel-stack">
              {popularHomes.length > 0 && (
                <ListingCarousel
                  locale={params.locale}
                  title={isHindi ? "लखनऊ में लाइव घर" : "Live homes in Lucknow"}
                  subtitle={
                    isHindi
                      ? "सर्च API से आ रहे फ्लैट और मकान"
                      : "Flats and houses coming from the search API"
                  }
                  viewAllHref={`/${params.locale}/search?city=lucknow&listing_type=flat_house`}
                  items={popularHomes}
                />
              )}

              {trendingPgs.length > 0 && (
                <ListingCarousel
                  locale={params.locale}
                  title={isHindi ? "लखनऊ में नए PG" : "Latest PGs in Lucknow"}
                  subtitle={
                    isHindi ? "बैकएंड से नए PG परिणाम" : "Fresh PG results from the backend"
                  }
                  viewAllHref={`/${params.locale}/pg/lucknow`}
                  items={trendingPgs}
                />
              )}

              {furnishedHomes.length > 0 && (
                <ListingCarousel
                  locale={params.locale}
                  title={isHindi ? "फर्निश्ड घर, लखनऊ" : "Furnished homes in Lucknow"}
                  subtitle={
                    isHindi ? "सब कुछ तैयार, बस आइए" : "Move-in ready with furniture and appliances"
                  }
                  viewAllHref={`/${params.locale}/search?city=lucknow&listing_type=flat_house&furnishing=fully_furnished`}
                  items={furnishedHomes}
                />
              )}
            </div>
          </section>
        </AnimateOnScroll>
      ) : null}

      {/* ── How It Works ── */}
      <AnimateOnScroll delay={100}>
        <section
          className="home-section home-section--surface home-section--editorial"
          data-testid="home-how-it-works"
        >
          <div className="container">
            <div className="edi-head edi-head--solo">
              <div>
                <span className="edi-eyebrow">{isHindi ? "सरल प्रक्रिया" : "How It Works"}</span>
                <h2 className="edi-title">
                  {isHindi ? "तीन कदम. स्पष्ट जानकारी." : "Three steps. Clear details."}
                </h2>
              </div>
            </div>
            <div className="hiw hiw--editorial">
              {HOW_IT_WORKS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className="hiw-step" data-testid="home-how-it-works-step">
                    <div className="hiw-step__mark">
                      <span className="hiw-num" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="hiw-icon" aria-hidden="true">
                        <Icon size={21} />
                      </span>
                    </div>
                    <h3>{isHindi ? step.titleHi : step.title}</h3>
                    <p>{isHindi ? step.descHi : step.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── AI Feature Showcase ── */}
      <AnimateOnScroll delay={100}>
        <section className="home-section home-section--ai">
          <div className="container">
            <div className="edi-head">
              <div>
                <span className="edi-eyebrow">{isHindi ? "AI से संचालित" : "Powered by AI"}</span>
                <h2 className="edi-title">
                  {isHindi
                    ? "खोजें, लिस्ट करें, एक्सप्लोर करें, AI के साथ"
                    : "Find, list, and explore, with AI"}
                </h2>
              </div>
              <p className="edi-lede">
                {isHindi
                  ? "Cribliv के नए AI टूल किराये की खोज को आसान बनाते हैं।"
                  : "The tools that make Cribliv feel less like a listings site and more like an assistant."}
              </p>
            </div>

            <div className="ai-showcase">
              {/* CriblMap — featured */}
              <Link
                href={`/${params.locale}/map` as Route}
                className="ai-feature ai-feature--featured"
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, rgba(8,18,38,0.20) 0%, rgba(8,18,38,0.55) 55%, rgba(8,18,38,0.92) 100%), url('/images/india-map-hero.jpg')"
                }}
              >
                <div className="ai-feature__pins" aria-hidden="true">
                  <span className="ai-feature__pin" style={{ top: "28%", left: "32%" }} />
                  <span
                    className="ai-feature__pin ai-feature__pin--2"
                    style={{ top: "44%", left: "58%" }}
                  />
                  <span
                    className="ai-feature__pin ai-feature__pin--3"
                    style={{ top: "62%", left: "40%" }}
                  />
                </div>
                <span className="ai-pill">{isHindi ? "नया" : "New"}</span>
                <h3 className="ai-feature__title">CriblMap</h3>
                <p className="ai-feature__desc">
                  {isHindi
                    ? "लाइव मैप पर किराये के परिणाम देखें: किराये के रुझान, मेट्रो की दूरी और इलाके की जानकारी।"
                    : "See rental results on a live map: rent trends, metro distance, and area insights at a glance."}
                </p>
                <span className="ai-feature__cta">
                  {isHindi ? "CriblMap खोलें" : "Open CriblMap"} <ArrowRight size={14} />
                </span>
              </Link>

              {/* Maya — voice listing agent */}
              <Link href={`/${params.locale}/owner/listings/new` as Route} className="ai-feature">
                <div className="ai-mini-mic" aria-hidden="true">
                  <Mic size={22} />
                </div>
                <span className="ai-pill">{isHindi ? "AI वॉइस" : "AI Voice"}</span>
                <h3 className="ai-feature__title">
                  {isHindi ? "Maya, आपकी वॉइस लिस्टिंग एजेंट" : "Maya, your voice listing agent"}
                </h3>
                <p className="ai-feature__desc">
                  {isHindi
                    ? "बस बोलकर अपनी प्रॉपर्टी लिस्ट करें। Maya आपके बताते ही सारी जानकारी भर देती है।"
                    : "List your property by just talking. Maya fills in the details as you speak."}
                </p>
                <div className="ai-bubble">नमस्ते! Boliye…</div>
                <span className="ai-feature__cta">
                  {isHindi ? "वॉइस लिस्टिंग आज़माएं" : "Try voice listing"} <ArrowRight size={14} />
                </span>
              </Link>

              {/* AI / voice search */}
              <Link href={`/${params.locale}/search` as Route} className="ai-feature">
                <span className="ai-pill">{isHindi ? "AI खोज" : "AI Search"}</span>
                <div className="ai-mini-search">
                  <Search size={14} />
                  {isHindi ? "साइबर सिटी के पास 2BHK, 35k तक" : "2BHK near Cyber City under 35k"}
                </div>
                <div className="ai-chips" aria-hidden="true">
                  <span className="ai-chip">2 BHK</span>
                  <span className="ai-chip">{isHindi ? "35k तक" : "Under 35k"}</span>
                  <span className="ai-chip">{isHindi ? "फर्निश्ड" : "Furnished"}</span>
                </div>
                <h3 className="ai-feature__title">
                  {isHindi ? "जैसे बोलते हैं वैसे खोजें" : "Search the way you talk"}
                </h3>
                <p className="ai-feature__desc">
                  {isHindi
                    ? "अंग्रेज़ी या हिंदी में लिखें या बोलें। हमारा AI इसे सही फ़िल्टर में बदल देता है।"
                    : "Type or speak in English or Hindi. Our AI turns it into the right filters."}
                </p>
                <span className="ai-feature__cta">
                  {isHindi ? "अभी खोजें" : "Start searching"} <ArrowRight size={14} />
                </span>
              </Link>
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Browse by Type ── */}
      <AnimateOnScroll delay={100}>
        <section className="home-section home-section--surface">
          <div className="container">
            <div className="edi-head">
              <div>
                <span className="edi-eyebrow">{isHindi ? "संपत्ति प्रकार" : "Browse by Type"}</span>
                <h2 className="edi-title">
                  {isHindi ? "आप किस तरह रहना चाहते हैं?" : "What kind of place are you after?"}
                </h2>
              </div>
              <Link href={`/${params.locale}/search` as Route} className="edi-head__action">
                {isHindi ? "सभी देखें" : "Browse all"} <ArrowRight size={14} />
              </Link>
            </div>
            <div className="browse-bento">
              {[
                {
                  href: `/${params.locale}/search?listing_type=flat_house`,
                  icon: Building,
                  color: "brand" as const,
                  featured: true,
                  title: isHindi ? "फ्लैट और मकान" : "Flats & Houses",
                  desc: isHindi
                    ? "1BHK से 4BHK तक, फोटो, किराया और वेरिफिकेशन स्टेटस के साथ।"
                    : "1BHK to 4BHK apartments and independent houses with photos, rent, and verification status.",
                  bg: "var(--brand-light)"
                },
                {
                  href: `/${params.locale}/pg`,
                  icon: Home,
                  color: "accent" as const,
                  featured: false,
                  title: isHindi ? "PG और हॉस्टल" : "PGs & Hostels",
                  desc: isHindi
                    ? "खाने, वाईफाई और साझा सुविधाओं के साथ"
                    : "Meals, WiFi, and shared amenities",
                  bg: "var(--accent-light)"
                },
                {
                  href: `/${params.locale}/search?listing_type=flat_house&furnished=true`,
                  icon: Sofa,
                  color: "amber" as const,
                  featured: false,
                  title: isHindi ? "फर्निश्ड घर" : "Furnished Homes",
                  desc: isHindi ? "सब कुछ तैयार, बस आइए" : "Move-in ready with furniture",
                  bg: "var(--amber-light)"
                }
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.title}
                    href={item.href as Route}
                    className={`browse-card${item.featured ? " browse-card--featured" : ""}`}
                  >
                    <div>
                      <div
                        className="browse-card__icon"
                        style={{ background: item.bg, color: `var(--${item.color})` }}
                        aria-hidden="true"
                      >
                        <Icon size={item.featured ? 26 : 22} />
                      </div>
                      <h3 className="browse-card__title">{item.title}</h3>
                      <p className="browse-card__desc">{item.desc}</p>
                    </div>
                    <span className="browse-card__cta" style={{ color: `var(--${item.color})` }}>
                      {isHindi ? "खोजें" : "Explore"} <ArrowRight size={14} />
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Backend Proof Stats ── */}
      <AnimateOnScroll delay={100}>
        <section className="home-section home-section--impact">
          <div className="container">
            <div className="impact">
              <div className="impact__intro">
                <span className="edi-eyebrow edi-eyebrow--light">
                  {isHindi ? "लाइव डेटा" : "Live backend proof"}
                </span>
                <h2 className="edi-title edi-title--light">
                  {isHindi
                    ? "जो दिख रहा है वह API से आ रहा है"
                    : "What you see here comes from the API"}
                </h2>
                <p
                  style={{
                    marginTop: "var(--space-4)",
                    color: "rgba(255,255,255,0.6)",
                    fontSize: 15,
                    lineHeight: 1.6,
                    maxWidth: 360
                  }}
                >
                  {isHindi
                    ? "ये नंबर लाइव सर्च, वेरिफिकेशन और लोकेलिटी रिस्पॉन्स से बने हैं।"
                    : "These numbers are built from live search, verification, and locality responses."}
                </p>
              </div>

              <div className="impact-grid">
                {impactStats.map((stat, i) => (
                  <div key={stat.label} className="impact-stat">
                    <div className="impact-stat__num">
                      <CountUp value={stat.value} suffix={stat.suffix} duration={1400 + i * 200} />
                    </div>
                    <div className="impact-stat__label">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Live Backend Examples ── */}
      {liveProofListings.length > 0 && (
        <AnimateOnScroll delay={100}>
          <section className="home-section home-section--surface">
            <div className="container">
              <div className="edi-head">
                <div>
                  <span className="edi-eyebrow">
                    {isHindi ? "लाइव उदाहरण" : "Live backend examples"}
                  </span>
                  <h2 className="edi-title">
                    {isHindi
                      ? "अभी API से आ रही लिस्टिंग"
                      : "Listings currently coming from the API"}
                  </h2>
                </div>
                <p className="edi-lede">
                  {isHindi
                    ? "यह सेक्शन टेस्टिमोनियल नहीं है। ये वास्तविक लिस्टिंग डेटा है।"
                    : "This is not a testimonial section. These are real listings from the backend response."}
                </p>
              </div>
              <div className="home-proof-grid">
                {liveProofListings.map((listing) => (
                  <ListingCardItem key={listing.id} locale={params.locale} listing={listing} />
                ))}
              </div>
            </div>
          </section>
        </AnimateOnScroll>
      )}

      {/* ── CTA Banner ── */}
      <div className="container home-cta-wrap">
        <section className="cta-banner" style={{ margin: 0 }}>
          {/* Decorative dot grid */}
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
              pointerEvents: "none",
              zIndex: 0
            }}
          />
          <div className="cta-banner__text">
            <span className="cta-banner__eyebrow">
              {isHindi ? "मालिकों के लिए" : "For Property Owners"}
            </span>
            <h2>
              {isHindi ? "प्रॉपर्टी है? मुफ़्त में लिस्ट करें" : "Own a property? List it free."}
            </h2>
            <p>
              {isHindi
                ? "लिस्टिंग ड्राफ्ट बनाएं, विवरण जोड़ें, और किरायेदारों से जुड़ने के लिए अपना मालिक डैशबोर्ड इस्तेमाल करें।"
                : "Create a listing draft, add property details, and use the owner dashboard to connect with tenants."}
            </p>
            <Link href={`/${params.locale}/owner/dashboard` as Route} className="btn btn--lg">
              {isHindi ? "अभी लिस्ट करें" : "List Your Property"}
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="cta-banner__mark" aria-hidden="true">
            <KeyRound size="0.78em" strokeWidth={1.25} />
          </div>
        </section>
      </div>
    </>
  );
}
