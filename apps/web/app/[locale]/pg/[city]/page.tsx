import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MapPin, Building, Search } from "lucide-react";
import { PG_CITY_CONTENT } from "../../../../lib/pg-city-content";
import { searchPgListings, type PgSearchResponse } from "../../../../lib/pg-public-api";
import { PgListingCard } from "../../../../components/pg/PgListingCard";
import { jsonLdSafe } from "../../../../lib/jsonld";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export function generateStaticParams() {
  return Object.keys(PG_CITY_CONTENT).map((city) => ({ city }));
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; city: string };
}): Promise<Metadata> {
  const c = PG_CITY_CONTENT[params.city];
  if (!c) return { title: "City not found" };
  const title = `PGs in ${c.name} — Verified, Zero Brokerage | Cribliv`;
  return {
    title,
    description: c.intro,
    alternates: {
      canonical: `${BASE_URL}/${params.locale}/pg/${c.slug}`,
      languages: { en: `${BASE_URL}/en/pg/${c.slug}`, hi: `${BASE_URL}/hi/pg/${c.slug}` }
    },
    keywords: [
      `PG in ${c.name}`,
      `PG near me ${c.name}`,
      `hostel in ${c.name}`,
      `girls PG ${c.name}`,
      `boys PG ${c.name}`,
      `PG with food ${c.name}`
    ]
  };
}

export default async function PgCityPage({ params }: { params: { locale: string; city: string } }) {
  const c = PG_CITY_CONTENT[params.city];
  if (!c) notFound();

  let listings: PgSearchResponse = { items: [], total: 0, page: 1, page_size: 12 };
  try {
    listings = await searchPgListings({ city: c.slug, page_size: "12" }, { server: true });
  } catch {
    /* render the landing without live inventory */
  }

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: c.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a }
    }))
  };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/${params.locale}` },
      { "@type": "ListItem", position: 2, name: "PG", item: `${BASE_URL}/${params.locale}/pg` },
      {
        "@type": "ListItem",
        position: 3,
        name: `PG in ${c.name}`,
        item: `${BASE_URL}/${params.locale}/pg/${c.slug}`
      }
    ]
  };
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: listings.items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${BASE_URL}/${params.locale}/pg/${it.city}/${it.id}`,
      name: it.title
    }))
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdSafe(itemListJsonLd) }}
      />

      {/* Hero Banner Section */}
      <section
        style={{
          background: "linear-gradient(to right bottom, var(--surface-2), #ffffff)",
          padding: "var(--space-8) 0 var(--space-10) 0",
          borderBottom: "1px solid var(--border)"
        }}
      >
        <div className="container">
          <nav
            className="ld-crumb"
            aria-label="Breadcrumb"
            style={{ marginBottom: "var(--space-6)" }}
          >
            <Link href={`/${params.locale}` as Route}>Home</Link>
            <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
            <Link href={`/${params.locale}/pg` as Route}>PG</Link>
            <ChevronRight size={14} className="ld-crumb__sep" aria-hidden="true" />
            <span className="ld-crumb__current">PG in {c.name}</span>
          </nav>

          <div style={{ maxWidth: 800 }}>
            <h1 style={{ fontSize: "2.5rem", lineHeight: 1.2, marginBottom: "var(--space-4)" }}>
              {c.heroLine}
            </h1>
            <p
              className="text-secondary"
              style={{ fontSize: "1.125rem", lineHeight: 1.6, marginBottom: "var(--space-6)" }}
            >
              {c.intro}
            </p>
            <Link
              href={`/${params.locale}/pg?city=${c.slug}` as Route}
              className="btn btn--primary btn--lg"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <Search size={18} />
              Browse all {c.name} PGs
            </Link>
          </div>
        </div>
      </section>

      <div
        className="container"
        style={{ paddingTop: "var(--space-10)", paddingBottom: "var(--space-16)" }}
      >
        {/* Available PGs (Moved up for better UX) */}
        {listings.items.length > 0 && (
          <section className="ld-section" style={{ borderTop: 0, paddingTop: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: "var(--space-6)"
              }}
            >
              <h2 style={{ margin: 0 }}>Verified PGs in {c.name}</h2>
              <Link
                href={`/${params.locale}/pg?city=${c.slug}` as Route}
                className="btn btn--secondary btn--sm"
              >
                View all PGs
              </Link>
            </div>
            <div className="listing-grid">
              {listings.items.map((it, idx) => (
                <PgListingCard
                  key={it.id}
                  listing={it}
                  locale={params.locale}
                  position={idx}
                  surface="pg_city"
                  filters={{}}
                />
              ))}
            </div>
          </section>
        )}

        {/* Pricing Cards */}
        <section className="ld-section">
          <div className="ld-section__head">
            <h2>Average PG Rent in {c.name}</h2>
          </div>
          <div className="grid grid-3" style={{ gap: "var(--space-5)" }}>
            {[
              { label: "Single Sharing", range: c.rentSingle, icon: Building },
              { label: "Double Sharing", range: c.rentDouble, icon: Building },
              { label: "Triple Sharing", range: c.rentTriple, icon: Building }
            ].map((r, i) => {
              const Icon = r.icon;
              return (
                <div key={r.label} className="pg-rent-card">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      marginBottom: "var(--space-3)",
                      color: "var(--accent)"
                    }}
                  >
                    <Icon size={28} strokeWidth={1.5} />
                  </div>
                  <div
                    style={{ fontWeight: 600, fontSize: "1.1rem", marginBottom: "var(--space-2)" }}
                  >
                    {r.label}
                  </div>
                  <div className="text-secondary" style={{ fontSize: "0.95rem" }}>
                    {r.range}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Popular Areas */}
        <section className="ld-section">
          <div className="ld-section__head">
            <h2>Top PG Localities in {c.name}</h2>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {c.hubs.map((h) => (
              <Link
                key={h}
                href={`/${params.locale}/pg?city=${c.slug}&q=${encodeURIComponent(h)}` as Route}
                className="pg-hub-pill"
              >
                <MapPin size={16} color="var(--text-secondary)" /> {h}
              </Link>
            ))}
          </div>
        </section>

        {/* FAQ Section */}
        <section className="ld-section">
          <div className="ld-section__head">
            <h2>Frequently Asked Questions</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 800 }}>
            {c.faqs.map((f) => (
              <details
                key={f.q}
                style={{
                  background: "#fff",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden"
                }}
              >
                <summary
                  style={{
                    fontWeight: 600,
                    cursor: "pointer",
                    padding: "16px 20px",
                    listStyle: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "1.05rem"
                  }}
                >
                  {f.q}
                  <ChevronRight size={18} color="var(--text-tertiary)" className="faq-icon" />
                </summary>
                <div
                  style={{
                    padding: "0 20px 20px 20px",
                    color: "var(--text-secondary)",
                    lineHeight: 1.6
                  }}
                >
                  {f.a}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* Other Cities */}
        <section className="ld-section">
          <div className="ld-section__head">
            <h2>Explore PGs in other cities</h2>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {Object.values(PG_CITY_CONTENT)
              .filter((o) => o.slug !== c.slug)
              .map((o) => (
                <Link
                  key={o.slug}
                  href={`/${params.locale}/pg/${o.slug}` as Route}
                  className="btn btn--secondary"
                  style={{ borderRadius: "var(--radius-full)" }}
                >
                  PG in {o.name}
                </Link>
              ))}
          </div>
        </section>
      </div>
    </>
  );
}
