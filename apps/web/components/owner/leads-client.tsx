"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import { Download, LayoutGrid, List, MoreVertical, Search } from "lucide-react";
import { fetchOwnerLeads, type LeadStatus, type LeadVm } from "../../lib/owner-api";
import { LeadsPipeline } from "./leads-pipeline";
import { LeadStatsWidget } from "./lead-stats-widget";
import { LeadKanban, LeadKanbanSkeleton } from "./lead-kanban";
import { LeadMobileList } from "./lead-mobile-list";
import { LeadCreditBalanceBar } from "./lead-credit-balance-bar";
import { track } from "../../lib/track";
import { t, type Locale } from "../../lib/i18n";
import { useFlag } from "../../lib/feature-flags";

const VIEW_KEY = "cribliv:owner_leads_view";
const DESKTOP_BOARD_QUERY = "(hover: hover) and (pointer: fine) and (min-width: 1024px)";
type ViewMode = "board" | "list";

const LEAD_FILTERS: Array<LeadStatus | "all"> = [
  "all",
  "new",
  "contacted",
  "visit_scheduled",
  "deal_done",
  "lost"
];

const FILTER_LABELS: Record<LeadStatus | "all", string> = {
  all: "All",
  new: "New",
  contacted: "Contacted",
  visit_scheduled: "Visit Scheduled",
  deal_done: "Deal Done",
  lost: "Lost"
};

function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [view, setView] = useState<ViewMode>("board");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY) as ViewMode | null;
      if (saved === "board" || saved === "list") setView(saved);
    } catch {
      /* ignore */
    }
  }, []);
  const update = useCallback((next: ViewMode) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
    track("kanban_view_toggled", { view: next });
  }, []);
  return [view, update];
}

function useDesktopBoardCapable(): boolean {
  const [capable, setCapable] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(DESKTOP_BOARD_QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia(DESKTOP_BOARD_QUERY);
    const update = () => setCapable(m.matches);
    update();
    m.addEventListener?.("change", update);
    return () => m.removeEventListener?.("change", update);
  }, []);
  return capable;
}

function friendlyLeadError(locale: Locale, err: unknown) {
  const message = err instanceof Error ? err.message : "";
  const lower = message.toLowerCase();
  if (lower.includes("unauthorized")) return t(locale, "ownerOverviewErrorUnauthorized");
  if (lower.includes("network") || lower.includes("fetch") || lower.includes("offline")) {
    return t(locale, "ownerOverviewErrorNetwork");
  }
  return t(locale, "ownerOverviewErrorLeads");
}

