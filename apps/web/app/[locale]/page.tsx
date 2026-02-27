import type { Metadata } from "next";
import { SearchHero } from "../../components/search-hero";
import { SessionBanner } from "../../components/session-banner";
import { t, type Locale } from "../../lib/i18n";
import Link from "next/link";

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
  { name: "Delhi", icon: "🏛️" },
  { name: "Gurugram", icon: "🏙️" },
  { name: "Noida", icon: "🌆" },
  { name: "Ghaziabad", icon: "🏘️" },
  { name: "Faridabad", icon: "🏗️" },
  { name: "Chandigarh", icon: "🌳" },
  { name: "Jaipur", icon: "🏰" },
  { name: "Lucknow", icon: "🕌" }
];

const HOW_IT_WORKS = [
  {
    icon: "🔍",
    title: "Search Naturally",
    desc: "Type or speak what you need — our AI understands context, budget, and preferences."
  },
  {
    icon: "✅",
    title: "Verified Listings",
    desc: "Every owner is verified. No fake listings, no brokers, no hidden charges."
  },
  {
    icon: "🔑",
    title: "Connect & Move",
    desc: "Unlock owner contacts instantly. 12-hour refund if no response."
  }
];

export default function HomePage({ params }: { params: { locale: Locale } }) {
  const isHindi = params.locale === "hi";

  return (
    <>
      {/* Session Banner */}
      <SessionBanner locale={params.locale} />

      {/* Hero Section */}
      <section className="hero--landing">
        <div className="container">
          <p className="overline" style={{ marginBottom: "var(--space-3)" }}>
            {isHindi ? "AI-संचालित किराया खोज" : "AI-Powered Rental Search"}
          </p>
          <h1 className="display" style={{ maxWidth: 680, margin: "0 auto var(--space-4)" }}>
            {isHindi ? "तेज, भरोसेमंद घर खोज" : "Find your perfect home, verified & hassle-free"}
          </h1>
          <p className="hero-subtitle">
            {isHindi
              ? "AI पीछे काम करता है, अनुभव सरल रहता है। दिल्ली NCR और उत्तर भारत में।"
              : "AI works behind the scenes to match you with verified rentals across Delhi NCR and North India. No brokers, no fake listings."}
          </p>

          {/* Search */}
          <div className="hero-search-wrap">
            <SearchHero locale={params.locale} />
          </div>

          {/* Trust Strip */}
          <div className="trust-strip" style={{ maxWidth: 680, margin: "0 auto" }}>
            <span className="trust-strip__item">
              <span aria-hidden="true">✅</span>
              {isHindi ? "सत्यापित मकान मालिक" : "Verified Owners"}
            </span>
            <span className="trust-strip__item">
              <span aria-hidden="true">🛡️</span>
              {isHindi ? "12 घंटे की रिफंड गारंटी" : "12-Hour Refund Guarantee"}
            </span>
            <span className="trust-strip__item">
              <span aria-hidden="true">🚫</span>
              {isHindi ? "कोई ब्रोकर नहीं" : "Zero Brokerage"}
            </span>
          </div>
        </div>
      </section>

      {/* Top Cities */}
      <section className="section--sm">
        <div className="section-header">
          <h2>{isHindi ? "लोकप्रिय शहर" : "Top Cities"}</h2>
          <Link href={`/${params.locale}/search`} className="section-header__action">
            {isHindi ? "सभी देखें →" : "View all →"}
          </Link>
        </div>
        <div className="grid grid-4">
          {CITIES.map((city) => (
            <Link
              key={city.name}
              href={`/${params.locale}/city/${city.name.toLowerCase()}`}
              className="city-card"
            >
              <span className="city-card__icon" aria-hidden="true">
                {city.icon}
              </span>
              {city.name}
            </Link>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="section">
        <div className="section-header" style={{ justifyContent: "center" }}>
          <h2>{isHindi ? "यह कैसे काम करता है" : "How It Works"}</h2>
        </div>
        <div className="grid grid-3">
          {HOW_IT_WORKS.map((step, i) => (
            <div key={i} className="feature-card">
              <div className="feature-card__icon" aria-hidden="true">
                {step.icon}
              </div>
              <h3 className="feature-card__title">{isHindi ? step.title : step.title}</h3>
              <p className="feature-card__desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Property Types */}
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
            <div className="feature-card__icon" aria-hidden="true">
              🏠
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
            <div className="feature-card__icon" aria-hidden="true">
              🏢
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
            <div className="feature-card__icon" aria-hidden="true">
              🛋️
            </div>
            <h3 className="feature-card__title">{isHindi ? "फर्निश्ड" : "Furnished Homes"}</h3>
            <p className="feature-card__desc">
              {isHindi ? "सब कुछ तैयार, बस आइए" : "Move-in ready with furniture and appliances"}
            </p>
          </Link>
        </div>
      </section>
    </>
  );
}
