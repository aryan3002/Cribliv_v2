import type { Metadata, Route } from "next";
import dynamic from "next/dynamic";
import { t, locales, type Locale } from "../../lib/i18n";
import { fetchApi } from "../../lib/api";
import Link from "next/link";
import {
  ShieldCheck,
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
  Mic
} from "lucide-react";
import { ListingCarousel } from "../../components/listing-carousel";
import { type ListingCardData } from "../../components/listing-card";
import { ListeningHomePage } from "./listening-home";
import { resolveHomeCity } from "../../lib/home-city-config";
import type { HeroPin } from "../../lib/hero-query";
import { selectHeroMarkers } from "../../lib/hero-map-markers";
import { HomeHeroMap } from "../../components/home-hero-map";

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
  // bounds, projected onto the stylized SVG canvas. A failed fetch means the
  // map simply renders without pills.
  const heroCity = resolveHomeCity({ cookieCity: null, geoCity: null });
  let heroPins: HeroPin[] = [];
  try {
    heroPins = await fetchApi<HeroPin[]>(
      `/listings/search/map?sw_lat=${heroCity.bounds.sw.lat}&sw_lng=${heroCity.bounds.sw.lng}` +
        `&ne_lat=${heroCity.bounds.ne.lat}&ne_lng=${heroCity.bounds.ne.lng}&limit=80`,
      undefined,
      { revalidate }
    );
  } catch {
    /* markers simply don't render */
  }
  const heroMarkers = selectHeroMarkers(heroPins, heroCity.bounds);

  const [homesBucket, allLucknowBucket, verifiedLucknowBucket, cityBuckets] = await Promise.all([
    safeFetchListingBucket("city=lucknow&listing_type=flat_house&sort=verified&page=1"),
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
  const cityTotals = new Map(cityBuckets.map((city) => [city.slug, city.total]));
  const listingHref = (listing: ListingCardData) =>
    listing.listing_type === "pg" && listing.city
      ? `/${params.locale}/pg/${listing.city}/${listing.id}`
      : `/${params.locale}/listing/${listing.id}`;

  const listingsTotal = allLucknowBucket.total;
  const verifiedTotal = verifiedLucknowBucket.total;
  const verifiedPct = listingsTotal > 0 ? Math.round((verifiedTotal / listingsTotal) * 100) : null;
  const heroCount = verifiedTotal > 0 ? verifiedTotal : listingsTotal;
  const featuredListing =
    homesBucket.items.find(
      (l) => l.cover_photo && l.verification_status === "verified" && (l.monthly_rent ?? 0) > 0
    ) ?? null;

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
        <HomeHeroMap
          markers={heroMarkers}
          featured={featuredListing}
          featuredHref={featuredListing ? listingHref(featuredListing) : null}
          locale={params.locale}
        />
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
                  <strong>{heroCount} सत्यापित घर</strong> अभी लखनऊ में लाइव हैं — फोटो, किराया और
                  मालिक, सब जांचे हुए।
                </>
              ) : (
                <>
                  <strong>{heroCount} verified homes</strong> are live in Lucknow right now —
                  photos, rent, and owner checked.
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
              <Mic size={13} />{" "}
              {isHindi ? "हिंदी + English वॉइस खोज" : "हिंदी + English voice search"}
            </span>
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
              {CITIES.filter((city) => (cityTotals.get(city.name.toLowerCase()) ?? 0) > 0).map(
                (city) => {
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
                }
              )}
            </div>

            {CITIES.some((city) => (cityTotals.get(city.name.toLowerCase()) ?? 0) === 0) && (
              <div className="home-city-soon">
                <span className="home-city-soon__label">
                  {isHindi ? "आगे विस्तार:" : "Expanding next:"}
                </span>
                {CITIES.filter((city) => (cityTotals.get(city.name.toLowerCase()) ?? 0) === 0).map(
                  (city) => (
                    <Link
                      key={city.name}
                      href={`/${params.locale}/city/${city.name.toLowerCase()}` as Route}
                      className="home-city-soon__chip"
                    >
                      {city.name}
                    </Link>
                  )
                )}
              </div>
            )}
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Live homes rail ── */}
      {homesBucket.items.length > 0 && (
        <AnimateOnScroll>
          <section className="home-section home-section--listings">
            <div className="container home-carousel-stack">
              <ListingCarousel
                locale={params.locale}
                title={isHindi ? "आज ही बात करने लायक घर" : "Homes you can call about today"}
                subtitle={
                  isHindi
                    ? "सीधे लाइव बाज़ार से — मालिक पोस्ट करते हैं, घर किराए पर उठते ही हट जाते हैं।"
                    : "Straight from the live market — updated as owners post and homes get rented."
                }
                viewAllHref={`/${params.locale}/search?city=lucknow&listing_type=flat_house`}
                items={homesBucket.items}
              />
            </div>
          </section>
        </AnimateOnScroll>
      )}

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
