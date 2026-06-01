import type { Metadata, Route } from "next";
import Link from "next/link";
import { Search as SearchIcon, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { searchPgListings, type PgSearchResponse } from "../../../lib/pg-public-api";
import { buildSearchQuery } from "../../../lib/api";
import { SegmentedSearchBar } from "../../../components/search/SegmentedSearchBar";
import { PgFilters } from "../../../components/pg/PgFilters";
import { PgListingCard } from "../../../components/pg/PgListingCard";
import { PgSearchTracker } from "../../../components/pg/PgSearchTracker";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const isHindi = params.locale === "hi";
  const title = isHindi ? "PG और हॉस्टल खोजें — सत्यापित" : "Find Verified PGs & Hostels";
  return {
    title,
    description: isHindi
      ? "सत्यापित PG और हॉस्टल खोजें — शेयरिंग, खाना, AC और बजट के अनुसार फ़िल्टर करें।"
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
    <section
      className="container"
      style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-16)" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "var(--space-2)",
          marginBottom: "var(--space-4)"
        }}
      >
        <h1 style={{ fontSize: "1.25rem", margin: 0 }}>
          {filters.city
            ? `PGs in ${filters.city.charAt(0).toUpperCase()}${filters.city.slice(1)}`
            : "Find Verified PGs"}
        </h1>
        <p className="text-secondary body-sm" style={{ margin: 0 }}>
          {response.total} result{response.total === 1 ? "" : "s"}
        </p>
      </div>

      <SegmentedSearchBar locale={params.locale} segment="pg" params={filters} />

      <PgFilters locale={params.locale} filters={filters} />

      {error && (
        <div className="error-state" style={{ marginTop: "var(--space-6)" }}>
          <div className="error-state__icon">
            <AlertTriangle size={36} />
          </div>
          <h3>We couldn&apos;t reach our servers</h3>
          <Link href={`/${params.locale}/pg` as Route} className="btn btn--secondary">
            Clear filters
          </Link>
        </div>
      )}

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
        <div className="listing-grid" style={{ marginTop: "var(--space-6)" }}>
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
    </section>
  );
}
