import Link from "next/link";
import { buildSearchQuery, fetchApi } from "../../../lib/api";

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

  return (
    <section className="hero">
      <h1>Search results</h1>
      <p>Filters are URL-driven for SEO and shareability.</p>
      <div className="panel">
        <span className="badge">Verified</span>
        <p>Query: {String(searchParams.q ?? "") || "(none)"}</p>
        <p>
          Showing {response.total} result{response.total === 1 ? "" : "s"}.
        </p>
      </div>
      {fetchError ? <div className="panel warning-box">{fetchError}</div> : null}
      <div className="listing-grid">
        {response.items.map((item) => (
          <article key={item.id} className="panel listing-card">
            <div className="card-row">
              <h3>{item.title}</h3>
              {item.verification_status === "verified" ? (
                <span className="badge">Verified</span>
              ) : null}
            </div>
            <p className="muted-text">
              {item.city} • {item.listing_type === "flat_house" ? "Flat/House" : "PG"}
            </p>
            <p className="rent">₹{item.monthly_rent.toLocaleString("en-IN")}/month</p>
            <Link
              className="primary"
              href={`/${params.locale}/listing/${item.id}?${buildSearchQuery({
                city: item.city,
                listing_type: item.listing_type
              })}`}
            >
              View details
            </Link>
          </article>
        ))}
      </div>
      {!response.items.length ? (
        <div className="panel">No listings match current filters.</div>
      ) : null}
    </section>
  );
}
