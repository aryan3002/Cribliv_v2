import type { Metadata, Route } from "next";
import dynamic from "next/dynamic";
import { locales, type Locale } from "../../lib/i18n";
import { fetchApi } from "../../lib/api";
import Link from "next/link";
import {
  ShieldCheck,
  Camera,
  PhoneCall,
  Clock,
  Building2,
  Landmark,
  Building,
  Home,
  MapPin,
  TreePine,
  Castle,
  Star,
  Sunrise,
  ArrowRight,
  Sparkles,
  Mic
} from "lucide-react";
import { ListingCarousel } from "../../components/listing-carousel";
import { type ListingCardData } from "../../components/listing-card";
import { ListeningHomePage } from "./listening-home";
import { resolveHomeCity } from "../../lib/home-city-config";
import { fetchBlogList, type BlogListItem } from "../../lib/blog-api";
import type { HeroPin } from "../../lib/hero-query";
import { selectHeroMarkers } from "../../lib/hero-map-markers";
import {
  HomeHeroMap,
  LUCKNOW_GOMTI_PATH,
  LUCKNOW_STREET_PATHS
} from "../../components/home-hero-map";

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

// MUST stay ssr:true. These wrap ~18 homepage sections; AnimateOnScroll is
// built to render its children visible on the server (useState(true)) and only
// flips to hide-then-animate AFTER mount using transform/opacity (which do not
// reflow). With ssr:false the wrapped sections are absent from the server HTML
// and injected on hydration, growing the page and shifting the CTA down by
// hundreds of pixels (intermittent CLS ~0.3–0.44 in Lighthouse — fails the
// PageSpeed desktop CLS / Agentic Browsing check). ssr:true reserves the space
// at first paint; the animation is still client-only and causes no layout shift.
const AnimateOnScroll = dynamic(
  () => import("../../components/scroll-animations").then((mod) => mod.AnimateOnScroll),
  { ssr: true }
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

// ISR window for the homepage. Every fetch below passes this same value, which
// is what actually keeps the route static — a single `no-store` fetch anywhere
// in the tree opts the whole page into per-request SSR, and this page makes 18
// of them (localities + 3 carousels + 2 counters + one counter per city). As
// the highest-traffic route that made it the largest consumer of Fluid Active
// CPU and function invocations. All endpoints it reads are read-only search
// queries, so serving them from the ISR cache costs nothing but staleness:
// a newly published listing takes up to 5 minutes to surface on the homepage
// (it is immediately live on /search, which is intentionally still dynamic).
export const revalidate = 300;

// Required for the `revalidate` above to actually cache the *page*. Caching the
// fetches alone is not enough: without generateStaticParams, a route under a
// dynamic segment (`[locale]`) is rendered per request, so we would still pay a
// function invocation and its CPU on every visit and only save the API calls.
// Enumerating the two locales lets Next prerender /en and /hi and serve them
// from the ISR cache instead. Keep in sync with `locales` in lib/i18n.
export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
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

  // One consolidated data pass feeds every section. Everything is fetched
  // with silent fallbacks: a failed call means the element simply does not
  // render — the homepage never shows an error or a zero.
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
        revalidate
      });
      return {
        items: res.items ?? [],
        total: Number.isFinite(res.total) ? res.total : (res.items?.length ?? 0)
      };
    } catch {
      return { items: [], total: 0 };
    }
  }

  // Live price markers for the hero map: real listings inside the Lucknow
  // bounds, projected onto the stylized SVG canvas. A failed fetch — or an
  // unexpected non-array body — means the map simply renders without pills.
  const heroCity = resolveHomeCity({ cookieCity: null, geoCity: null });
  async function safeFetchHeroPins(): Promise<HeroPin[]> {
    try {
      const res = await fetchApi<HeroPin[]>(
        `/listings/search/map?sw_lat=${heroCity.bounds.sw.lat}&sw_lng=${heroCity.bounds.sw.lng}` +
          `&ne_lat=${heroCity.bounds.ne.lat}&ne_lng=${heroCity.bounds.ne.lng}&limit=30`,
        undefined,
        { revalidate }
      );
      return Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  }

  type LocalityRow = {
    locality_id: number;
    locality_name: string;
    listing_count: number;
    city_slug: string;
  };
  async function safeFetchLocalities(): Promise<LocalityRow[]> {
    try {
      const res = await fetchApi<LocalityRow[]>(
        "/listings/search/popular-localities?city=lucknow&limit=10",
        undefined,
        { revalidate }
      );
      return Array.isArray(res) ? res.filter((row) => row.locality_name && row.city_slug) : [];
    } catch {
      return [];
    }
  }

  // The Lucknow total comes from the CITIES loop below (same query), so it is
  // not fetched a second time here.
  const [homesBucket, pgBucket, verifiedLucknowBucket, cityBuckets, heroPins, localities, posts] =
    await Promise.all([
      safeFetchListingBucket("city=lucknow&listing_type=flat_house&sort=verified&page=1"),
      safeFetchListingBucket("city=lucknow&listing_type=pg&sort=newest&page=1"),
      safeFetchListingBucket("city=lucknow&verified_only=true&page_size=1&page=1"),
      Promise.all(
        CITIES.map(async (city) => {
          const slug = city.name.toLowerCase();
          const bucket = await safeFetchListingBucket(`city=${slug}&page_size=1&page=1`);
          return { slug, total: bucket.total };
        })
      ),
      safeFetchHeroPins(),
      safeFetchLocalities(),
      fetchBlogList({ page_size: 3 }, { revalidate })
        .then((res): BlogListItem[] => res.items.slice(0, 3))
        .catch((): BlogListItem[] => [])
    ]);
  const pgMinRent = pgBucket.items
    .map((l) => l.monthly_rent ?? 0)
    .filter((rent) => rent > 0)
    .reduce((min, rent) => (min === 0 || rent < min ? rent : min), 0);
  const cityTotals = new Map(cityBuckets.map((city) => [city.slug, city.total]));
  const listingHref = (listing: ListingCardData) =>
    listing.listing_type === "pg" && listing.city
      ? `/${params.locale}/pg/${listing.city}/${listing.id}`
      : `/${params.locale}/listing/${listing.id}`;

  const listingsTotal = cityTotals.get("lucknow") ?? 0;
  const verifiedTotal = verifiedLucknowBucket.total;
  const verifiedPct = listingsTotal > 0 ? Math.round((verifiedTotal / listingsTotal) * 100) : null;
  // The hero sentence says "verified homes", so it only ever shows the
  // verified count — never the unfiltered total under that label — and, like
  // the listening hero, it hides (with the pills) below the thin-market
  // threshold from the city config rather than advertising a near-empty map.
  const heroMarketIsThin = listingsTotal < heroCity.minHeroInventory;
  const heroCount = heroMarketIsThin ? 0 : verifiedTotal;
  // minXPct keeps pills clear of the headline/search column on the left;
  // 6 pills reads as "alive" without cluttering wide screens.
  const heroMarkers = heroMarketIsThin
    ? []
    : selectHeroMarkers(heroPins, heroCity.bounds, { maxMarkers: 6, minXPct: 55 });
  const featuredListing =
    homesBucket.items.find(
      (l) => l.cover_photo && l.verification_status === "verified" && (l.monthly_rent ?? 0) > 0
    ) ?? null;
  // Cities are partitioned once so the live-card predicate and the
  // "expanding next" predicate can never drift apart.
  const liveCities = CITIES.filter((city) => (cityTotals.get(city.name.toLowerCase()) ?? 0) > 0);
  const upcomingCities = CITIES.filter(
    (city) => (cityTotals.get(city.name.toLowerCase()) ?? 0) === 0
  );

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

      {/* ── Living Map hero ── */}
      <section className="hero-living" aria-label={isHindi ? "घर खोजें" : "Search homes"}>
        <div className="container hero-living__inner">
          <p className="hero-living__eyebrow">
            <span className="hero-living__live-dot" aria-hidden="true" />
            {isHindi ? "लखनऊ में लाइव · उत्तर भारत" : "Live in Lucknow · North India"}
          </p>
          <h1 className="hero-living__title">
            {isHindi ? (
              <>
                इस नक्शे का हर घर <em>असली है।</em>
              </>
            ) : (
              <>
                Every home on this map is <em>real.</em>
              </>
            )}
          </h1>
          {heroCount > 0 && (
            <p className="hero-living__count">
              {isHindi ? (
                <>
                  <strong>{heroCount} सत्यापित घर</strong> अभी लखनऊ में लाइव हैं। फोटो, किराया और
                  मालिक, सब जांचे हुए।
                </>
              ) : (
                <>
                  <strong>{heroCount} verified homes</strong> are live in Lucknow right now, each
                  checked for photos, rent, and owner.
                </>
              )}
            </p>
          )}
          <div className="hero-living__search">
            <SearchHero locale={params.locale} />
          </div>
          <div className="hero-living__chips" aria-hidden="true">
            <span>
              <ShieldCheck size={13} />{" "}
              {isHindi ? "हर लिस्टिंग वेरिफाइड" : "Every listing verified"}
            </span>
            <span>{isHindi ? "कोई ब्रोकर नहीं" : "No brokers"}</span>
            <span>
              {/* Deliberately bilingual in both locales — the mixed script IS
                  the message (voice search works in either language). */}
              <Mic size={13} /> हिंदी + English voice search
            </span>
          </div>
        </div>
        {/* Rendered after the copy so the featured-card link comes after the
            h1 and search box in focus/reading order; z-index puts the map
            canvas behind the copy and the card above it. */}
        <HomeHeroMap
          markers={heroMarkers}
          featured={featuredListing}
          featuredHref={featuredListing ? listingHref(featuredListing) : null}
          locale={params.locale}
        />
      </section>

      {/* ── Top Cities ── */}
      {/* Hidden entirely when no city reports live inventory (e.g. the search
          API is down during regeneration) — an empty grid under a "live
          results" header, with every city demoted to a chip, reads as "we
          have nothing anywhere". */}
      {liveCities.length > 0 && (
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
                {liveCities.map((city) => {
                  const Icon = city.icon;
                  const isFeatured = city.name === "Lucknow";
                  const total = cityTotals.get(city.name.toLowerCase()) ?? 0;
                  const countLabel = isHindi
                    ? `${formatCompactCount(total)} लाइव किराया`
                    : `${formatCompactCount(total)} live rental${total === 1 ? "" : "s"}`;
                  return (
                    <Link
                      key={city.name}
                      href={`/${params.locale}/city/${city.name.toLowerCase()}` as Route}
                      className={`home-city-card home-city-card--live${
                        isFeatured ? " home-city-card--featured" : ""
                      }`}
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
                          className="home-city-card__pin home-city-card__status-dot home-city-card__status-dot--live"
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
                                ? "हमारा सबसे बड़ा बाज़ार, Cribliv पर सबसे ज़्यादा लाइव घर।"
                                : "Our biggest market, with the most live homes on Cribliv."}
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

              {upcomingCities.length > 0 && (
                <div className="home-city-soon">
                  <span className="home-city-soon__label">
                    {isHindi ? "आगे विस्तार:" : "Expanding next:"}
                  </span>
                  {upcomingCities.map((city) => (
                    <Link
                      key={city.name}
                      href={`/${params.locale}/city/${city.name.toLowerCase()}` as Route}
                      className="home-city-soon__chip"
                    >
                      {city.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </section>
        </AnimateOnScroll>
      )}

      {/* ── Live listings rails ── */}
      {(homesBucket.items.length > 0 || pgBucket.items.length > 0) && (
        <AnimateOnScroll>
          <section className="home-section home-section--listings">
            <div className="container home-carousel-stack">
              {homesBucket.items.length > 0 && (
                <ListingCarousel
                  locale={params.locale}
                  title={isHindi ? "आज ही बात करने लायक घर" : "Homes you can call about today"}
                  subtitle={
                    isHindi
                      ? "सीधे लाइव बाज़ार से: मालिक पोस्ट करते हैं, घर किराए पर उठते ही हट जाते हैं।"
                      : "Straight from the live market, updated as owners post and homes get rented."
                  }
                  viewAllHref={`/${params.locale}/search?city=lucknow&listing_type=flat_house`}
                  items={homesBucket.items}
                />
              )}
              {pgBucket.items.length > 0 && (
                <ListingCarousel
                  locale={params.locale}
                  title={
                    isHindi
                      ? "हर कैंपस के पास PG और को-लिविंग"
                      : "PGs & co-living near every campus"
                  }
                  subtitle={
                    pgMinRent > 0
                      ? isHindi
                        ? `₹${pgMinRent.toLocaleString("en-IN")}/माह से गर्ल्स, बॉयज़ और को-एड PG।`
                        : `Girls, boys, and co-ed PGs from ₹${pgMinRent.toLocaleString("en-IN")}/month.`
                      : isHindi
                        ? "खाने और वाईफाई के साथ गर्ल्स, बॉयज़ और को-एड PG।"
                        : "Girls, boys, and co-ed PGs with meals and WiFi."
                  }
                  viewAllHref={`/${params.locale}/pg/lucknow`}
                  items={pgBucket.items}
                />
              )}
            </div>
          </section>
        </AnimateOnScroll>
      )}

      {/* ── Popular localities (only when the live data is actually there) ── */}
      {localities.length >= 4 && (
        <AnimateOnScroll>
          <section className="home-section home-localities">
            <div className="container">
              <span className="home-section__eyebrow">
                {isHindi ? "लखनऊ में लोकप्रिय" : "Popular in Lucknow"}
              </span>
              <h2 className="home-section__title">
                {isHindi ? "लोकेलिटी से खोजें" : "Browse by locality"}
              </h2>
              <div className="home-locality-row">
                {localities.map((loc) => (
                  <Link
                    key={loc.locality_id}
                    href={
                      `/${params.locale}/search?city=${loc.city_slug}&q=${encodeURIComponent(loc.locality_name)}` as Route
                    }
                    className="home-locality-chip"
                  >
                    <MapPin size={13} aria-hidden="true" />
                    {loc.locality_name}
                    {loc.listing_count > 0 && <span>{loc.listing_count}</span>}
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </AnimateOnScroll>
      )}

      {/* ── How verification works ── */}
      <AnimateOnScroll>
        <section className="home-section home-verify">
          <div className="container">
            <span className="home-section__eyebrow">
              {isHindi ? "भरोसे की वजह" : "Why trust it"}
            </span>
            <h2 className="home-section__title">
              {isHindi ? "घर कैसे वेरिफाई होता है" : "How a home gets verified"}
            </h2>
            <div className="home-verify__grid">
              {[
                {
                  icon: Camera,
                  title: isHindi ? "फोटो जांची जाती हैं" : "Photos checked",
                  desc: isHindi
                    ? "असली प्रॉपर्टी की असली फोटो। कोई स्टॉक इमेज नहीं, कोई झांसा नहीं।"
                    : "Real photos from the actual property. No stock images, no bait listings."
                },
                {
                  icon: PhoneCall,
                  title: isHindi ? "मालिक कन्फर्म होता है" : "Owner confirmed",
                  desc: isHindi
                    ? "लिस्टिंग लाइव होने से पहले मालिक का फोन वेरिफाई होता है, ताकि आप सही इंसान से बात करें।"
                    : "We verify the owner's phone before a listing goes live, so you call the right person."
                },
                {
                  icon: Clock,
                  title: isHindi ? "उपलब्धता लाइव रहती है" : "Availability live",
                  desc: isHindi
                    ? "किराए पर उठ चुके घर साइट से हट जाते हैं। जो दिखता है, वही मिलता है।"
                    : "Rented-out homes leave the site. What you see is what you can actually get."
                }
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="home-verify__step">
                    <span className="home-verify__icon" aria-hidden="true">
                      <Icon size={17} />
                    </span>
                    <h3>{step.title}</h3>
                    <p>{step.desc}</p>
                  </div>
                );
              })}
            </div>
            {verifiedPct != null && verifiedPct > 0 && (
              <p className="home-verify__fact">
                {isHindi ? (
                  <>
                    <strong>लाइव लिस्टिंग में से {verifiedPct}% वेरिफाइड हैं।</strong> Cribliv पर
                    है, तो असली है। यही तो बात है।
                  </>
                ) : (
                  <>
                    <strong>{verifiedPct}% of live listings are verified.</strong> If it&apos;s on
                    Cribliv, it&apos;s real. That&apos;s the whole point.
                  </>
                )}
              </p>
            )}
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Maya / search like you talk ── */}
      <AnimateOnScroll>
        <section className="home-section home-maya">
          <div className="container home-maya__row">
            <Link
              href={`/${params.locale}/search` as Route}
              className="home-maya__orb"
              aria-label={isHindi ? "वॉइस से खोजें" : "Search by voice"}
            >
              <Mic size={30} aria-hidden="true" />
            </Link>
            <div>
              <span className="home-section__eyebrow">
                {isHindi ? "जैसे बोलते हैं, वैसे खोजें" : "Search like you talk"}
              </span>
              <h2 className="home-section__title">
                {isHindi
                  ? "बस बताइए क्या चाहिए, हिंदी में या English में"
                  : "Just say what you need, in Hindi or English"}
              </h2>
              <div className="home-maya__chips">
                {[
                  isHindi ? "हज़रतगंज के पास 2BHK, 15 हज़ार तक" : "2BHK near Hazratganj under 15k",
                  "गोमती नगर में फर्निश्ड फ्लैट",
                  isHindi ? "Amity के पास गर्ल्स PG" : "Girls PG near Amity University",
                  isHindi ? "मेट्रो के पास फैमिली फ्लैट" : "Family flat near a metro station"
                ].map((query) => (
                  <Link
                    key={query}
                    href={`/${params.locale}/search?q=${encodeURIComponent(query)}` as Route}
                    className="home-maya__chip"
                  >
                    <Sparkles size={13} aria-hidden="true" />
                    {query}
                  </Link>
                ))}
              </div>
              <Link href={`/${params.locale}/map` as Route} className="home-maya__map-link">
                {isHindi ? "या CriblMap पर घूमकर देखें" : "Or explore on CriblMap"}{" "}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Cribliv Times ── */}
      {posts.length > 0 && (
        <AnimateOnScroll>
          <section className="home-section home-times">
            <div className="container">
              <div className="home-section__head">
                <div>
                  <span className="home-section__eyebrow">Cribliv Times</span>
                  <h2 className="home-section__title">
                    {isHindi ? "किराए से पहले बाज़ार समझें" : "Know the market before you rent"}
                  </h2>
                </div>
                <Link href={`/${params.locale}/blog` as Route} className="home-section__action">
                  {isHindi ? "सभी पढ़ें" : "Read Cribliv Times"} <ArrowRight size={14} />
                </Link>
              </div>
              <div className="home-times__grid">
                {posts.map((post) => (
                  <Link
                    key={post.slug}
                    href={`/${params.locale}/blog/${post.slug}` as Route}
                    className="home-times__card"
                  >
                    {post.category_slug && (
                      <span className="home-times__kicker">
                        {post.category_slug.replace(/-/g, " ")}
                      </span>
                    )}
                    <h3>{post.title}</h3>
                    {post.excerpt && <p>{post.excerpt}</p>}
                    <span className="home-times__read">
                      {isHindi ? "पढ़ें" : "Read"} <ArrowRight size={13} aria-hidden="true" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </AnimateOnScroll>
      )}

      {/* ── Owner band ── */}
      <section className="home-owner-band">
        <svg
          className="home-owner-band__art"
          viewBox="0 0 1400 800"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          focusable="false"
        >
          <g stroke="rgba(159,178,204,0.35)" strokeWidth="2.5" fill="none">
            {[...LUCKNOW_STREET_PATHS, LUCKNOW_GOMTI_PATH].map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </svg>
        <div className="container home-owner-band__inner">
          <div>
            <h2>
              {isHindi
                ? "लखनऊ में प्रॉपर्टी है? मुफ़्त में लिस्ट करें।"
                : "Own a place in Lucknow? List it free."}
            </h2>
            <p>
              {isHindi
                ? "वेरिफाइड किरायेदार, कोई ब्रोकर का खेल नहीं। और जब तक कोई सीरियस न हो, आपका नंबर प्राइवेट रहता है।"
                : "Verified tenants, no broker games, and your number stays private until someone's serious."}
            </p>
          </div>
          <div className="home-owner-band__cta">
            <Link
              href={`/${params.locale}/owner/dashboard` as Route}
              className="btn btn--lg home-owner-band__btn"
            >
              {isHindi ? "प्रॉपर्टी पोस्ट करें" : "Post your property"} <ArrowRight size={18} />
            </Link>
            <span>{isHindi ? "मुफ़्त · 24 घंटे में लाइव" : "Free · Live in under 24 hours"}</span>
          </div>
        </div>
      </section>
    </>
  );
}
