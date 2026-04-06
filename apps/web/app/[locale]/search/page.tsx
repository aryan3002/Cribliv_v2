import type { Metadata } from "next";
import Link from "next/link";
import { buildSearchQuery, fetchApi } from "../../../lib/api";
import { SearchFilters } from "./search-filters";
import {
  MapPin,
  Search as SearchIcon,
  X,
  ChevronLeft,
  ChevronRight,
  Building,
  Home,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2
} from "lucide-react";

const QUERY_NORMALIZE_MAP: Record<string, string> = {
  "1bhk": "1 BHK",
  "2bhk": "2 BHK",
  "3bhk": "3 BHK",
  "4bhk": "4 BHK",
  "5bhk": "5 BHK",
  pg: "PG"
};

function normalizeQuery(q: string): string {
  const lower = q.toLowerCase().trim();
  return QUERY_NORMALIZE_MAP[lower] ?? q;
}

function toDisplayCity(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase();
}

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

const CITIES = [
  { slug: "delhi", label: "Delhi" },
  { slug: "gurugram", label: "Gurugram" },
  { slug: "noida", label: "Noida" },
  { slug: "ghaziabad", label: "Ghaziabad" },
  { slug: "faridabad", label: "Faridabad" },
  { slug: "chandigarh", label: "Chandigarh" },
  { slug: "jaipur", label: "Jaipur" },
  { slug: "lucknow", label: "Lucknow" }
];

const SORT_OPTIONS = [
  { key: "relevance", label: "Relevance" },
  { key: "newest", label: "Newest First" },
  { key: "verified", label: "Verified First" },
  { key: "rent_asc", label: "Rent: Low → High" },
  { key: "rent_desc", label: "Rent: High → Low" }
];

interface ListingCard {
  id: string;
  title: string;
  city: string;
  city_name?: string;
  locality?: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  bhk?: number | null;
  furnishing?: string | null;
  area_sqft?: number | null;
  verification_status: "unverified" | "pending" | "verified" | "failed";
  cover_photo?: string | null;
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

  const displayQuery = query ? normalizeQuery(query) : "";
  const displayCity = city ? toDisplayCity(city) : "";

