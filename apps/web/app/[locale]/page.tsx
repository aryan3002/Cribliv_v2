import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { t, type Locale } from "../../lib/i18n";
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
  ArrowRight
} from "lucide-react";

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

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: Locale };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi
    ? "Cribliv — तेज, भरोसेमंद घर खोज"
    : "Cribliv — Fast, Trustworthy Home Search in North India";
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
  { name: "Delhi", icon: Landmark, gradient: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" },
  {
    name: "Gurugram",
    icon: Building2,
    gradient: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)"
  },
  { name: "Noida", icon: Building, gradient: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)" },
  { name: "Ghaziabad", icon: Home, gradient: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)" },
  {
    name: "Faridabad",
    icon: MapPin,
    gradient: "linear-gradient(135deg, #fa709a 0%, #fee140 100%)"
  },
  {
    name: "Chandigarh",
    icon: TreePine,
    gradient: "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)"
  },
  { name: "Jaipur", icon: Castle, gradient: "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)" },
  { name: "Lucknow", icon: Tent, gradient: "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)" }
];

const HOW_IT_WORKS = [
  {
    icon: Search,
    title: "Search Naturally",
    desc: "Type or speak what you need — our AI understands context, budget, and preferences.",
    color: "brand" as const
  },
  {
    icon: CheckCircle2,
    title: "Verified Listings",
    desc: "Every owner is verified. No fake listings, no brokers, no hidden charges.",
    color: "trust" as const
  },
  {
    icon: KeyRound,
    title: "Connect & Move",
    desc: "Unlock owner contacts instantly. 12-hour refund if no response.",
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
  { value: "8+", label: "Cities" },
  { value: "100%", label: "Owner Verified" },
  { value: "12hr", label: "Refund Guarantee" },
  { value: "₹0", label: "Brokerage" }
];

export default function HomePage({ params }: { params: { locale: Locale } }) {
  const isHindi = params.locale === "hi";

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
      <section className="hero--landing">
        <div className="hero-glow" aria-hidden="true" />
        <div className="container" style={{ position: "relative", zIndex: 1 }}>
          <p
            className="overline animate-in"
            style={{ marginBottom: "var(--space-4)", color: "rgba(255,255,255,0.5)" }}
          >
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
        </div>
      </section>

      {/* ── Top Cities ── */}
      <section className="section--sm">
        <div className="section-header">
          <h2>{isHindi ? "लोकप्रिय शहर" : "Explore Top Cities"}</h2>
          <Link href={`/${params.locale}/search`} className="section-header__action">
            {isHindi ? "सभी देखें" : "View all"} <ArrowRight size={14} />
          </Link>
        </div>
        <div className="grid grid-4">
          {CITIES.map((city) => {
            const Icon = city.icon;
            return (
              <Link
                key={city.name}
                href={`/${params.locale}/city/${city.name.toLowerCase()}`}
                className="city-card"
              >
                <span
                  className="icon-circle"
                  style={{ background: city.gradient, color: "#fff", width: 44, height: 44 }}
                  aria-hidden="true"
                >
                  <Icon size={20} />
                </span>
                {city.name}
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="section section--alt" style={{ padding: "var(--space-16) 0" }}>
        <div
          className="section-header"
          style={{
            justifyContent: "center",
            maxWidth: "var(--container-max)",
            margin: "0 auto var(--space-8)",
            paddingLeft: "var(--space-6)",
            paddingRight: "var(--space-6)"
          }}
        >
          <div style={{ textAlign: "center" }}>
            <p
              className="overline"
              style={{ marginBottom: "var(--space-2)", color: "var(--brand)" }}
            >
              Simple Process
            </p>
            <h2>{isHindi ? "यह कैसे काम करता है" : "How It Works"}</h2>
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
              <div key={i} className="feature-card">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    marginBottom: "var(--space-4)",
                    justifyContent: "center"
                  }}
                >
                  <span className={`step-number step-number--${step.color}`}>{i + 1}</span>
                </div>
                <div
                  className={`icon-circle icon-circle--${step.color}`}
                  style={{ margin: "0 auto var(--space-4)" }}
                  aria-hidden="true"
                >
                  <Icon size={24} />
                </div>
                <h3 className="feature-card__title">{step.title}</h3>
                <p className="feature-card__desc">{step.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Browse by Type ── */}
      <section className="section--sm">
        <div className="section-header">
          <h2>{isHindi ? "किराये के प्रकार" : "Browse by Type"}</h2>
        </div>
        <div className="grid grid-3">
          <Link
            href={`/${params.locale}/search?listing_type=flat_house`}
            className="feature-card"
            style={{ textDecoration: "none" }}
          >
            <div
              className="icon-circle icon-circle--brand"
              style={{ margin: "0 auto var(--space-4)" }}
              aria-hidden="true"
            >
              <Building size={24} />
            </div>
            <h3 className="feature-card__title">{isHindi ? "फ्लैट और मकान" : "Flats & Houses"}</h3>
            <p className="feature-card__desc">
              {isHindi ? "1BHK से 4BHK तक" : "1BHK to 4BHK apartments and independent houses"}
            </p>
          </Link>
          <Link
            href={`/${params.locale}/search?listing_type=pg`}
            className="feature-card"
            style={{ textDecoration: "none" }}
          >
            <div
              className="icon-circle icon-circle--accent"
              style={{ margin: "0 auto var(--space-4)" }}
              aria-hidden="true"
            >
              <Home size={24} />
            </div>
            <h3 className="feature-card__title">{isHindi ? "PG और हॉस्टल" : "PGs & Hostels"}</h3>
            <p className="feature-card__desc">
              {isHindi ? "खाने और वाईफाई के साथ" : "With meals, WiFi, and shared amenities"}
            </p>
          </Link>
          <Link
            href={`/${params.locale}/search?listing_type=flat_house&furnished=true`}
            className="feature-card"
            style={{ textDecoration: "none" }}
          >
            <div
              className="icon-circle icon-circle--amber"
              style={{ margin: "0 auto var(--space-4)" }}
              aria-hidden="true"
            >
              <Sofa size={24} />
            </div>
            <h3 className="feature-card__title">{isHindi ? "फर्निश्ड" : "Furnished Homes"}</h3>
            <p className="feature-card__desc">
              {isHindi ? "सब कुछ तैयार, बस आइए" : "Move-in ready with furniture and appliances"}
            </p>
          </Link>
        </div>
      </section>

      {/* ── Social Proof Stats ── */}
      <section
        className="section--sm"
        style={{ paddingTop: "var(--space-12)", paddingBottom: "var(--space-4)" }}
      >
        <div className="grid grid-4">
          {PLATFORM_STATS.map((stat) => (
            <div
              key={stat.label}
              className="feature-card"
              style={{ padding: "var(--space-6)", textAlign: "center" }}
            >
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 32,
                  fontWeight: 800,
                  color: "var(--brand)",
                  lineHeight: 1
                }}
              >
                {stat.value}
              </div>
              <div className="body-sm text-secondary" style={{ marginTop: "var(--space-2)" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Testimonials ── */}
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
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="feature-card" style={{ textAlign: "left" }}>
                <div style={{ display: "flex", gap: 2, marginBottom: "var(--space-3)" }}>
                  {Array.from({ length: t.rating }).map((_, i) => (
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
                  &ldquo;{t.text}&rdquo;
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "var(--brand)",
                      color: "#fff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 13
                    }}
                  >
                    {t.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>
                      {t.name}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{t.city}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

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
