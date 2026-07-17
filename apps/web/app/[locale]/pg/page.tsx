import type { Metadata, Route } from "next";
import Link from "next/link";
import {
  Search as SearchIcon,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Building,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import { searchPgListings, type PgSearchResponse } from "../../../lib/pg-public-api";
import { buildSearchQuery } from "../../../lib/api";
import { SegmentedSearchBar } from "../../../components/search/SegmentedSearchBar";
import { PgFilters } from "../../../components/pg/PgFilters";
import { PgListingCard } from "../../../components/pg/PgListingCard";
import { PgSearchTracker } from "../../../components/pg/PgSearchTracker";
import { pgCardToSearchMapListing } from "../../../lib/pg-map-adapter";
import { SearchResultsMap } from "../search/SearchResultsMap";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi ? "PG और हॉस्टल खोजें: सत्यापित" : "Find Verified PGs & Hostels";
  return {
    title,
    description: isHindi
      ? "सत्यापित PG और हॉस्टल खोजें। शेयरिंग, खाना, AC और बजट के अनुसार फ़िल्टर करें।"
      : "Search verified PGs and hostels. Filter by sharing, food, AC, gender and budget.",
    alternates: { canonical: `${BASE_URL}/${params.locale}/pg` }
  };
}

function normalize(searchParams: Record<string, string | string[] | undefined>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(searchParams)) if (typeof v === "string" && v) out[k] = v;
  return out;
}

export default async function PgSearchPage({
  params,
  searchParams
}: {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = normalize(searchParams);
  let response: PgSearchResponse = { items: [], total: 0, page: 1, page_size: 20 };
  let error: string | null = null;
  try {
    response = await searchPgListings(filters, { server: true });
  } catch {
    error = "PG search is unavailable. Please try again.";
  }

  const totalPages = Math.max(1, Math.ceil(response.total / response.page_size));
  const currentPage = response.page;

  return (
    <div className="tenant-results-page tenant-results-page--pg">
      <section className="tenant-results-hero tenant-results-hero--pg">
        <div className="container">
          <div className="tenant-results-hero__shell">
            <div className="tenant-results-hero__copy">
              <span className="tenant-results-hero__eyebrow">
                <Building size={14} aria-hidden="true" />
                Verified PG search
              </span>
              <h1>
                {filters.city
                  ? `PGs in ${filters.city.charAt(0).toUpperCase()}${filters.city.slice(1)}`
                  : "Find Verified PGs"}
              </h1>
              <p>
                {response.total} PG option{response.total === 1 ? "" : "s"} with sharing, meals,
                gender policy, and verified operator signals.
              </p>
            </div>
            <div className="tenant-results-hero__actions tenant-results-hero__actions--badges">
              <span className="tenant-proof-pill">
                <ShieldCheck size={14} aria-hidden="true" />
                Food + sharing filters
              </span>
            </div>
            <div className="tenant-results-toolbar">
              <SegmentedSearchBar locale={params.locale} segment="pg" params={filters} />
              <div className="tenant-results-filter-card">
                <span className="tenant-results-filter-card__label">
                  <SlidersHorizontal size={14} aria-hidden="true" />
                  PG filters
                </span>
                <PgFilters locale={params.locale} filters={filters} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="container">
          <div className="error-state" style={{ marginTop: "var(--space-6)" }}>
            <div className="error-state__icon">
              <AlertTriangle size={36} />
            </div>
            <h3>We couldn&apos;t reach our servers</h3>
            <Link href={`/${params.locale}/pg` as Route} className="btn btn--secondary">
              Clear filters
            </Link>
          </div>
        </div>
      )}

      <section
        className="container tenant-results-content tenant-results-map-shell"
        aria-label="PG results"
      >
        <div className="tenant-results-list-panel">
          {!error && response.items.length === 0 ? (
            <div className="empty-state" style={{ marginTop: "var(--space-8)" }}>
              <span className="empty-state__icon" aria-hidden="true">
                <SearchIcon size={48} style={{ margin: "0 auto", color: "var(--text-tertiary)" }} />
              </span>
              <h3>No PGs match your filters</h3>
              <p>Try widening your filters or a different city.</p>
              <Link href={`/${params.locale}/pg` as Route} className="btn btn--primary">
                Clear filters
              </Link>
            </div>
          ) : (
            <div className="listing-grid">
              <PgSearchTracker
                city={filters.city}
                query={filters.q}
                filters={filters}
                resultCount={response.total}
                shownListingIds={response.items.map((i) => i.id)}
              />
              {response.items.map((item, idx) => (
                <PgListingCard
                  key={item.id}
                  listing={item}
                  locale={params.locale}
                  position={idx}
                  surface="pg_search"
                  filters={filters}
                />
              ))}
            </div>
          )}

          {totalPages > 1 && (
            <nav
              className="pagination"
              aria-label="PG results pages"
              style={{ marginTop: "var(--space-8)" }}
            >
              {currentPage > 1 && (
                <Link
                  className="pagination__btn"
                  href={
                    `/${params.locale}/pg?${buildSearchQuery({ ...filters, page: String(currentPage - 1) })}` as Route
                  }
                >
                  <ChevronLeft size={16} /> Prev
                </Link>
              )}
              {currentPage < totalPages && (
                <Link
                  className="pagination__btn"
                  href={
                    `/${params.locale}/pg?${buildSearchQuery({ ...filters, page: String(currentPage + 1) })}` as Route
                  }
                >
                  Next <ChevronRight size={16} />
                </Link>
              )}
            </nav>
          )}
        </div>
        <aside className="tenant-results-map-panel" aria-label="PG map preview">
          <SearchResultsMap
            locale={params.locale}
            city={filters.city || response.items[0]?.city || "lucknow"}
            listings={response.items.map(pgCardToSearchMapListing)}
            mapHref={
              `/${params.locale}/map?${buildSearchQuery({
                ...(filters.city ? { city: filters.city } : {}),
                listing_type: "pg"
              })}` as Route
            }
          />
        </aside>
      </section>
    </div>
  );
}
