import type { Route } from "next";
import dynamic from "next/dynamic";
import Link from "next/link";
import { cookies, headers } from "next/headers";
import { ArrowRight, KeyRound, Mic } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";
import { fetchApi } from "../../lib/api";
import { HOME_CITY_COOKIE, resolveHomeCity } from "../../lib/home-city-config";
import type { HeroPin } from "../../lib/hero-query";
import { ListingCarousel } from "../../components/listing-carousel";
import type { ListingCardData } from "../../components/listing-card";
import { HomeHeroMapArt } from "../../components/home-hero-map-art";

const HomeListeningHero = dynamic(() => import("../../components/home-listening-hero"), {
  ssr: false,
  loading: () => <div style={{ minHeight: 148 }} />
});

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

const CITY_LINKS = [
  "delhi",
  "gurugram",
  "noida",
  "ghaziabad",
  "faridabad",
  "chandigarh",
  "jaipur",
  "lucknow"
];

function fill(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), template);
}

async function safeFetch<T>(path: string, fallback: T): Promise<T> {
  try {
    return await fetchApi<T>(path, undefined, { server: true });
  } catch {
    return fallback;
  }
}

export async function ListeningHomePage({ locale }: { locale: Locale }) {
  const cookieCity = cookies().get(HOME_CITY_COOKIE)?.value ?? null;
  const geoCity = headers().get("x-vercel-ip-city") ?? null;
  const city = resolveHomeCity({ cookieCity, geoCity });
  const cityLabel = city.label[locale] ?? city.label.en;

  const [pins, countRes, homesRes, pgsRes] = await Promise.all([
    safeFetch<HeroPin[]>(
      `/listings/search/map?sw_lat=${city.bounds.sw.lat}&sw_lng=${city.bounds.sw.lng}` +
        `&ne_lat=${city.bounds.ne.lat}&ne_lng=${city.bounds.ne.lng}&limit=80`,
      []
    ),
    safeFetch<{ items: unknown[]; total: number }>(
      `/listings/search?city=${city.slug}&page_size=1&page=1`,
      { items: [], total: 0 }
    ),
    safeFetch<{ items: ListingCardData[] }>(
      `/listings/search?city=${city.slug}&listing_type=flat_house&sort=verified&page=1`,
      { items: [] }
    ),
    safeFetch<{ items: ListingCardData[] }>(
      `/listings/search?city=${city.slug}&listing_type=pg&sort=newest&page=1`,
      { items: [] }
    )
  ]);

  const totalCount = Number.isFinite(countRes.total) ? countRes.total : 0;
  const showCount = totalCount >= city.minHeroInventory;

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
        urlTemplate: `${BASE_URL}/${locale}/search?q={search_term_string}`
      },
      "query-input": "required name=search_term_string"
    }
  };

  const isHindi = locale === "hi";

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

      {/* ── Listening hero ── */}
      {/* Backdrop is a designed inline-SVG dusk map (HomeHeroMapArt) — no
          Maps billing, no network. Layer order matters: art, wash, then pins
          ON TOP so rent labels stay crisp. */}
      <section className="hero-listen" data-submitting="false">
        <div className="hero-listen__backdrop" aria-hidden="true">
          <HomeHeroMapArt />
          <div className="hero-listen__wash" />
          <div className="hero-listen__glow" />
          <div id="hero-listen-pins" className="hero-listen__pins" />
        </div>
        <div className="hero-listen__glass">
          <h1 className="hero-listen__title">{t(locale, "listenHeroTitle")}</h1>
          <p className="hero-listen__sub">
            {fill(t(locale, "listenHeroSub"), { city: cityLabel })}
          </p>
          <HomeListeningHero
            locale={locale}
            city={city}
            pins={pins}
            totalCount={totalCount}
            showCount={showCount}
          />
        </div>
      </section>

      {/* ── Live listings ── */}
      {(homesRes.items.length > 0 || pgsRes.items.length > 0) && (
        <section className="home-section home-section--listings">
          <div className="container home-carousel-stack">
            {homesRes.items.length > 0 && (
              <ListingCarousel
                locale={locale}
                title={isHindi ? `${cityLabel} में लाइव घर` : `Live homes in ${cityLabel}`}
                viewAllHref={`/${locale}/search?city=${city.slug}&listing_type=flat_house`}
                items={homesRes.items}
              />
            )}
            {pgsRes.items.length > 0 && (
              <ListingCarousel
                locale={locale}
                title={isHindi ? `${cityLabel} में नए PG` : `Latest PGs in ${cityLabel}`}
                viewAllHref={`/${locale}/pg/${city.slug}`}
                items={pgsRes.items}
              />
            )}
          </div>
        </section>
      )}

      {/* ── Maya showcase ── */}
      <section className="home-section maya-band-section">
        <div className="container">
          <div className="maya-band">
            <div className="maya-band__copy">
              <span className="maya-band__eyebrow">{isHindi ? "AI वॉइस" : "AI Voice"}</span>
              <h2 className="maya-band__title">{t(locale, "mayaSectionTitle")}</h2>
              <p className="maya-band__sub">{t(locale, "mayaSectionSub")}</p>
              <Link href={`/${locale}/owner/listings/new` as Route} className="maya-band__cta">
                {t(locale, "mayaSectionCta")} <ArrowRight size={16} />
              </Link>
            </div>
            <div className="maya-band__stage" aria-hidden="true">
              <div className="maya-band__orb">
                <span className="maya-band__ring" />
                <span className="maya-band__ring maya-band__ring--2" />
                <Mic size={26} />
              </div>
              <div className="maya-band__bubble maya-band__bubble--maya">
                नमस्ते! मैं Maya हूँ, boliye…
              </div>
              <div className="maya-band__bubble maya-band__bubble--user">
                &ldquo;2BHK, Gomti Nagar, semi-furnished&rdquo;
              </div>
              <div className="maya-band__bubble maya-band__bubble--field">
                <span className="maya-band__check">✓</span> BHK · Locality · Rent filled
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Owner CTA ── */}
      <div className="container home-cta-wrap">
        <section className="cta-banner" style={{ margin: 0 }}>
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
            <Link href={`/${locale}/owner/dashboard` as Route} className="btn btn--lg">
              {isHindi ? "अभी लिस्ट करें" : "List Your Property"}
              <ArrowRight size={18} />
            </Link>
          </div>
          <div className="cta-banner__mark" aria-hidden="true">
            <KeyRound size="0.78em" strokeWidth={1.25} />
          </div>
        </section>
      </div>

      {/* ── City link strip (SEO internal links to /city pages) ── */}
      <section className="home-city-strip-section">
        <div className="container">
          <p className="home-city-strip__label">{t(locale, "listenHeroCityStrip")}</p>
          <p className="home-city-strip__links">
            {CITY_LINKS.map((slug) => (
              <Link
                key={slug}
                href={`/${locale}/city/${slug}` as Route}
                className="home-city-strip__link"
              >
                {slug.charAt(0).toUpperCase() + slug.slice(1)}
              </Link>
            ))}
          </p>
        </div>
      </section>
    </>
  );
}
