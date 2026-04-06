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
  Sparkles
} from "lucide-react";

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
    color: "trust" as const
  },
  {
    icon: KeyRound,
    title: "Connect & Move",
    titleHi: "जुड़ें और शिफ्ट करें",
    desc: "Unlock owner contacts instantly. 12-hour refund if no response.",
    descHi: "मालिक के संपर्क तुरंत अनलॉक करें। 12 घंटे में रिफंड।",
    color: "accent" as const
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
  { value: "8", numericValue: 8, suffix: "+", label: "Cities" },
  { value: "100", numericValue: 100, suffix: "%", label: "Owner Verified" },
  { value: "12", numericValue: 12, suffix: "hr", label: "Refund Guarantee" },
  { value: "₹0", numericValue: 0, prefix: "₹", suffix: "", label: "Brokerage" }
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

      {/* ── Full-bleed Hero ── */}
      <section
        className="hero--landing"
        style={{
          backgroundImage: "url('/images/ui/hero-bg.jpg')",
          backgroundSize: "cover",
          backgroundPosition: "center top",
          backgroundBlendMode: "luminosity"
        }}
      >
        <div className="hero-glow" aria-hidden="true" />
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
            <Sparkles size={14} style={{ color: "rgba(255,255,255,0.6)" }} />
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
                <span className="highlight-word" style={{ color: "var(--accent)" }}>
                  verified
                </span>{" "}
                &amp; hassle-free
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
          <div className="hero-search-wrap animate-in animate-in-delay-3">
            <SearchHero locale={params.locale} />
          </div>

          {/* Trust Strip */}
          <div
            className="trust-strip animate-in animate-in-delay-4"
            style={{
              maxWidth: 640,
              margin: "var(--space-10) auto 0",
              background: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(12px)",
              color: "rgba(255,255,255,0.8)",
              borderRadius: "var(--radius-full)"
            }}
          >
            <span className="trust-strip__item">
              <ShieldCheck size={16} aria-hidden="true" />
              {isHindi ? "सत्यापित मकान मालिक" : "Verified Owners"}
            </span>
            <span className="trust-strip__item">
              <Clock size={16} aria-hidden="true" />
              {isHindi ? "12 घंटे की रिफंड गारंटी" : "12-Hour Refund"}
            </span>
            <span className="trust-strip__item">
              <BadgeIndianRupee size={16} aria-hidden="true" />
              {isHindi ? "कोई ब्रोकर नहीं" : "Zero Brokerage"}
            </span>
          </div>

          {/* Scroll Down Indicator */}
          <ScrollDownIndicator />
        </div>
      </section>

      {/* ── Top Cities ── */}
      <AnimateOnScroll>
        <section className="section--sm">
          <div className="section-header">
            <h2>{isHindi ? "लोकप्रिय शहर" : "Explore Top Cities"}</h2>
            <Link href={`/${params.locale}/search`} className="section-header__action">
              {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-4 cities-grid">
            {CITIES.map((city) => (
              <Link
                key={city.name}
                href={`/${params.locale}/city/${city.name.toLowerCase()}`}
                className="city-card city-card--photo"
                style={{ textDecoration: "none" }}
              >
                <div
                  style={{
                    backgroundImage: `url('/images/cities/${city.photo}.jpg')`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    borderRadius: "var(--radius-lg)",
                    height: 180,
                    width: "100%",
                    position: "relative",
                    overflow: "hidden"
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.05) 100%)"
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      bottom: 14,
                      left: 14,
                      right: 14,
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "space-between"
                    }}
                  >
                    <span
                      style={{
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 17,
                        textShadow: "0 1px 6px rgba(0,0,0,0.5)",
                        letterSpacing: "-0.01em"
                      }}
                    >
                      {city.name}
                    </span>
                    <span
                      style={{
                        color: "rgba(255,255,255,0.85)",
                        fontSize: 12,
                        fontWeight: 500,
                        display: "flex",
                        alignItems: "center",
                        gap: 3
                      }}
                    >
                      <ArrowRight size={12} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Popular Localities ── */}
      {popularLocalities.length > 0 && (
        <AnimateOnScroll>
          <section
            className="section--sm"
            style={{ paddingTop: "var(--space-4)", paddingBottom: "var(--space-4)" }}
          >
            <div className="section-header">
              <h2>{isHindi ? "लखनऊ में लोकप्रिय" : "Popular in Lucknow"}</h2>
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
              {popularLocalities.map((loc) => (
                <Link
                  key={loc.locality_id}
                  href={`/${params.locale}/search?city=${loc.city_slug}&q=${encodeURIComponent(loc.locality_name)}`}
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

      {/* ── How It Works ── */}
      <AnimateOnScroll delay={100}>
        <section className="section section--alt" style={{ padding: "var(--space-16) 0" }}>
          <div
            className="section-header"
            style={{
              justifyContent: "center",
              maxWidth: "var(--container-max)",
              margin: "0 auto var(--space-10)",
              paddingLeft: "var(--space-6)",
              paddingRight: "var(--space-6)"
            }}
          >
            <div style={{ textAlign: "center" }}>
              <p
                className="overline"
                style={{ marginBottom: "var(--space-2)", color: "var(--brand)" }}
              >
                {isHindi ? "सरल प्रक्रिया" : "Simple Process"}
              </p>
              <h2 style={{ fontSize: 28, letterSpacing: "-0.02em" }}>
                {isHindi ? "यह कैसे काम करता है" : "How It Works"}
              </h2>
              <p
                className="text-secondary"
                style={{
                  marginTop: "var(--space-3)",
                  fontSize: 15,
                  maxWidth: 480,
                  marginLeft: "auto",
                  marginRight: "auto"
                }}
              >
                {isHindi
                  ? "तीन आसान चरणों में अपना सपनों का घर खोजें"
                  : "Find your dream home in three simple steps — no brokers, no hassle"}
              </p>
            </div>
          </div>
          <div
            className="grid grid-3"
            style={{
              maxWidth: "var(--container-max)",
              margin: "0 auto",
              paddingLeft: "var(--space-6)",
              paddingRight: "var(--space-6)"
            }}
          >
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div
                  key={i}
                  className="feature-card"
                  style={{
                    position: "relative",
                    padding: "var(--space-8) var(--space-6)",
                    borderTop: `3px solid var(--${step.color})`
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: -14,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      background: `var(--${step.color})`,
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                      fontWeight: 700,
                      boxShadow: `0 2px 8px color-mix(in srgb, var(--${step.color}) 40%, transparent)`
                    }}
                  >
                    {i + 1}
                  </span>
                  <div
                    className={`icon-circle icon-circle--${step.color}`}
                    style={{ margin: "var(--space-2) auto var(--space-4)", width: 56, height: 56 }}
                    aria-hidden="true"
                  >
                    <Icon size={26} />
                  </div>
                  <h3
                    className="feature-card__title"
                    style={{ fontSize: 17, marginBottom: "var(--space-2)" }}
                  >
                    {isHindi ? step.titleHi : step.title}
                  </h3>
                  <p className="feature-card__desc" style={{ lineHeight: 1.6 }}>
                    {isHindi ? step.descHi : step.desc}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Browse by Type ── */}
      <AnimateOnScroll delay={100}>
        <section className="section--sm">
          <div className="section-header">
            <h2>{isHindi ? "किराये के प्रकार" : "Browse by Type"}</h2>
            <Link href={`/${params.locale}/search`} className="section-header__action">
              {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={14} />
            </Link>
          </div>
          <div className="grid grid-3">
            {[
              {
                href: `/${params.locale}/search?listing_type=flat_house`,
                icon: Building,
                color: "brand" as const,
                title: isHindi ? "फ्लैट और मकान" : "Flats & Houses",
                desc: isHindi
                  ? "1BHK से 4BHK तक"
                  : "1BHK to 4BHK apartments and independent houses",
                gradient: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)"
              },
              {
                href: `/${params.locale}/search?listing_type=pg`,
                icon: Home,
                color: "accent" as const,
                title: isHindi ? "PG और हॉस्टल" : "PGs & Hostels",
                desc: isHindi ? "खाने और वाईफाई के साथ" : "With meals, WiFi, and shared amenities",
                gradient: "linear-gradient(135deg, #fef2f2 0%, #fecaca 100%)"
              },
              {
                href: `/${params.locale}/search?listing_type=flat_house&furnished=true`,
                icon: Sofa,
                color: "amber" as const,
                title: isHindi ? "फर्निश्ड" : "Furnished Homes",
                desc: isHindi
                  ? "सब कुछ तैयार, बस आइए"
                  : "Move-in ready with furniture and appliances",
                gradient: "linear-gradient(135deg, #fffbeb 0%, #fde68a 100%)"
              }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.title}
                  href={item.href as `/${string}`}
                  className="feature-card"
                  style={{
                    textDecoration: "none",
                    background: item.gradient,
                    border: "none",
                    padding: "var(--space-8) var(--space-6)",
                    transition: "transform 0.2s, box-shadow 0.2s"
                  }}
                >
                  <div
                    className={`icon-circle icon-circle--${item.color}`}
                    style={{ margin: "0 auto var(--space-4)", width: 56, height: 56 }}
                    aria-hidden="true"
                  >
                    <Icon size={26} />
                  </div>
                  <h3 className="feature-card__title" style={{ fontSize: 17 }}>
                    {item.title}
                  </h3>
                  <p className="feature-card__desc">{item.desc}</p>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: "var(--space-3)",
                      fontSize: 13,
                      fontWeight: 600,
                      color: `var(--${item.color})`
                    }}
                  >
                    {isHindi ? "खोजें" : "Explore"} <ArrowRight size={13} />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Social Proof Stats ── */}
      <AnimateOnScroll delay={100}>
        <section
          style={{
            background: "linear-gradient(135deg, #080E1A 0%, #0B1E42 50%, #0044AA 100%)",
            padding: "var(--space-14) 0"
          }}
        >
          <div
            style={{
              maxWidth: "var(--container-max)",
              margin: "0 auto",
              paddingLeft: "var(--space-6)",
              paddingRight: "var(--space-6)"
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "var(--space-8)" }}>
              <h2
                style={{ color: "#fff", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}
              >
                {isHindi ? "हमारे आंकड़े" : "Trusted by Renters Across North India"}
              </h2>
            </div>
            <div className="grid grid-4">
              {PLATFORM_STATS.map((stat, i) => (
                <div
                  key={stat.label}
                  style={{
                    textAlign: "center",
                    padding: "var(--space-6)",
                    borderRadius: "var(--radius-lg)",
                    background: "rgba(255,255,255,0.06)",
                    backdropFilter: "blur(8px)",
                    border: "1px solid rgba(255,255,255,0.08)"
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 36,
                      fontWeight: 800,
                      color: "#fff",
                      lineHeight: 1
                    }}
                  >
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
                  <div
                    style={{
                      marginTop: "var(--space-2)",
                      fontSize: 14,
                      color: "rgba(255,255,255,0.65)",
                      fontWeight: 500
                    }}
                  >
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── Testimonials ── */}
      <AnimateOnScroll delay={100}>
        <section className="section section--alt" style={{ padding: "var(--space-14) 0" }}>
          <div
            style={{
              maxWidth: "var(--container-max)",
              margin: "0 auto",
              paddingLeft: "var(--space-6)",
              paddingRight: "var(--space-6)"
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "var(--space-10)" }}>
              <p
                className="overline"
                style={{ marginBottom: "var(--space-2)", color: "var(--brand)" }}
              >
                {isHindi ? "किरायेदारों की राय" : "Loved by Tenants"}
              </p>
              <h2>{isHindi ? "वे क्या कहते हैं" : "What Renters Say"}</h2>
            </div>
            <div className="grid grid-3">
              {TESTIMONIALS.map((testimonial, idx) => (
                <div key={testimonial.name} className="feature-card" style={{ textAlign: "left" }}>
                  <div style={{ display: "flex", gap: 2, marginBottom: "var(--space-3)" }}>
                    {Array.from({ length: testimonial.rating }).map((_, i) => (
                      <svg
                        key={i}
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="var(--amber)"
                        aria-hidden="true"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    ))}
                  </div>
                  <p
                    className="text-secondary"
                    style={{ lineHeight: 1.65, marginBottom: "var(--space-4)", fontSize: 15 }}
                  >
                    &ldquo;{testimonial.text}&rdquo;
                  </p>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    <div className={`testimonial-avatar testimonial-avatar--${(idx % 3) + 1}`}>
                      {testimonial.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                        {testimonial.name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
                        {testimonial.city}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </AnimateOnScroll>

      {/* ── CTA Banner ── */}
      <section
        className="cta-banner"
        style={{ marginLeft: "var(--space-6)", marginRight: "var(--space-6)" }}
      >
        <h2>{isHindi ? "अपनी प्रॉपर्टी लिस्ट करें" : "Own a property? List it free"}</h2>
        <p>
          {isHindi
            ? "AI-सत्यापित लिस्टिंग बनाएं और भरोसेमंद किरायेदारों से जुड़ें।"
            : "Create an AI-verified listing in under 5 minutes and connect with trusted tenants across North India."}
        </p>
        <Link href={`/${params.locale}/owner/dashboard`} className="btn btn--lg">
          {isHindi ? "अभी लिस्ट करें" : "List Your Property"}
          <ArrowRight size={18} />
        </Link>
      </section>
    </>
  );
}
