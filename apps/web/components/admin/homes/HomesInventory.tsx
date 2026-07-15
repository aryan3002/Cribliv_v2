"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, House, Search } from "lucide-react";
import type {
  AdminHomeListItem,
  AdminHomeSort,
  AdminHomeStatusFilter,
  AdminHomesListResponse
} from "@cribliv/shared-types";
import { fetchAdminHomes } from "../../../lib/admin-api";
import { adminHomePublicUrl, copyAdminHomeUrl } from "../../../lib/admin-home-url";
import { formatDate, formatINRPrecise, formatNumber, formatPct } from "../../../lib/admin/format";
import { StatusPill } from "../primitives/StatusPill";

export interface AdminHomesQueryState {
  status: AdminHomeStatusFilter;
  city: string;
  q: string;
  sort: AdminHomeSort;
  page: number;
  pageSize: 25 | 50 | 100;
}

interface Props {
  accessToken: string;
  query: AdminHomesQueryState;
  onQueryChange: (next: AdminHomesQueryState) => void;
  onSelect: (listingId: string) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const STATUS_OPTIONS: Array<{ value: AdminHomeStatusFilter; label: string }> = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All verified" }
];

const SORT_OPTIONS: Array<{ value: AdminHomeSort; label: string }> = [
  { value: "leads", label: "Most leads" },
  { value: "views", label: "Most views" },
  { value: "conversion", label: "Highest conversion" },
  { value: "updated", label: "Recently updated" },
  { value: "rent_desc", label: "Highest rent" },
  { value: "rent_asc", label: "Lowest rent" }
];