  const titleParts = [displayQuery, displayCity].filter(Boolean);
  const title = titleParts.length
    ? isHindi
      ? `${titleParts.join(", ")} — किराये पर खोज`
      : `${displayQuery ? displayQuery + " in " : ""}${displayCity || ""} — Rentals`.replace(
          / in  —/,
          " —"
        )
    : isHindi
      ? "किराये पर मकान खोजें"
      : "Search Verified Rentals";

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

function cityLabel(slug: string): string {
  return CITIES.find((c) => c.slug === slug)?.label ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

function furnishLabel(f: string): string {
  return f === "fully_furnished"
    ? "Fully Furnished"
    : f === "semi_furnished"
      ? "Semi-Furnished"
      : "Unfurnished";
}

export default async function SearchResultsPage({
  params,
  searchParams
}: {
  params: { locale: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const filters = normalizeSearchParams(searchParams);
  let response: SearchResponse = { items: [], total: 0, page: 1, page_size: 20 };
  let fetchError: string | null = null;

  try {
    response = await fetchApi<SearchResponse>(
      `/listings/search?${buildSearchQuery(filters)}`,
      undefined,
      { server: true }
    );
  } catch {
    fetchError = "Search API is unavailable. Please try again.";
  }

  const queryStr = String(searchParams.q ?? "");
  const cityStr = typeof searchParams.city === "string" ? searchParams.city : "";
  const totalPages = Math.max(1, Math.ceil(response.total / response.page_size));
  const currentPage = response.page;

  // Active filter chips for removal
  const activeChips: Array<{ label: string; removeParams: Record<string, string> }> = [];
  if (filters.city) {
    const { city: _, ...rest } = filters;
    activeChips.push({ label: `City: ${cityLabel(filters.city)}`, removeParams: rest });
  }
  if (filters.listing_type) {
    const { listing_type: _, ...rest } = filters;
    activeChips.push({
      label: `Type: ${filters.listing_type === "flat_house" ? "Flat/House" : "PG"}`,
      removeParams: rest
    });
  }
  if (filters.min_rent) {
    const { min_rent: _, ...rest } = filters;
    activeChips.push({
      label: `Min ₹${Number(filters.min_rent).toLocaleString("en-IN")}`,
      removeParams: rest
    });
  }
  if (filters.max_rent) {
    const { max_rent: _, ...rest } = filters;
    activeChips.push({
      label: `Max ₹${Number(filters.max_rent).toLocaleString("en-IN")}`,
      removeParams: rest
    });
  }
  if (filters.bhk) {
    const { bhk: _, ...rest } = filters;
    activeChips.push({ label: `${filters.bhk} BHK`, removeParams: rest });
  }
  if (filters.furnishing) {
    const { furnishing: _, ...rest } = filters;
    activeChips.push({ label: furnishLabel(filters.furnishing), removeParams: rest });
  }
  if (filters.verified_only === "true") {
    const { verified_only: _, ...rest } = filters;
    activeChips.push({ label: "Verified Only", removeParams: rest });
  }
  if (filters.q) {
    const { q: _, ...rest } = filters;
    activeChips.push({ label: `"${filters.q}"`, removeParams: rest });
  }

  return (
    <>
      {/* ── Inline Search + Header ── */}
      <section className="container" style={{ paddingBottom: 0, paddingTop: "var(--space-6)" }}>
        <SearchFilters
          locale={params.locale}
          filters={filters}
          cities={CITIES}
          sortOptions={SORT_OPTIONS}
        />

        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "var(--space-2)",
            marginTop: "var(--space-6)",
            paddingBottom: "var(--space-4)",
            borderBottom: "1px solid var(--border)"
          }}
        >
          <div>
            <h1 style={{ fontSize: "1.25rem", margin: 0, letterSpacing: "-0.01em" }}>
              {queryStr || cityStr
                ? `Rentals ${cityStr ? `in ${toDisplayCity(cityStr)}` : ""}${queryStr ? ` — "${normalizeQuery(queryStr)}"` : ""}`
                : "Search Verified Rentals"}
            </h1>
          </div>
          <p className="text-secondary body-sm" style={{ margin: 0 }}>
            {response.total} result{response.total === 1 ? "" : "s"}
          </p>
        </div>
      </section>

      {/* ── Active Filter Chips ── */}
      {activeChips.length > 0 && (
        <div className="container" style={{ paddingTop: "var(--space-3)", paddingBottom: 0 }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-2)",
              alignItems: "center"
            }}
          >
            {activeChips.map((chip) => (
              <Link
                key={chip.label}
                href={`/${params.locale}/search?${buildSearchQuery(chip.removeParams)}`}
                className="filter-chip"
              >
                {chip.label} <X size={12} aria-label="remove" />
              </Link>
            ))}
            {activeChips.length > 1 && (
              <Link href={`/${params.locale}/search`} className="filter-chip filter-chip--clear">
                Clear all
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Error — illustrated recovery state */}
      {fetchError && (
        <div className="container">
          <div className="error-state" style={{ marginTop: "var(--space-4)" }}>
            <div className="error-state__icon">
              <AlertTriangle size={36} />
            </div>
            <h3>We couldn&apos;t reach our servers</h3>
            <p>
              This might be a temporary issue. Try refreshing the page, or browse by city below.
            </p>
            <div className="error-state__actions">
              <Link
                href={`/${params.locale}/search?${buildSearchQuery(filters)}`}
                className="btn btn--primary"
              >
                Retry Search
              </Link>
              <Link href={`/${params.locale}/search`} className="btn btn--secondary">
                Clear Filters
              </Link>
            </div>
            <p className="body-sm text-secondary" style={{ marginBottom: "var(--space-4)" }}>
              Or try one of these popular cities:
            </p>
            <div className="error-state__cities">
              {CITIES.slice(0, 4).map((city) => (
                <Link
                  key={city.slug}
                  href={`/${params.locale}/search?city=${city.slug}`}
                  className="error-state__city-link"
                >
                  <MapPin size={16} />
                  {city.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Results Grid ── */}
      <div
        className="container"
        style={{ paddingTop: "var(--space-4)", paddingBottom: "var(--space-16)" }}
      >
        {response.items.length === 0 && !fetchError ? (
          <div className="empty-state">
            <span className="empty-state__icon" aria-hidden="true">
              <SearchIcon size={48} style={{ margin: "0 auto", color: "var(--text-tertiary)" }} />
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
                <Link href={`/${params.locale}/listing/${item.id}`} className="card__image-link">
                  <div className="card__image">
                    {item.cover_photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.cover_photo} alt={item.title} loading="lazy" />
                    ) : (
                      <div className="card__image-placeholder" aria-hidden="true">
                        <Building size={36} style={{ color: "var(--text-tertiary)" }} />
                      </div>
                    )}
                    {item.verification_status === "verified" && (
                      <span className="card__badge">
                        <span className="badge badge--verified">
                          <ShieldCheck size={12} style={{ marginRight: 2 }} /> Verified
                        </span>
                      </span>
                    )}
                  </div>
                </Link>
                <div className="card__body">
                  <div className="card__title">{item.title}</div>
                  <div className="card__location">
                    <MapPin size={14} aria-hidden="true" />
                    {item.locality ? `${item.locality}, ` : ""}
                    {item.city_name ?? cityLabel(item.city)}
                    {" · "}
                    {item.listing_type === "flat_house" ? "Flat/House" : "PG"}
                  </div>
                  {item.listing_type === "pg" ? (
                    <div className="card__meta">
                      <span
                        className="card__meta-item"
                        style={{
                          background: "rgba(80,70,229,0.08)",
                          color: "#5046e5",
                          fontWeight: 600
                        }}
                      >
                        PG
                      </span>
                      <span className="card__meta-item">
                        {item.furnishing ? furnishLabel(item.furnishing) : "—"}
                      </span>
                    </div>
                  ) : (
                    (item.bhk || item.area_sqft || item.furnishing) && (
                      <div className="card__meta">
                        {item.bhk ? <span className="card__meta-item">{item.bhk} BHK</span> : null}
                        {item.area_sqft ? (
                          <span className="card__meta-item">{item.area_sqft} sqft</span>
                        ) : null}
                        {item.furnishing ? (
                          <span className="card__meta-item">{furnishLabel(item.furnishing)}</span>
                        ) : null}
                      </div>
                    )
                  )}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: "var(--space-2)"
                    }}
                  >
                    <div className="card__price">
                      ₹{item.monthly_rent?.toLocaleString("en-IN") ?? "—"}
                      <span className="card__price-period">/month</span>
                    </div>
                    <Link
                      className="btn btn--primary btn--sm"
                      href={`/${params.locale}/listing/${item.id}`}
                    >
                      View
                    </Link>
                  </div>
                  {item.verification_status === "verified" && (
                    <div style={{ marginTop: "var(--space-2)" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--trust)",
                          background: "rgba(34,197,94,0.08)",
                          padding: "2px 8px",
                          borderRadius: "var(--radius-full)"
                        }}
                      >
                        <CheckCircle2 size={12} /> Verified
                      </span>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <nav className="pagination" aria-label="Search results pages">
            {currentPage > 1 && (
              <Link
                className="pagination__btn"
                href={`/${params.locale}/search?${buildSearchQuery({ ...filters, page: String(currentPage - 1) })}`}
              >
                <ChevronLeft size={16} /> Prev
              </Link>
            )}
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
              .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] ?? 0) > 1) acc.push("...");
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                item === "..." ? (
                  <span key={`ellipsis-${idx}`} className="pagination__ellipsis">
                    …
                  </span>
                ) : (
                  <Link
                    key={item}
                    className={`pagination__btn${item === currentPage ? " pagination__btn--active" : ""}`}
                    href={`/${params.locale}/search?${buildSearchQuery({ ...filters, page: String(item) })}`}
                  >
                    {item}
                  </Link>
                )
              )}
            {currentPage < totalPages && (
              <Link
                className="pagination__btn"
                href={`/${params.locale}/search?${buildSearchQuery({ ...filters, page: String(currentPage + 1) })}`}
              >
                Next <ChevronRight size={16} />
              </Link>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
