import type { Metadata } from "next";
import { RENT_CITY_CONTENT, type RentCityContent } from "../../../../lib/rent-city-content";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

const CITIES = RENT_CITY_CONTENT;
type CityData = RentCityContent;

export async function generateStaticParams() {
  return Object.keys(CITIES).map((city) => ({ city }));
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; city: string };
}): Promise<Metadata> {
  const city = CITIES[params.city];
  if (!city) return { title: "City Not Found" };

  const isHindi = params.locale === "hi";
  const title = isHindi
    ? `${city.name} में किराये पर फ्लैट और PG: शून्य ब्रोकरेज`
    : `Rent Flats & PGs in ${city.name}: Zero Brokerage, Verified Owners`;
  const description = city.description;

  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/rent-in/${city.slug}`,
      languages: {
        en: `${BASE_URL}/en/rent-in/${city.slug}`,
        hi: `${BASE_URL}/hi/rent-in/${city.slug}`
      }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/rent-in/${city.slug}`,
      siteName: "Cribliv",
      type: "website"
    },
    keywords: [
      `rent in ${city.name}`,
      `flat for rent in ${city.name}`,
      `2BHK in ${city.name}`,
      `PG in ${city.name}`,
      `${city.name} rental`,
      `no broker ${city.name}`,
      `zero brokerage ${city.name}`,
      `house for rent ${city.name}`,
      `room for rent ${city.name}`
    ]
  };
}

function faqJsonLd(city: CityData) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: city.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
}