export function LeadsClient({ locale }: { locale: string }) {
  const loc = locale as Locale;
  const { data: session, status } = useSession();
  const accessToken = session?.accessToken ?? null;
  const [view, setView] = useViewMode();
  const desktopBoardCapable = useDesktopBoardCapable();
  const callbackLeadsEnabled = useFlag("ff_callback_leads");

  const [leads, setLeads] = useState<LeadVm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [mobileStatus, setMobileStatus] = useState<LeadStatus | "all">("all");

  const loadLeads = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchOwnerLeads(accessToken, { pageSize: 200 });
      setLeads(res.items);
      setTotal(res.total);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setError(friendlyLeadError(loc, err));
    } finally {
      setLoading(false);
    }
  }, [accessToken, loc]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchOwnerLeads(accessToken, { pageSize: 200 })
      .then((res) => {
        if (cancelled) return;
        setLeads(res.items);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "";
        if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
        setError(friendlyLeadError(loc, err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, loc]);

  if (status === "loading") {
    return (
      <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
        <LeadKanbanSkeleton />
      </section>
    );
  }

  if (!accessToken) {
    return (
      <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
        <div className="alert alert--error">Please log in to view leads.</div>
      </section>
    );
  }

  // Compute "this week vs last week" delta from createdAt timestamps.
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const thisWeek = leads.filter((l) => now - new Date(l.createdAt).getTime() <= sevenDays).length;
  const lastWeek = leads.filter((l) => {
    const t = new Date(l.createdAt).getTime();
    return now - t > sevenDays && now - t <= 2 * sevenDays;
  }).length;
  const delta = thisWeek - lastWeek;
  const lockedLeadCount = leads.filter((lead) => lead.accessState === "locked").length;
  const statusCounts = leads.reduce(
    (acc, lead) => {
      acc.all += 1;
      acc[lead.status] += 1;
      return acc;
    },
    {
      all: 0,
      new: 0,
      contacted: 0,
      visit_scheduled: 0,
      deal_done: 0,
      lost: 0
    } satisfies Record<LeadStatus | "all", number>
  );

  const exportHref = "/v1/owner/leads/export";
  const searchControl = (
    <div className="lk-search">
      <Search size={16} className="lk-search__icon" aria-hidden="true" />
      <input
        type="search"
        placeholder="Search tenant, listing, phone..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search leads"
      />
    </div>
  );
  const exportLink = (
    <a
      href={exportHref}
      className="btn btn--secondary btn--sm"
      download
      onClick={() => track("lead_csv_exported")}
    >
      <Download size={14} aria-hidden="true" style={{ marginRight: 4 }} />
      Export CSV
    </a>
  );

  return (
    <section className="container container--narrow" style={{ paddingBlock: "var(--space-6)" }}>
      <div className="lk-toolbar">
        <div>
          <Link
            href={`/${locale}/owner/dashboard`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
              color: "var(--text-tertiary)",
              fontWeight: 500,
              textDecoration: "none",
              marginBottom: 6
            }}
          >
            ← Dashboard
          </Link>
          <h1 className="lk-toolbar__title">Your leads</h1>
          <p className="lk-toolbar__sub">
            <b>{total}</b> total · <b>{thisWeek}</b> this week
            {delta !== 0 && (
              <span
                className={`lk-toolbar__delta ${
                  delta > 0
                    ? "lk-toolbar__delta--up"
                    : delta < 0
                      ? "lk-toolbar__delta--down"
                      : "lk-toolbar__delta--flat"
                }`}
              >
                {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs last 7d
              </span>
            )}
          </p>
        </div>

        <div className="lk-toolbar__actions">
          {desktopBoardCapable ? (
            <>
              {searchControl}
              <div className="lk-view-toggle" role="group" aria-label="View mode">
                <button
                  type="button"
                  aria-pressed={view === "board"}
                  onClick={() => setView("board")}
                >
                  <LayoutGrid size={14} aria-hidden="true" />
                  Board
                </button>
                <button
                  type="button"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  <List size={14} aria-hidden="true" />
                  List
                </button>
              </div>

              {exportLink}
            </>
          ) : (
            <details className="lk-mobile-overflow">
              <summary aria-label="Lead actions">
                <MoreVertical size={18} aria-hidden="true" />
              </summary>
              <div className="lk-mobile-overflow__menu">{exportLink}</div>
            </details>
          )}
        </div>
      </div>

      {callbackLeadsEnabled ? (
        <LeadCreditBalanceBar
          accessToken={accessToken}
          locale={loc}
          lockedLeadCount={lockedLeadCount}
          onCreditsChanged={() => void loadLeads()}
        />
      ) : null}

      <LeadStatsWidget accessToken={accessToken} />

      {!desktopBoardCapable ? (
        <div className="lk-mobile-controls" aria-label="Mobile lead controls">
          {searchControl}
          <div className="lk-mobile-filters" role="group" aria-label="Filter leads by status">
            {LEAD_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                className={`lk-mobile-filter${mobileStatus === filter ? " lk-mobile-filter--active" : ""}`}
                aria-pressed={mobileStatus === filter}
                onClick={() => setMobileStatus(filter)}
              >
                {FILTER_LABELS[filter]}
                <span>{statusCounts[filter]}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: "var(--space-5)" }}>
        {error ? (
          <div className="alert alert--error lk-error" role="alert">
            <p>{error}</p>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => void loadLeads()}
            >
              {t(loc, "ownerOverviewRetry")}
            </button>
          </div>
        ) : loading ? (
          <LeadKanbanSkeleton />
        ) : leads.length === 0 ? (
          <div className="lk-empty-state">
            <h2>{t(loc, "ownerOverviewNoLeadsYet")}</h2>
            <p>{t(loc, "ownerOverviewNoLeadsYetBody")}</p>
          </div>
        ) : !desktopBoardCapable ? (
          <LeadMobileList
            accessToken={accessToken}
            locale={loc}
            leads={leads}
            searchQuery={search}
            status={mobileStatus}
            onLeadsChange={setLeads}
          />
        ) : view === "board" ? (
          <LeadKanban
            accessToken={accessToken}
            leads={leads}
            onLeadsChange={setLeads}
            searchQuery={search}
            enableDrag={desktopBoardCapable}
            locale={loc}
          />
        ) : (
          <LeadsPipeline accessToken={accessToken} locale={loc} searchQuery={search} />
        )}
      </div>
    </section>
  );
}
