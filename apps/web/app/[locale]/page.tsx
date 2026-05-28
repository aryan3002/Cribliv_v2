import type { Metadata } from "next";
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
  Tent,
  Sofa,
  ArrowRight,
  Sparkles,
  Mic
} from "lucide-react";
import { ListingCarousel } from "../../components/listing-carousel";
import type { ListingCardData } from "../../components/listing-card";

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

const ScrollDownIndicator = dynamic(
  () => import("../../components/scroll-animations").then((mod) => mod.ScrollDownIndicator),
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
    ? "AI-संचालित सत्यापित किराये की खोज। दिल्ली, गुरुग्राम, नोएडा और अन्य शहरों में।"
    : "AI-powered verified rental search. Find flats, PGs, and houses in Delhi, Gurugram, Noida, and more.";

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
    name: "Lucknow",
    photo: "lucknow",
    icon: Tent,
    gradient: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)"
  }
];

const HOW_IT_WORKS = [
  {
    icon: Search,
    title: "Search Naturally",
    titleHi: "स्वाभाविक रूप से खोजें",
    desc: "Type or speak what you need — our AI understands context, budget, and preferences.",
    descHi: "अपनी जरूरत टाइप करें या बोलें — हमारा AI संदर्भ, बजट और प्राथमिकताएं समझता है।",
    color: "brand" as const
  },
  {
    icon: CheckCircle2,
    title: "Verified Listings",
    titleHi: "सत्यापित लिस्टिंग",
    desc: "Every owner is verified. No fake listings, no brokers, no hidden charges.",
    descHi: "हर मालिक सत्यापित है। कोई फर्जी लिस्टिंग नहीं, कोई दलाल नहीं।",
    color: "brand" as const
  },
  {
    icon: KeyRound,
    title: "Connect & Move",
    titleHi: "जुड़ें और शिफ्ट करें",
    desc: "Unlock owner contacts instantly. 12-hour refund if no response.",
    descHi: "मालिक के संपर्क तुरंत अनलॉक करें। 12 घंटे में रिफंड।",
    color: "brand" as const
  }
];

const TESTIMONIALS = [
  {
    name: "Priya S.",
    city: "Noida",
    text: "Found a verified 2BHK in Sector 62 within a day. The owner responded in 2 hours. No broker, no hassle — exactly what Cribliv promises.",
    rating: 5
  },
  {
    name: "Rahul K.",
    city: "Gurugram",
    text: "I was skeptical about paying to unlock contacts, but the 12-hour refund guarantee made me try. Owner was genuine. Saved ₹40k in brokerage.",
    rating: 5
  },
  {
    name: "Sneha M.",
    city: "Delhi",
    text: "The voice search in Hindi is amazing. My parents could search for PGs on their own. Finally, a rental platform that works for everyone.",
    rating: 5
  }
];

const PLATFORM_STATS = [
  { value: "₹0", numericValue: 0, prefix: "₹", suffix: "", label: "Brokerage", labelHi: "दलाली" },
  { value: "100", numericValue: 100, suffix: "%", label: "Owner Verified", labelHi: "सत्यापित मालिक" },
  { value: "12", numericValue: 12, suffix: "hr", label: "Refund Guarantee", labelHi: "रिफंड गारंटी" },
  { value: "8", numericValue: 8, suffix: "+", label: "Cities", labelHi: "शहर" }
];

