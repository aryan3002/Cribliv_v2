import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PG_CITY_CONTENT } from "../../../../lib/pg-city-content";
import { searchPgListings, type PgSearchResponse } from "../../../../lib/pg-public-api";
import { PgListingCard } from "../../../../components/pg/PgListingCard";

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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
      />

      <div
        className="container"
        style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-16)" }}
      >
        <nav
          style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}
        >
          <Link href={`/${params.locale}` as Route} style={{ color: "inherit" }}>
            Home
          </Link>{" "}
          ›{" "}
          <Link href={`/${params.locale}/pg` as Route} style={{ color: "inherit" }}>
            PG
          </Link>{" "}
          › <span>PG in {c.name}</span>
        </nav>

        <h1 style={{ marginBottom: "var(--space-2)" }}>{c.heroLine}</h1>
        <p className="text-secondary" style={{ maxWidth: 720, marginBottom: "var(--space-5)" }}>
          {c.intro}
        </p>
        <Link href={`/${params.locale}/pg?city=${c.slug}` as Route} className="btn btn--primary">
          Browse all PGs in {c.name}
        </Link>

        <h2 style={{ margin: "var(--space-8) 0 var(--space-3)" }}>
          PG rent in {c.name} (per month)
        </h2>
        <div className="grid grid-3" style={{ gap: "var(--space-4)" }}>
          {[
            { label: "Single sharing", range: c.rentSingle },
            { label: "Double sharing", range: c.rentDouble },
            { label: "Triple sharing", range: c.rentTriple }
          ].map((r) => (
            <div
              key={r.label}
              style={{
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "var(--space-5)",
                textAlign: "center"
              }}
            >
              <div style={{ fontWeight: 700 }}>{r.label}</div>
              <div className="text-secondary">{r.range}</div>
            </div>
          ))}
        </div>

        <h2 style={{ margin: "var(--space-8) 0 var(--space-3)" }}>Popular PG areas in {c.name}</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {c.hubs.map((h) => (
            <Link
              key={h}
              href={`/${params.locale}/pg?city=${c.slug}&q=${encodeURIComponent(h)}` as Route}
              className="pg-chip"
            >
              📍 {h}
            </Link>
          ))}
        </div>

        {listings.items.length > 0 && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                margin: "var(--space-8) 0 var(--space-3)"
              }}
            >
              <h2 style={{ margin: 0 }}>Available PGs in {c.name}</h2>
              <Link href={`/${params.locale}/pg?city=${c.slug}` as Route} className="body-sm">
                View all →
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
          </>
        )}

        <h2 style={{ margin: "var(--space-10) 0 var(--space-3)" }}>FAQ — PGs in {c.name}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 720 }}>
          {c.faqs.map((f) => (
            <details
              key={f.q}
              style={{
                background: "#fff",
                border: "1px solid var(--border)",
                borderRadius: 10,
                padding: "12px 16px"
              }}
            >
              <summary style={{ fontWeight: 600, cursor: "pointer" }}>{f.q}</summary>
              <p className="text-secondary" style={{ marginTop: 8 }}>
                {f.a}
              </p>
            </details>
          ))}
        </div>

        <h2 style={{ margin: "var(--space-10) 0 var(--space-3)" }}>PGs in other cities</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {Object.values(PG_CITY_CONTENT)
            .filter((o) => o.slug !== c.slug)
            .map((o) => (
              <Link
                key={o.slug}
                href={`/${params.locale}/pg/${o.slug}` as Route}
                className="pg-chip"
              >
                PG in {o.name}
              </Link>
            ))}
        </div>
      </div>
    </>
  );
}