function breadcrumbJsonLd(locale: string, city: CityData) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${locale}` },
      {
        "@type": "ListItem",
        position: 2,
        name: `Rent in ${city.name}`,
        item: `${BASE_URL}/${locale}/rent-in/${city.slug}`
      }
    ]
  };
}

export default function RentInCityPage({ params }: { params: { locale: string; city: string } }) {
  const city = CITIES[params.city];

  if (!city) {
    return (
      <div
        className="container--narrow"
        style={{ padding: "var(--space-16) 0", textAlign: "center" }}
      >
        <h1>City Not Found</h1>
        <p className="text-secondary">We don&apos;t have rental guides for this city yet.</p>
        <a
          href={`/${params.locale}`}
          style={{ color: "var(--brand)", fontWeight: 600, textDecoration: "none" }}
        >
          Back to Home
        </a>
      </div>
    );
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(city)) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(params.locale, city)) }}
      />

      <div style={{ paddingTop: "var(--space-10)", paddingBottom: "var(--space-16)" }}>
        {/* Hero Section */}
        <div
          style={{
            background: "linear-gradient(135deg, var(--brand) 0%, #004BB5 100%)",
            padding: "var(--space-12) 0",
            color: "white",
            marginBottom: "var(--space-10)"
          }}
        >
          <div className="container--narrow">
            <nav
              style={{ marginBottom: "var(--space-4)", fontSize: "var(--text-sm)", opacity: 0.8 }}
            >
              <a href={`/${params.locale}`} style={{ color: "white", textDecoration: "none" }}>
                Home
              </a>
              <span style={{ margin: "0 var(--space-2)" }}>/</span>
              <span>Rent in {city.name}</span>
            </nav>
            <h1
              style={{
                color: "white",
                marginBottom: "var(--space-3)",
                fontSize: "clamp(1.75rem, 4vw, 2.5rem)"
              }}
            >
              {city.heroLine}
            </h1>
            <p
              style={{
                opacity: 0.9,
                maxWidth: 640,
                lineHeight: 1.75,
                marginBottom: "var(--space-6)"
              }}
            >
              {city.description}
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
              <a
                href={`/${params.locale}/search?city=${city.slug}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "var(--space-3) var(--space-7)",
                  background: "white",
                  color: "var(--brand)",
                  borderRadius: "var(--radius-full)",
                  fontWeight: 700,
                  textDecoration: "none"
                }}
              >
                Search Rentals in {city.name}
              </a>
              <a
                href={`/${params.locale}/city/${city.slug}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "var(--space-3) var(--space-7)",
                  background: "rgba(255,255,255,0.15)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.3)",
                  borderRadius: "var(--radius-full)",
                  fontWeight: 600,
                  textDecoration: "none"
                }}
              >
                Browse {city.name} Listings
              </a>
            </div>
          </div>
        </div>

        {/* Average Rents */}
        <div className="container--narrow" style={{ marginBottom: "var(--space-12)" }}>
          <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
            Average Rental Prices in {city.name}
          </h2>
          <div className="grid grid-4" style={{ gap: "var(--space-4)" }}>
            {[
              { type: "1 BHK", range: city.avgRent1BHK, icon: "🏠" },
              { type: "2 BHK", range: city.avgRent2BHK, icon: "🏡" },
              { type: "3 BHK", range: city.avgRent3BHK, icon: "🏘️" },
              { type: "PG / Room", range: city.avgPG, icon: "🛏️" }
            ].map((r) => (
              <div
                key={r.type}
                style={{
                  background: "white",
                  borderRadius: "var(--radius-lg)",
                  padding: "var(--space-5)",
                  textAlign: "center",
                  border: "1px solid var(--border)",
                  boxShadow: "var(--shadow-sm)"
                }}
              >
                <div style={{ fontSize: 32, marginBottom: "var(--space-2)" }}>{r.icon}</div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "var(--text-lg)",
                    marginBottom: "var(--space-1)"
                  }}
                >
                  {r.type}
                </div>
                <div className="text-secondary" style={{ fontSize: "var(--text-sm)" }}>
                  {r.range}/mo
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Popular Localities */}
        <div className="section--alt" style={{ padding: "var(--space-10) 0" }}>
          <div className="container--narrow">
            <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
              Popular Localities in {city.name}
            </h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-3)",
                justifyContent: "center"
              }}
            >
              {city.popularLocalities.map((loc) => (
                <a
                  key={loc}
                  href={`/${params.locale}/search?city=${city.slug}&q=${encodeURIComponent(loc)}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    padding: "var(--space-2) var(--space-4)",
                    background: "white",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-full)",
                    fontSize: "var(--text-sm)",
                    fontWeight: 500,
                    color: "var(--text-primary)",
                    textDecoration: "none",
                    transition: "border-color 0.2s, box-shadow 0.2s"
                  }}
                >
                  📍 {loc}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Rental Tips */}
        <div className="container--narrow" style={{ padding: "var(--space-10) 0" }}>
          <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
            Tips for Renting in {city.name}
          </h2>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              maxWidth: 700,
              margin: "0 auto"
            }}
          >
            {city.rentTips.map((tip, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: "var(--space-4)",
                  alignItems: "flex-start",
                  padding: "var(--space-4) var(--space-5)",
                  background: "white",
                  borderRadius: "var(--radius-lg)",
                  border: "1px solid var(--border)"
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: "var(--brand)",
                    color: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "var(--text-sm)",
                    fontWeight: 700
                  }}
                >
                  {i + 1}
                </span>
                <p className="text-secondary" style={{ lineHeight: 1.65, margin: 0 }}>
                  {tip}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ Section */}
        <div className="section--alt" style={{ padding: "var(--space-10) 0" }}>
          <div className="container--narrow">
            <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
              FAQ: Renting in {city.name}
            </h2>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-4)",
                maxWidth: 700,
                margin: "0 auto"
              }}
            >
              {city.faqs.map((faq) => (
                <details
                  key={faq.q}
                  style={{
                    background: "white",
                    borderRadius: "var(--radius-lg)",
                    border: "1px solid var(--border)",
                    overflow: "hidden"
                  }}
                >
                  <summary
                    style={{
                      padding: "var(--space-4) var(--space-5)",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontSize: "var(--text-base)",
                      listStyle: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between"
                    }}
                  >
                    {faq.q}
                    <span style={{ marginLeft: "var(--space-3)", flexShrink: 0 }}>▸</span>
                  </summary>
                  <div
                    style={{
                      padding: "0 var(--space-5) var(--space-4)",
                      lineHeight: 1.75
                    }}
                    className="text-secondary"
                  >
                    {faq.a}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </div>

        {/* CTA */}
        <div
          className="container--narrow"
          style={{ padding: "var(--space-12) 0", textAlign: "center" }}
        >
          <h2 style={{ marginBottom: "var(--space-3)" }}>
            Ready to find your home in {city.name}?
          </h2>
          <p className="text-secondary" style={{ marginBottom: "var(--space-6)" }}>
            Join thousands of tenants finding verified, zero-brokerage rentals on Cribliv.
          </p>
          <a
            href={`/${params.locale}/search?city=${city.slug}`}
            className="btn btn--primary"
            style={{
              display: "inline-flex",
              padding: "var(--space-3) var(--space-8)",
              borderRadius: "var(--radius-full)",
              fontWeight: 700,
              textDecoration: "none"
            }}
          >
            Start Searching in {city.name}
          </a>
        </div>

        {/* Other Cities */}
        <div className="section--alt" style={{ padding: "var(--space-10) 0" }}>
          <div className="container--narrow">
            <h2 style={{ textAlign: "center", marginBottom: "var(--space-6)" }}>
              Explore Other Cities
            </h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-3)",
                justifyContent: "center"
              }}
            >
              {Object.values(CITIES)
                .filter((c) => c.slug !== city.slug)
                .map((c) => (
                  <a
                    key={c.slug}
                    href={`/${params.locale}/rent-in/${c.slug}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      padding: "var(--space-2) var(--space-5)",
                      background: "white",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-full)",
                      fontWeight: 500,
                      color: "var(--brand)",
                      textDecoration: "none",
                      fontSize: "var(--text-sm)"
                    }}
                  >
                    Rent in {c.name}
                  </a>
                ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