export default async function HomePage({ params }: { params: { locale: Locale } }) {
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

  async function safeFetchListings(qs: string): Promise<ListingCardData[]> {
    try {
      const res = await fetchApi<ListingsSearchResponse>(`/listings/search?${qs}`, undefined, {
        server: true
      });
      return res.items ?? [];
    } catch {
      return [];
    }
  }

  const [popularHomes, trendingPgs, furnishedHomes] = await Promise.all([
    safeFetchListings("city=lucknow&listing_type=flat_house&sort=verified&page=1"),
    safeFetchListings("city=lucknow&listing_type=pg&sort=newest&page=1"),
    safeFetchListings("city=lucknow&listing_type=flat_house&furnishing=fully_furnished&page=1")
  ]);

  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Cribliv",
    url: BASE_URL,
    logo: `${BASE_URL}/cribliv.png`,
    description:
      "AI-powered verified rental search platform for North India. Find flats, PGs, and houses with owner verification and 12-hour refund guarantee.",
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

      {/* ── Full-bleed Map Hero ── */}
      <section
        className="hero--landing hero--map"
        style={{
          backgroundImage: `linear-gradient(to bottom,
            rgba(4,12,28,0.25) 0%,
            rgba(4,12,28,0.18) 20%,
            rgba(4,12,28,0.40) 50%,
            rgba(4,12,28,0.78) 72%,
            rgba(4,12,28,0.95) 88%,
            rgba(4,12,28,1.00) 100%
          ), url('/images/india-map-hero.jpg')`,
          backgroundSize: "cover",
          backgroundPosition: "center 30%"
        }}
      >
        {/* Animated city pins overlaid on the map */}
        <div className="map-pins-layer" aria-hidden="true">
          <span className="map-pin" style={{ top: "24%", left: "38%" }} title="Delhi" />
          <span
            className="map-pin map-pin--sm"
            style={{ top: "29%", left: "37.5%" }}
            title="Gurugram"
          />
          <span className="map-pin map-pin--sm" style={{ top: "27%", left: "40%" }} title="Noida" />
          <span
            className="map-pin map-pin--sm"
            style={{ top: "25%", left: "41%" }}
            title="Ghaziabad"
          />
          <span
            className="map-pin map-pin--sm"
            style={{ top: "31%", left: "38.5%" }}
            title="Faridabad"
          />
          <span className="map-pin" style={{ top: "18%", left: "33%" }} title="Chandigarh" />
          <span className="map-pin" style={{ top: "36%", left: "31%" }} title="Jaipur" />
          <span className="map-pin" style={{ top: "32%", left: "48%" }} title="Lucknow" />
        </div>

        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <p
            className="overline animate-in"
            style={{
              marginBottom: "var(--space-4)",
              color: "rgba(255,255,255,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6
            }}
          >
            <Sparkles size={14} style={{ color: "rgba(0,180,255,0.7)" }} />
            {isHindi ? "AI-संचालित किराया खोज" : "AI-Powered Rental Search"}
          </p>
          <h1
            className="display animate-in animate-in-delay-1"
            style={{ maxWidth: 720, margin: "0 auto var(--space-5)" }}
          >
            {isHindi ? (
              "तेज, भरोसेमंद घर खोज"
            ) : (
              <>
                Find your perfect home,{" "}
                <span style={{ color: "#4dabff", textDecoration: "none" }}>verified</span> &amp;
                hassle-free
              </>
            )}
          </h1>
          <p
            className="hero-subtitle animate-in animate-in-delay-2"
            style={{ margin: "0 auto var(--space-10)", maxWidth: 560 }}
          >
            {isHindi
              ? "AI पीछे काम करता है, अनुभव सरल रहता है। दिल्ली NCR और उत्तर भारत में।"
              : "AI matches you with verified rentals across Delhi NCR and North India. No brokers, no fake listings, no hidden charges."}
          </p>

          {/* Search */}
          <div className="hero-search-wrap hero-search-glow-wrap animate-in animate-in-delay-3">
            <SearchHero locale={params.locale} />
          </div>

          {/* Trust Strip — glassmorphism */}
          <div
            className="trust-strip animate-in animate-in-delay-4"
            style={{
              maxWidth: 640,
              margin: "var(--space-10) auto 0",
              background: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "rgba(255,255,255,0.85)",
              borderRadius: "var(--radius-full)"
            }}
          >
            <span className="trust-strip__item">
              <ShieldCheck size={16} style={{ color: "#4dabff" }} aria-hidden="true" />
              {isHindi ? "सत्यापित मकान मालिक" : "Verified Owners"}
            </span>
            <span className="trust-strip__item">
              <Clock size={16} style={{ color: "#4dabff" }} aria-hidden="true" />
              {isHindi ? "12 घंटे की रिफंड गारंटी" : "12-Hour Refund"}
            </span>
            <span className="trust-strip__item">
              <BadgeIndianRupee size={16} style={{ color: "#4dabff" }} aria-hidden="true" />
              {isHindi ? "कोई ब्रोकर नहीं" : "Zero Brokerage"}
            </span>
          </div>

          {/* Scroll Down Indicator */}
          <ScrollDownIndicator />
        </div>
      </section>

      {/* Fade from hero into content */}
      <div
        aria-hidden="true"
        style={{
          height: 80,
          marginTop: -80,
          background: "linear-gradient(to bottom, transparent, var(--surface-page, #f8fafc))",
          position: "relative",
          zIndex: 1,
          pointerEvents: "none"
        }}
      />

      {/* ── Top Cities — Blueprint Map Cards ── */}
      <AnimateOnScroll>
        <section className="section--sm">
          <div className="section-header">
            <div>
              <p
                className="overline"
                style={{ marginBottom: "var(--space-1)", color: "var(--brand)" }}
              >
                {isHindi ? "शहर खोजें" : "Top Locations"}
              </p>
              <h2>{isHindi ? "लोकप्रिय शहर" : "Explore Top Cities"}</h2>
            </div>
            <Link href={`/${params.locale}/search`} className="section-header__action">
              {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-4 cities-grid">
            {CITIES.map((city) => {
              return (
                <Link
                  key={city.name}
                  href={`/${params.locale}/city/${city.name.toLowerCase()}`}
                  className="city-card city-card--map"
                  style={{ textDecoration: "none" }}
                >
                  <div
                    className="city-card__map-bg"
                    style={{
                      backgroundImage: `linear-gradient(
                        rgba(4,12,28,0.52) 0%,
                        rgba(4,12,28,0.44) 100%
                      ), url('/images/cities/${city.name.toLowerCase()}-map.jpg')`,
                      backgroundSize: "cover",
                      backgroundPosition: "center"
                    }}
                  >
                    <div className="city-card__map-center">
                      <span className="city-card__map-title">{city.name.toUpperCase()}</span>
                      <span className="city-card__map-rule" aria-hidden="true" />
                      <span className="city-card__map-brand">CRIBLIV</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Popular Localities ── */}
      {popularLocalities.filter((loc) => loc.city_slug && loc.locality_name).length > 0 && (
        <AnimateOnScroll>
          <section
            className="section--sm"
            style={{ paddingTop: "var(--space-4)", paddingBottom: "var(--space-4)" }}
          >
            <div className="section-header">
              <div>
                <p
                  className="overline"
                  style={{ marginBottom: "var(--space-1)", color: "var(--brand)" }}
                >
                  {isHindi ? "अभी उपलब्ध" : "Featured Listings"}
                </p>
                <h2>{isHindi ? "लखनऊ में लोकप्रिय" : "Popular in Lucknow"}</h2>
              </div>
              <Link
                href={`/${params.locale}/search?city=lucknow`}
                className="section-header__action"
              >
                {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={14} />
              </Link>
            </div>
            <div
              style={{
                display: "flex",
                gap: "var(--space-2)",
                overflowX: "auto",
                paddingBottom: "var(--space-2)",
                scrollbarWidth: "none",
                WebkitOverflowScrolling: "touch"
              }}
            >
              {popularLocalities
                .filter((loc) => loc.city_slug && loc.locality_name)
                .map((loc) => (
                  <Link
                    key={loc.locality_id}
                    href={`/${params.locale}/search?city=${loc.city_slug ?? "lucknow"}&q=${encodeURIComponent(loc.locality_name ?? "")}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 14px",
                      borderRadius: "var(--radius-full)",
                      background: "var(--surface-2, #f3f4f6)",
                      border: "1px solid var(--border)",
                      fontSize: 14,
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      textDecoration: "none",
                      transition: "background 0.15s"
                    }}
                  >
                    <MapPin size={13} style={{ color: "var(--brand)" }} />
                    {loc.locality_name}
                    <span style={{ fontSize: 12, color: "var(--text-tertiary)", fontWeight: 400 }}>
                      {loc.listing_count}
                    </span>
                  </Link>
                ))}
            </div>
          </section>
        </AnimateOnScroll>
      )}

      {/* ── Lucknow listing carousels (Airbnb-style rows) ── */}
      {popularHomes.length > 0 && (
        <AnimateOnScroll delay={100}>
          <div className="container">
            <ListingCarousel
              locale={params.locale}
              title={isHindi ? "लखनऊ में लोकप्रिय घर" : "Popular homes in Lucknow"}
              subtitle={
                isHindi
                  ? "सत्यापित मालिकों से, बिना दलाली"
                  : "Hand-picked verified flats and houses"
              }
              viewAllHref={`/${params.locale}/search?city=lucknow&listing_type=flat_house`}
              items={popularHomes}
            />
          </div>
        </AnimateOnScroll>
      )}

      {trendingPgs.length > 0 && (
        <AnimateOnScroll delay={100}>
          <div className="container">
            <ListingCarousel
              locale={params.locale}
              title={isHindi ? "लखनऊ में ट्रेंडिंग PG" : "Trending PGs in Lucknow"}
              subtitle={
                isHindi
                  ? "खाने, वाईफाई और साझा सुविधाओं के साथ"
                  : "With meals, WiFi and shared amenities"
              }
              viewAllHref={`/${params.locale}/search?city=lucknow&listing_type=pg`}
              items={trendingPgs}
            />
          </div>
        </AnimateOnScroll>
      )}

      {furnishedHomes.length > 0 && (
        <AnimateOnScroll delay={100}>
          <div className="container">
            <ListingCarousel
              locale={params.locale}
              title={isHindi ? "फर्निश्ड घर — लखनऊ" : "Furnished homes in Lucknow"}
              subtitle={
                isHindi ? "सब कुछ तैयार, बस आइए" : "Move-in ready with furniture and appliances"
              }
              viewAllHref={`/${params.locale}/search?city=lucknow&listing_type=flat_house&furnishing=fully_furnished`}
              items={furnishedHomes}
            />
          </div>
        </AnimateOnScroll>
      )}

      {/* ── How It Works ── */}
      <AnimateOnScroll delay={100}>
        <section
          style={{
            background: "var(--surface)",
            padding: "var(--space-16) 0",
            width: "100%"
          }}
        >
          <div className="container">
            <div className="edi-head">
              <div>
                <span className="edi-eyebrow">{isHindi ? "सरल प्रक्रिया" : "How It Works"}</span>
                <h2 className="edi-title">
                  {isHindi ? "तीन कदम. कोई दलाल नहीं." : "Three steps. No brokers. No games."}
                </h2>
              </div>
              <p className="edi-lede">
                {isHindi
                  ? "खोजें, सत्यापित मालिक से जुड़ें, और शिफ्ट करें — बस इतना ही।"
                  : "Search it, unlock a verified owner, move in. That's the whole thing."}
              </p>
            </div>
            <div className="hiw">
              {HOW_IT_WORKS.map((step, i) => {
                const Icon = step.icon;
                return (
                  <div key={i} className="hiw-step">
                    <div className="hiw-num" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    <div className="hiw-step__head">
                      <span className="hiw-icon" aria-hidden="true">
                        <Icon size={20} />
                      </span>
                      <h3>{isHindi ? step.titleHi : step.title}</h3>
                    </div>
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
        <section className="section--sm">
          <div className="edi-head">
            <div>
              <span className="edi-eyebrow">{isHindi ? "AI से संचालित" : "Powered by AI"}</span>
              <h2 className="edi-title">
                {isHindi ? "खोजें, लिस्ट करें, एक्सप्लोर करें — AI के साथ" : "Find, list, and explore — with AI"}
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
              href={`/${params.locale}/map`}
              className="ai-feature ai-feature--featured"
              style={{
                backgroundImage:
                  "linear-gradient(180deg, rgba(8,18,38,0.20) 0%, rgba(8,18,38,0.55) 55%, rgba(8,18,38,0.92) 100%), url('/images/india-map-hero.jpg')"
              }}
            >
              <div className="ai-feature__pins" aria-hidden="true">
                <span className="ai-feature__pin" style={{ top: "28%", left: "32%" }} />
                <span className="ai-feature__pin ai-feature__pin--2" style={{ top: "44%", left: "58%" }} />
                <span className="ai-feature__pin ai-feature__pin--3" style={{ top: "62%", left: "40%" }} />
              </div>
              <span className="ai-pill">{isHindi ? "नया" : "New"}</span>
              <h3 className="ai-feature__title">CriblMap</h3>
              <p className="ai-feature__desc">
                {isHindi
                  ? "सत्यापित किराये एक लाइव नक्शे पर देखें — किराये के रुझान, मेट्रो की दूरी और इलाके की जानकारी।"
                  : "See verified rentals on a live map — rent trends, metro distance, and area insights at a glance."}
              </p>
              <span className="ai-feature__cta">
                {isHindi ? "CriblMap खोलें" : "Open CriblMap"} <ArrowRight size={14} />
              </span>
            </Link>

            {/* Maya — voice listing agent */}
            <Link href={`/${params.locale}/owner/listings/new`} className="ai-feature">
              <div className="ai-mini-mic" aria-hidden="true">
                <Mic size={22} />
              </div>
              <span className="ai-pill">{isHindi ? "AI वॉइस" : "AI Voice"}</span>
              <h3 className="ai-feature__title">{isHindi ? "Maya — आपकी वॉइस लिस्टिंग एजेंट" : "Maya, your voice listing agent"}</h3>
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
            <Link href={`/${params.locale}/search`} className="ai-feature">
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
              <h3 className="ai-feature__title">{isHindi ? "जैसे बोलते हैं वैसे खोजें" : "Search the way you talk"}</h3>
              <p className="ai-feature__desc">
                {isHindi
                  ? "अंग्रेज़ी या हिंदी में लिखें या बोलें — हमारा AI इसे सही फ़िल्टर में बदल देता है।"
                  : "Type or speak in English or Hindi — our AI turns it into the right filters."}
              </p>
              <span className="ai-feature__cta">
                {isHindi ? "अभी खोजें" : "Start searching"} <ArrowRight size={14} />
              </span>
            </Link>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Browse by Type ── */}
      <AnimateOnScroll delay={100}>
        <section className="section--sm">
          <div className="edi-head">
            <div>
              <span className="edi-eyebrow">{isHindi ? "संपत्ति प्रकार" : "Browse by Type"}</span>
              <h2 className="edi-title">
                {isHindi ? "आप किस तरह रहना चाहते हैं?" : "What kind of place are you after?"}
              </h2>
            </div>
            <Link href={`/${params.locale}/search`} className="edi-head__action">
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
                  ? "1BHK से 4BHK तक — अपार्टमेंट और स्वतंत्र मकान, सीधे मालिक से।"
                  : "1BHK to 4BHK apartments and independent houses, straight from verified owners.",
                bg: "var(--brand-light)"
              },
              {
                href: `/${params.locale}/search?listing_type=pg`,
                icon: Home,
                color: "accent" as const,
                featured: false,
                title: isHindi ? "PG और हॉस्टल" : "PGs & Hostels",
                desc: isHindi ? "खाने, वाईफाई और साझा सुविधाओं के साथ" : "Meals, WiFi, and shared amenities",
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
                  href={item.href as `/${string}`}
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
        </section>
      </AnimateOnScroll>

      {/* ── Social Proof Stats ── */}
      <AnimateOnScroll delay={100}>
        <section className="section--sm">
          <div className="impact">
            <div className="impact__intro">
              <span className="edi-eyebrow edi-eyebrow--light">
                {isHindi ? "हमारे आंकड़े" : "Our Impact"}
              </span>
              <h2 className="edi-title edi-title--light">
                {isHindi
                  ? "उत्तर भारत के किरायेदारों का भरोसा"
                  : "Trusted by renters across North India"}
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
                  ? "हर लिस्टिंग सत्यापित, हर मालिक असली — और कोई दलाली नहीं।"
                  : "Every listing verified, every owner real — and not a rupee in brokerage."}
              </p>
            </div>

            <div className="impact-grid">
              {PLATFORM_STATS.map((stat, i) => (
                <div key={stat.label} className="impact-stat">
                  <div className="impact-stat__num">
                    {stat.label === "Brokerage" ? (
                      "₹0"
                    ) : (
                      <CountUp
                        value={stat.numericValue}
                        prefix={stat.prefix || ""}
                        suffix={stat.suffix || ""}
                        duration={1400 + i * 200}
                      />
                    )}
                  </div>
                  <div className="impact-stat__label">
                    {isHindi ? stat.labelHi : stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Testimonials ── */}
      <AnimateOnScroll delay={100}>
        <section
          style={{
            background: "var(--surface)",
            padding: "var(--space-16) 0",
            width: "100%"
          }}
        >
          <div className="container">
            <div className="edi-head">
              <div>
                <span className="edi-eyebrow">{isHindi ? "किरायेदारों की राय" : "Loved by Tenants"}</span>
                <h2 className="edi-title">{isHindi ? "वे क्या कहते हैं" : "What renters say"}</h2>
              </div>
              <p className="edi-lede">
                {isHindi
                  ? "असली किरायेदार, असली घर — Cribliv के ज़रिए।"
                  : "Real tenants who found their home through Cribliv."}
              </p>
            </div>
            <div className="voices-grid">
              {(() => {
                const renderStars = (rating: number) => (
                  <div className="voices-stars" aria-hidden="true">
                    {Array.from({ length: rating }).map((_, i) => (
                      <svg key={i} width="15" height="15" viewBox="0 0 24 24" fill="var(--amber)">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    ))}
                  </div>
                );
                const renderAuthor = (testimonial: (typeof TESTIMONIALS)[number], idx: number) => (
                  <div className="voices-author">
                    <div className={`testimonial-avatar testimonial-avatar--${(idx % 3) + 1}`}>
                      {testimonial.name.charAt(0)}
                    </div>
                    <div>
                      <div className="voices-author__name">{testimonial.name}</div>
                      <div className="voices-author__city">
                        <MapPin size={10} />
                        {testimonial.city}
                      </div>
                    </div>
                  </div>
                );
                const featured = TESTIMONIALS[0];
                const rest = TESTIMONIALS.slice(1);
                return (
                  <>
                    <div className="voices-quote voices-quote--featured">
                      <div>
                        <div className="voices-mark" aria-hidden="true">
                          &ldquo;
                        </div>
                        {renderStars(featured.rating)}
                        <p className="voices-text">{featured.text}</p>
                      </div>
                      {renderAuthor(featured, 0)}
                    </div>
                    <div className="voices-col">
                      {rest.map((testimonial, i) => (
                        <div key={testimonial.name} className="voices-quote">
                          <div>
                            {renderStars(testimonial.rating)}
                            <p className="voices-text">&ldquo;{testimonial.text}&rdquo;</p>
                          </div>
                          {renderAuthor(testimonial, i + 1)}
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── CTA Banner ── */}
      <div className="container" style={{ paddingBottom: "var(--space-4)" }}>
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
            <h2>{isHindi ? "प्रॉपर्टी है? मुफ़्त में लिस्ट करें" : "Own a property? List it free."}</h2>
            <p>
              {isHindi
                ? "5 मिनट में AI-सत्यापित लिस्टिंग बनाएं और भरोसेमंद किरायेदारों से सीधे जुड़ें।"
                : "Create an AI-verified listing in under 5 minutes and connect directly with trusted tenants across North India."}
            </p>
            <Link href={`/${params.locale}/owner/dashboard`} className="btn btn--lg">
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
