import type { Metadata } from "next";
import Link from "next/link";
import { buildSearchQuery, fetchApi } from "../../../lib/api";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

interface ListingCard {
  id: string;
  title: string;
  city: string;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  verification_status: "unverified" | "pending" | "verified" | "failed";
  score: number;
}

interface SearchResponse {
  items: ListingCard[];
  total: number;
  page: number;
  page_size: number;
}

export async function generateMetadata({
  params,
  searchParams
}: {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<Metadata> {
  const query = typeof searchParams.q === "string" ? searchParams.q : "";
  const city = typeof searchParams.city === "string" ? searchParams.city : "";
  const isHindi = params.locale === "hi";

  const titleParts = [query, city].filter(Boolean);
  const title = titleParts.length
    ? isHindi
      ? `${titleParts.join(", ")} — किराये पर खोज | Cribliv`
      : `${titleParts.join(", ")} — Rentals Search | Cribliv`
    : isHindi
      ? "किराये पर मकान खोजें — Cribliv"
      : "Search Verified Rentals — Cribliv";

  const description = isHindi
    ? "AI-संचालित सत्यापित किराये की खोज। फ्लैट, PG और मकान खोजें।"
    : "AI-powered verified rental search. Find flats, PGs, and houses across North India.";

  return {
    title,
    description,
    robots: { index: !!query || !!city, follow: true },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/search`,
      siteName: "Cribliv",
      type: "website"
    }
  };
}

function normalizeSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string" && value) {
      query[key] = value;
    }
  }
  return query;
}

export default async function SearchResultsPage({
  params,
  searchParams
}: {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = normalizeSearchParams(searchParams);
  let response: SearchResponse = {
    items: [],
    total: 0,
    page: 1,
    page_size: 20
  };
  let fetchError: string | null = null;

  try {
    response = await fetchApi<SearchResponse>(
      `/listings/search?${buildSearchQuery(filters)}`,
      undefined,
      {
        server: true
      }
    );
  } catch {
    fetchError = "Search API is unavailable. Please try again.";
  }

  const queryStr = String(searchParams.q ?? "");
  const cityStr = typeof searchParams.city === "string" ? searchParams.city : "";

  return (
    <>
      {/* Page Header */}
      <section className="container" style={{ paddingBottom: 0, paddingTop: "var(--space-5)" }}>
        <h1>
          {queryStr || cityStr
            ? `Rentals ${cityStr ? `in ${cityStr.charAt(0).toUpperCase() + cityStr.slice(1)}` : ""}${queryStr ? ` — "${queryStr}"` : ""}`
            : "Search Verified Rentals"}
        </h1>
        <p className="text-secondary body-sm" style={{ marginBottom: "var(--space-4)" }}>
          {response.total} result{response.total === 1 ? "" : "s"} found
          {cityStr ? ` in ${cityStr}` : ""}. Filters are URL-driven — share or bookmark anytime.
        </p>
      </section>

      {/* Filter Bar */}
      <div className="filter-bar">
        <Link
          href={`/${params.locale}/search?${buildSearchQuery({ ...filters, listing_type: "flat_house" })}`}
          className={`filter-btn${filters.listing_type === "flat_house" ? " filter-btn--active" : ""}`}
        >
          🏠 Flat/House
        </Link>
        <Link
          href={`/${params.locale}/search?${buildSearchQuery({ ...filters, listing_type: "pg" })}`}
          className={`filter-btn${filters.listing_type === "pg" ? " filter-btn--active" : ""}`}
        >
          🏢 PG
        </Link>
        <Link
          href={`/${params.locale}/search?${buildSearchQuery({ ...filters, verified: "true" })}`}
          className={`filter-btn${filters.verified === "true" ? " filter-btn--active" : ""}`}
        >
          ✅ Verified Only
        </Link>
        {Object.keys(filters).length > 0 && (
          <Link
            href={`/${params.locale}/search`}
            className="filter-btn"
            style={{ color: "var(--danger)" }}
          >
            ✕ Clear filters
          </Link>
        )}
      </div>

      {/* Error */}
      {fetchError && (
        <div className="alert alert--warning" style={{ marginBottom: "var(--space-4)" }}>
          <span aria-hidden="true">⚠️</span>
          {fetchError}
        </div>
      )}

      {/* Results Grid + Map Split */}
      <div className="split-layout">
        <div className="split-layout__list">
          {response.items.length === 0 && !fetchError ? (
            <div className="empty-state">
              <span className="empty-state__icon" aria-hidden="true">
                🔍
              </span>
              <h3>No listings match your search</h3>
              <p>Try adjusting your filters or searching in a different city.</p>
              <Link href={`/${params.locale}/search`} className="btn btn--primary">
                Clear Filters
              </Link>
            </div>
          ) : (
            <div className="listing-grid">
              {response.items.map((item) => (
                <article key={item.id} className="card">
                  <div className="card__image">
                    <div className="card__image-placeholder" aria-hidden="true">
                      🏠
                    </div>
                    {item.verification_status === "verified" && (
                      <span className="card__badge">
                        <span className="badge badge--verified">✓ Verified</span>
                      </span>
                    )}
                  </div>
                  <div className="card__body">
                    <div className="card__title">{item.title}</div>
                    <div className="card__location">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                        <circle cx="12" cy="10" r="3" />
                      </svg>
                      {item.city} &middot;{" "}
                      {item.listing_type === "flat_house" ? "Flat/House" : "PG"}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between"
                      }}
                    >
                      <div className="card__price">
                        ₹{item.monthly_rent.toLocaleString("en-IN")}
                        <span className="card__price-period">/month</span>
                      </div>
                      <Link
                        className="btn btn--primary btn--sm"
                        href={`/${params.locale}/listing/${item.id}?${buildSearchQuery({
                          city: item.city,
                          listing_type: item.listing_type
                        })}`}
                      >
                        View
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <div className="split-layout__map">
          <div className="map-placeholder">
            <div className="map-placeholder__icon" aria-hidden="true">
              🗺️
            </div>
            <p>Map view coming soon</p>
          </div>
        </div>
      </div>
    </>
  );
}
