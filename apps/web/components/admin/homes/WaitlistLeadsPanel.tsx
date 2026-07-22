"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, Phone, RefreshCw, Users } from "lucide-react";
import type { WaitlistLead } from "@cribliv/shared-types";
import { fetchAdminHomeWaitlist } from "../../../lib/admin-api";
import { useFlag } from "../../../lib/feature-flags";
import { formatRelativeTime } from "../../../lib/admin/format";
import { EmptyState } from "../primitives/EmptyState";
import { SectionCard } from "../primitives/SectionCard";
import { StatusPill } from "../primitives/StatusPill";

const PREVIEW_LIMIT = 5;

interface Props {
  token: string;
  listingId: string;
  /** Owner-safe count (from AdminHomeDetail.listing.waitlist_count) — shown immediately, before the phone-number fetch resolves. */
  count: number;
}

/**
 * Admin-only waitlist leads panel for a Verified Homes listing. Unlike the
 * owner's count-only view, admins see actual phone numbers here — that is
 * the point of this surface (these are actionable leads). Self-gates behind
 * `ff_unavailable_listings` so it is inert even if a caller forgets to check
 * the flag before rendering it.
 */
export function WaitlistLeadsPanel({ token, listingId, count }: Props) {
  const flagOn = useFlag("ff_unavailable_listings");
  const [leads, setLeads] = useState<WaitlistLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!flagOn) return;
    let cancelled = false;
    setLeads(null);
    setError(null);

    void fetchAdminHomeWaitlist(token, listingId)
      .then((items) => {
        if (!cancelled) setLeads(items);
      })
      .catch((fetchError: unknown) => {
        if (cancelled) return;
        setError(fetchError instanceof Error ? fetchError.message : "Could not load the waitlist");
      });

    return () => {
      cancelled = true;
    };
  }, [flagOn, token, listingId, reloadKey]);

  if (!flagOn) return null;

  // Match the server's `waitlist_count` semantics (status IN ('waiting',
  // 'ready')): `fetchAdminHomeWaitlist`/`listForListing` returns every
  // `listing_availability_alerts` row regardless of status, but
  // `notified`/`cancelled` leads are historical, not actionable — they must
  // not be rendered, called, exported, or counted here. Filter once and base
  // everything below (rows, hasMore, CSV, empty state) on this list.
  const actionableLeads = (leads ?? []).filter(
    (lead) => lead.status === "waiting" || lead.status === "ready"
  );

  function downloadCsv() {
    if (actionableLeads.length === 0) return;
    const header = "phone,joined_at,type,status";
    const rows = actionableLeads.map((lead) =>
      [lead.phone, lead.created_at, lead.user_id ? "logged_in" : "guest", lead.status]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header, ...rows].join("\n");

    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `waitlist-${listingId}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // Best-effort — some embedded/test environments don't implement blob URLs.
    }
  }

  const visibleLeads = expanded ? actionableLeads : actionableLeads.slice(0, PREVIEW_LIMIT);
  const hasMore = actionableLeads.length > PREVIEW_LIMIT;

  return (
    <SectionCard
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          Waitlist leads
          <StatusPill status="waitlist" tone="warn" label={`${count} waiting`} noDot />
        </span>
      }
      subtitle="Seekers who asked to be notified when this home is available again. Phone numbers are visible to admins only."
      flush
    >
      {error ? (
        <div className="admin-home-workspace__error" role="alert">
          <div>
            <strong>Could not load the waitlist</strong>
            <span>{error}</span>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw size={16} aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : leads === null ? (
        <div style={{ padding: 16 }} role="status" aria-label="Loading waitlist">
          <span className="admin-homes-skeleton" />
        </div>
      ) : actionableLeads.length === 0 ? (
        <EmptyState
          title="No one is waiting yet"
          hint="Seekers who ask to be notified when this home is available again will show up here with their phone number."
          icon={<Users size={18} aria-hidden="true" />}
        />
      ) : (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Phone</th>
                  <th scope="col">Joined</th>
                  <th scope="col">Type</th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td>{lead.phone}</td>
                    <td>{formatRelativeTime(lead.created_at)}</td>
                    <td>{lead.user_id ? "Logged in" : "Guest"}</td>
                    <td>
                      <a
                        href={`tel:${lead.phone}`}
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                      >
                        <Phone size={14} aria-hidden="true" />
                        Call
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 16px",
              borderTop: "1px solid #F3F4F6"
            }}
          >
            {hasMore && (
              <button
                type="button"
                className="admin-btn admin-btn--ghost admin-btn--sm"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? (
                  <ChevronUp size={14} aria-hidden="true" />
                ) : (
                  <ChevronDown size={14} aria-hidden="true" />
                )}
                {expanded ? "Show less" : `View all (${actionableLeads.length})`}
              </button>
            )}
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={downloadCsv}
            >
              <Download size={14} aria-hidden="true" />
              Export CSV
            </button>
          </div>
        </>
      )}
    </SectionCard>
  );
}