export function HomesInventory({ accessToken, query, onQueryChange, onSelect, onToast }: Props) {
  const [data, setData] = useState<AdminHomesListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [searchInput, setSearchInput] = useState(query.q);
  const isMobile = useIsMobile();

  useEffect(() => {
    setSearchInput(query.q);
  }, [query.q]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (searchInput === query.q) return;
      onQueryChange({ ...query, q: searchInput, page: 1 });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [onQueryChange, query, searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params: {
      status: AdminHomeStatusFilter;
      sort: AdminHomeSort;
      page: number;
      page_size: 25 | 50 | 100;
      city?: string;
      q?: string;
    } = {
      status: query.status,
      sort: query.sort,
      page: query.page,
      page_size: query.pageSize
    };
    if (query.city) params.city = query.city;
    if (query.q) params.q = query.q;

    void fetchAdminHomes(accessToken, params)
      .then((response) => {
        if (!cancelled) setData(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load verified homes");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    query.city,
    query.page,
    query.pageSize,
    query.q,
    query.sort,
    query.status,
    reloadKey
  ]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((data?.total ?? 0) / query.pageSize)),
    [data?.total, query.pageSize]
  );

  function updateQuery(next: Partial<AdminHomesQueryState>) {
    onQueryChange({ ...query, ...next, page: 1 });
  }

  function changePage(page: number) {
    onQueryChange({ ...query, page });
  }

  async function handleCopy(event: React.MouseEvent<HTMLButtonElement>, row: AdminHomeListItem) {
    event.stopPropagation();
    try {
      await copyAdminHomeUrl(row.public_path);
      onToast("Public URL copied", "trust");
    } catch {
      onToast("Could not copy public URL", "danger");
    }
  }

  function handleOpen(event: React.MouseEvent<HTMLButtonElement>, row: AdminHomeListItem) {
    event.stopPropagation();
    window.open(adminHomePublicUrl(row.public_path), "_blank", "noopener,noreferrer");
  }

  return (
    <section className="admin-main__section" aria-label="Verified homes inventory">
      <div className="admin-page-title">
        <div>
          <h1>Verified Homes</h1>
          <span className="admin-page-title__sub">
            {loading && !data ? "Loading inventory..." : `${formatNumber(data?.total ?? 0)} homes`}
          </span>
        </div>
      </div>

      <div className="admin-homes-summary" aria-label="Verified homes summary">
        <SummaryMetric label="Active homes" value={formatNumber(data?.summary.active_homes ?? 0)} />
        <SummaryMetric label="Views 30d" value={formatNumber(data?.summary.views_30d ?? 0)} />
        <SummaryMetric label="Leads 30d" value={formatNumber(data?.summary.leads_30d ?? 0)} />
        <SummaryMetric
          label="Needs attention"
          value={formatNumber(data?.summary.needs_attention ?? 0)}
          tone={(data?.summary.needs_attention ?? 0) > 0 ? "warn" : undefined}
        />
      </div>

      <div className="admin-homes-table-frame">
        <div className="admin-homes-toolbar">
          <label className="admin-homes-field">
            <span>Home status</span>
            <select
              value={query.status}
              onChange={(event) =>
                updateQuery({ status: event.target.value as AdminHomeStatusFilter })
              }
              aria-label="Home status"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-homes-field">
            <span>City</span>
            <select
              value={query.city}
              onChange={(event) => updateQuery({ city: event.target.value })}
              aria-label="City"
            >
              <option value="">All cities</option>
              {data?.available_cities.map((city) => (
                <option key={city.slug} value={city.slug}>
                  {city.name} ({city.count})
                </option>
              ))}
            </select>
          </label>
          <label className="admin-homes-search">
            <Search size={16} aria-hidden="true" />
            <span className="admin-homes-sr-only">Search verified homes</span>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search title, owner, phone, locality, ID"
              aria-label="Search verified homes"
            />
          </label>
          <label className="admin-homes-field">
            <span>Sort homes</span>
            <select
              value={query.sort}
              onChange={(event) => updateQuery({ sort: event.target.value as AdminHomeSort })}
              aria-label="Sort homes"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-homes-field">
            <span>Rows per page</span>
            <select
              value={query.pageSize}
              onChange={(event) =>
                updateQuery({ pageSize: Number(event.target.value) as 25 | 50 | 100 })
              }
              aria-label="Rows per page"
            >
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
            </select>
          </label>
        </div>

        {error ? (
          <div className="admin-homes-error" role="alert">
            <div>
              <strong>Could not load verified homes</strong>
              <span>{error}</span>
            </div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Retry
            </button>
          </div>
        ) : loading && !data ? (
          <HomesLoadingTable />
        ) : data?.items.length ? (
          <>
            {isMobile ? (
              <HomesMobileList
                rows={data.items}
                onSelect={onSelect}
                onCopy={handleCopy}
                onOpen={handleOpen}
              />
            ) : (
              <HomesDesktopTable
                rows={data.items}
                onSelect={onSelect}
                onCopy={handleCopy}
                onOpen={handleOpen}
              />
            )}
          </>
        ) : (
          <HomesEmptyState
            isActive={query.status === "active"}
            onShowAll={() => updateQuery({ status: "all" })}
          />
        )}

        <div className="admin-homes-pagination">
          <span>
            Page {query.page} of {totalPages}
          </span>
          <div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={query.page <= 1}
              onClick={() => changePage(query.page - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              className="admin-btn admin-btn--ghost"
              disabled={query.page >= totalPages}
              onClick={() => changePage(query.page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function SummaryMetric({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="admin-homes-summary__metric" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HomesDesktopTable({
  rows,
  onSelect,
  onCopy,
  onOpen
}: {
  rows: AdminHomeListItem[];
  onSelect: (listingId: string) => void;
  onCopy: (event: React.MouseEvent<HTMLButtonElement>, row: AdminHomeListItem) => Promise<void>;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>, row: AdminHomeListItem) => void;
}) {
  return (
    <div className="admin-homes-desktop-table admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th scope="col">Cover</th>
            <th scope="col">Home</th>
            <th scope="col">City</th>
            <th scope="col">Rent</th>
            <th scope="col">Owner</th>
            <th scope="col">Status</th>
            <th scope="col" className="admin-homes-align-right">
              Leads 30d
            </th>
            <th scope="col" className="admin-homes-align-right">
              Views 30d
            </th>
            <th scope="col" className="admin-homes-align-right">
              Conversion
            </th>
            <th scope="col">Updated</th>
            <th scope="col" className="admin-homes-align-right">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              data-admin-home-row
              data-clickable="true"
              tabIndex={0}
              onClick={() => onSelect(row.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row.id);
                }
              }}
            >
              <td>
                <CoverPhoto row={row} />
              </td>
              <td>
                <div className="admin-homes-title">{row.title}</div>
                <div className="admin-table__id">{shortId(row.id)}</div>
              </td>
              <td>
                <div>{row.city_name ?? "-"}</div>
                <div className="admin-homes-muted">{row.locality_name ?? "-"}</div>
              </td>
              <td className="admin-table__amount">{formatINRPrecise(row.monthly_rent * 100)}</td>
              <td>
                <div>{row.owner_name ?? "-"}</div>
                <div className="admin-homes-muted">{row.owner_phone_masked ?? "-"}</div>
              </td>
              <td>
                <StatusPill status={row.status} />
              </td>
              <td className="admin-homes-align-right">{formatNumber(row.leads_30d)}</td>
              <td className="admin-homes-align-right">{formatNumber(row.views_30d)}</td>
              <td className="admin-homes-align-right">
                {formatPct(row.views_30d > 0 ? row.conversion_rate : 0, 1)}
              </td>
              <td>{formatDate(row.updated_at)}</td>
              <td className="admin-homes-align-right">
                <PublicActions row={row} onCopy={onCopy} onOpen={onOpen} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HomesMobileList({
  rows,
  onSelect,
  onCopy,
  onOpen
}: {
  rows: AdminHomeListItem[];
  onSelect: (listingId: string) => void;
  onCopy: (event: React.MouseEvent<HTMLButtonElement>, row: AdminHomeListItem) => Promise<void>;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>, row: AdminHomeListItem) => void;
}) {
  return (
    <div className="admin-homes-mobile-list">
      {rows.map((row) => (
        <article
          key={row.id}
          className="admin-homes-mobile-record"
          data-admin-home-row
          tabIndex={0}
          onClick={() => onSelect(row.id)}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelect(row.id);
            }
          }}
        >
          <div className="admin-homes-mobile-record__header">
            <CoverPhoto row={row} />
            <div>
              <div className="admin-homes-title">{row.title}</div>
              <div className="admin-table__id">{shortId(row.id)}</div>
              <div className="admin-homes-muted">
                {row.locality_name ?? "-"}, {row.city_name ?? "-"}
              </div>
              <div className="admin-table__amount">{formatINRPrecise(row.monthly_rent * 100)}</div>
            </div>
            <StatusPill status={row.status} />
          </div>
          <div className="admin-homes-mobile-record__metrics">
            <span>
              <strong>{formatNumber(row.leads_30d)}</strong>
              Leads 30d
            </span>
            <span>
              <strong>{formatNumber(row.views_30d)}</strong>
              Views 30d
            </span>
            <span>
              <strong>{formatPct(row.views_30d > 0 ? row.conversion_rate : 0, 1)}</strong>
              Conversion
            </span>
          </div>
          <div className="admin-homes-mobile-record__footer">
            <div className="admin-homes-mobile-record__meta">
              <span className="admin-homes-muted">
                {row.owner_name ?? "-"} · {row.owner_phone_masked ?? "-"}
              </span>
              <span className="admin-homes-muted">Updated {formatDate(row.updated_at)}</span>
            </div>
            <PublicActions row={row} onCopy={onCopy} onOpen={onOpen} />
          </div>
        </article>
      ))}
    </div>
  );
}

function CoverPhoto({ row }: { row: AdminHomeListItem }) {
  if (row.cover_photo_url) {
    return (
      <img className="admin-homes-thumb" src={row.cover_photo_url} alt={`${row.title} cover`} />
    );
  }

  return (
    <div className="admin-homes-thumb admin-homes-thumb--placeholder" aria-label="No cover photo">
      <House size={18} aria-hidden="true" />
    </div>
  );
}

function PublicActions({
  row,
  onCopy,
  onOpen
}: {
  row: AdminHomeListItem;
  onCopy: (event: React.MouseEvent<HTMLButtonElement>, row: AdminHomeListItem) => Promise<void>;
  onOpen: (event: React.MouseEvent<HTMLButtonElement>, row: AdminHomeListItem) => void;
}) {
  if (row.status !== "active") {
    return <span className="admin-homes-not-public">Not publicly available</span>;
  }

  return (
    <div className="admin-homes-actions">
      <button
        type="button"
        className="admin-homes-icon-action"
        onClick={(event) => void onCopy(event, row)}
        aria-label={`Copy public URL for ${row.title}`}
        title="Copy public URL"
      >
        <Copy size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="admin-homes-icon-action"
        onClick={(event) => onOpen(event, row)}
        aria-label={`Open public page for ${row.title}`}
        title="Open public page"
      >
        <ExternalLink size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function HomesEmptyState({ isActive, onShowAll }: { isActive: boolean; onShowAll: () => void }) {
  return (
    <div className="admin-empty">
      <div className="admin-empty__icon">
        <House size={18} aria-hidden="true" />
      </div>
      <div className="admin-empty__title">
        {isActive
          ? "No active verified homes match these filters"
          : "No verified homes match these filters"}
      </div>
      {isActive && (
        <button type="button" className="admin-btn admin-btn--ghost" onClick={onShowAll}>
          Show all verified
        </button>
      )}
    </div>
  );
}

function HomesLoadingTable() {
  return (
    <div role="status" aria-label="Loading verified homes">
      <div className="admin-homes-desktop-table admin-table-wrap">
        <table className="admin-table admin-homes-skeleton-table" aria-hidden="true">
          <tbody>
            {Array.from({ length: 6 }, (_, rowIndex) => (
              <tr key={rowIndex}>
                {Array.from({ length: 11 }, (_, cellIndex) => (
                  <td key={cellIndex}>
                    <span className="admin-homes-skeleton" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-homes-mobile-list" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="admin-homes-mobile-record">
            <span className="admin-homes-skeleton admin-homes-skeleton--mobile" />
            <span className="admin-homes-skeleton" />
            <span className="admin-homes-skeleton" />
          </div>
        ))}
      </div>
    </div>
  );
}

function shortId(id: string) {
  return `${id.slice(0, 8)}...`;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const onChange = () => setIsMobile(mediaQuery.matches);
    onChange();
    mediaQuery.addEventListener("change", onChange);

    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
