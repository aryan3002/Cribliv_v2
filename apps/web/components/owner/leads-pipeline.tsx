"use client";

import { useEffect, useState, useCallback } from "react";
import { signOut } from "next-auth/react";
import {
  fetchOwnerLeads,
  updateLeadStatus,
  type LeadVm,
  type LeadStatus
} from "../../lib/owner-api";
import { LeadCard } from "./lead-card";

interface Props {
  accessToken: string;
}

const TABS: Array<{ value: LeadStatus | "all"; label: string; color?: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "New", color: "#3b82f6" },
  { value: "contacted", label: "Contacted", color: "#f59e0b" },
  { value: "visit_scheduled", label: "Visit Scheduled", color: "#5046e5" },
  { value: "deal_done", label: "Deal Done", color: "#22c55e" },
  { value: "lost", label: "Lost", color: "#9ca3af" }
];

export function LeadsPipeline({ accessToken }: Props) {
  const [leads, setLeads] = useState<LeadVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<LeadStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [updatingLeadId, setUpdatingLeadId] = useState<string | null>(null);
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({});

  const load = useCallback(
    async (status: LeadStatus | "all", pg: number, append: boolean) => {
      try {
        const res = await fetchOwnerLeads(accessToken, {
          status: status === "all" ? undefined : status,
          page: pg
        });
        setLeads((prev) => (append ? [...prev, ...res.items] : res.items));
        setTotal(res.total);

        if (!append) {
          const counts: Record<string, number> = {};
          if (status === "all") {
            counts.all = res.total;
          } else {
            counts[status] = res.total;
          }
          setTabCounts((prev) => ({ ...prev, ...counts }));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load leads";
        if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
        setError(msg);
      }
    },
    [accessToken]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    setPage(1);
    void load(activeStatus, 1, false).finally(() => setLoading(false));
  }, [activeStatus, load]);

  async function handleLoadMore() {
    const nextPage = page + 1;
    setLoadingMore(true);
    await load(activeStatus, nextPage, true);
    setPage(nextPage);
    setLoadingMore(false);
  }

  async function handleStatusChange(leadId: string, newStatus: LeadStatus, notes?: string) {
    const prevLeads = leads;
    // Optimistic update
    setLeads((prev) =>
      prev.map((l) =>
        l.id === leadId
          ? {
              ...l,
              status: newStatus,
              ownerNotes: notes ?? l.ownerNotes,
              statusChangedAt: new Date().toISOString()
            }
          : l
      )
    );
    setUpdatingLeadId(leadId);
    setNotice(null);

    try {
      await updateLeadStatus(accessToken, leadId, newStatus, notes);
      setNotice("Lead status updated.");
      setTimeout(() => setNotice(null), 3000);
    } catch (err) {
      // Revert on error
      setLeads(prevLeads);
      const msg = err instanceof Error ? err.message : "Failed to update lead";
      if (msg.toLowerCase().includes("unauthorized")) void signOut({ redirect: false });
      setNotice(`Error: ${msg}`);
      setTimeout(() => setNotice(null), 5000);
    } finally {
      setUpdatingLeadId(null);
    }
  }

  return (
    <div>
      {/* Status filter row */}
      <div
        className="dash-filter-row"
        role="tablist"
        aria-label="Filter leads by status"
        style={{ marginBottom: "var(--space-5)" }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeStatus === tab.value}
            className={`dash-filter-chip${activeStatus === tab.value ? " dash-filter-chip--active" : ""}`}
            onClick={() => setActiveStatus(tab.value)}
          >
            {tab.color && (
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: activeStatus === tab.value ? tab.color : "var(--border-strong)",
                  transition: "background var(--transition-fast)"
                }}
              />
            )}
            {tab.label}
            {tabCounts[tab.value] !== undefined && (
              <span className="dash-filter-chip__count">{tabCounts[tab.value]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Notice banner */}
      {notice && (
        <div
          className={`alert ${notice.startsWith("Error") ? "alert--error" : "alert--success"}`}
          role="status"
          style={{ marginBottom: "var(--space-4)" }}
        >
          {notice}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "var(--space-4)"
          }}
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="skeleton-card"
              style={{ height: 180, borderRadius: "var(--radius-lg)" }}
            />
          ))}
        </div>
      ) : error ? (
        <div className="alert alert--error" role="alert">
          {error}
        </div>
      ) : leads.length === 0 ? (
        <div className="empty-state" style={{ padding: "var(--space-12) var(--space-6)" }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--brand-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              marginBottom: "var(--space-4)"
            }}
          >
            👥
          </div>
          <h3
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 18,
              fontWeight: 600,
              color: "var(--text-primary)",
              marginBottom: "var(--space-2)"
            }}
          >
            No leads
            {activeStatus !== "all" ? ` with status "${activeStatus.replace("_", " ")}"` : " yet"}
          </h3>
          <p
            style={{
              fontSize: 14,
              color: "var(--text-secondary)",
              maxWidth: 360,
              textAlign: "center"
            }}
          >
            {activeStatus === "all"
              ? "Once tenants enquire about your listings, they'll appear here."
              : "Try selecting a different status filter above."}
          </p>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: "var(--space-4)"
            }}
          >
            {leads.map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                onStatusChange={handleStatusChange}
                updating={updatingLeadId === lead.id}
              />
            ))}
          </div>

          {/* Pagination */}
          {leads.length < total && (
            <div style={{ textAlign: "center", marginTop: "var(--space-6)" }}>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => void handleLoadMore()}
                disabled={loadingMore}
                style={{ minWidth: 160 }}
              >
                {loadingMore ? "Loading…" : `Load more (${total - leads.length} remaining)`}
              </button>
            </div>
          )}

          <p
            style={{
              fontSize: 12,
              color: "var(--text-tertiary)",
              textAlign: "center",
              marginTop: "var(--space-4)"
            }}
          >
            Showing {leads.length} of {total} leads
          </p>
        </>
      )}
    </div>
  );
}
