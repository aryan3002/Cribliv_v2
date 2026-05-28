"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import { Download, LayoutGrid, List, Search } from "lucide-react";
import { fetchOwnerLeads, type LeadVm } from "../../lib/owner-api";
import { LeadsPipeline } from "./leads-pipeline";
import { LeadStatsWidget } from "./lead-stats-widget";
import { LeadKanban, LeadKanbanSkeleton } from "./lead-kanban";
import { track } from "../../lib/track";

const VIEW_KEY = "cribliv:owner_leads_view";
type ViewMode = "board" | "list";

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

function useCanDrag(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)");
    const update = () => setCan(m.matches);
    update();
    m.addEventListener?.("change", update);
    return () => m.removeEventListener?.("change", update);
  }, []);
  return can;
}

export function LeadsClient({ locale }: { locale: string }) {
  const { data: session, status } = useSession();
  const accessToken = session?.accessToken ?? null;
  const [view, setView] = useViewMode();
  const canDrag = useCanDrag();

  const [leads, setLeads] = useState<LeadVm[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

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
        const msg = err instanceof Error ? err.message : "Failed to load leads";
        if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

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
          <div className="lk-search">
            <Search size={16} className="lk-search__icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search tenant, listing, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search leads"
            />
          </div>

          <div className="lk-view-toggle" role="group" aria-label="View mode">
            <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>
              <LayoutGrid size={14} aria-hidden="true" />
              Board
            </button>
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
              <List size={14} aria-hidden="true" />
              List
            </button>
          </div>

          <a
            href="/v1/owner/leads/export"
            className="btn btn--secondary btn--sm"
            download
            onClick={() => track("lead_csv_exported")}
          >
            <Download size={14} aria-hidden="true" style={{ marginRight: 4 }} />
            Export CSV
          </a>
        </div>
      </div>

      <LeadStatsWidget accessToken={accessToken} />

      <div style={{ marginTop: "var(--space-5)" }}>
        {error ? (
          <div className="alert alert--error" role="alert">
            {error}
          </div>
        ) : loading ? (
          <LeadKanbanSkeleton />
        ) : view === "board" ? (
          <LeadKanban
            accessToken={accessToken}
            leads={leads}
            onLeadsChange={setLeads}
            searchQuery={search}
            enableDrag={canDrag}
          />
        ) : (
          <LeadsPipeline accessToken={accessToken} />
        )}
      </div>
    </section>
  );
}
