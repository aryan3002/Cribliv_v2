"use client";

import { useEffect, useState, type ReactNode } from "react";
import type {
  AdminLeadOwnerDetail,
  AdminLeadOwnerRollupRow,
  LeadAccessState
} from "@cribliv/shared-types";
import { Drawer } from "../primitives/Drawer";
import { StatCard } from "../primitives/StatCard";
import { StatusPill, type PillTone } from "../primitives/StatusPill";
import { EmptyState } from "../primitives/EmptyState";
import { HealthBadge } from "../owner-health/HealthBadge";
import { ApiError } from "../../../lib/api";
import { fetchAdminLeadByOwner } from "../../../lib/admin-api";
import {
  formatMinutes,
  formatNumber,
  formatPct,
  formatRelativeTime
} from "../../../lib/admin/format";

interface Props {
  /** The clicked rollup row — carries name/role/health instantly so the header
   * doesn't wait on the detail fetch below (same pattern as LeadDrawer's `row`). */
  row: AdminLeadOwnerRollupRow | null;
  range: string;
  accessToken: string;
  onClose: () => void;
}

// StatusPill's default tone map has no entries for lead access states — same
// reasoning as LeadBoard's ACCESS_TONE constant (duplicated here rather than
// shared since it's a 4-line const and the two components don't otherwise
// share a module).
const ACCESS_TONE: Record<LeadAccessState, PillTone> = {
  free: "brand",
  unlocked: "trust",
  locked: "warn",
  expired: "danger"
};

function humanizeRole(role: string): string {
  return role.replace(/_/g, " ");
}

export function OwnerDrillDrawer({ row, range, accessToken, onClose }: Props) {
  const [detail, setDetail] = useState<AdminLeadOwnerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerId = row?.owner_user_id ?? null;

  useEffect(() => {
    if (!ownerId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null); // drop the previously-viewed owner's detail (or the pre-refresh one)
    fetchAdminLeadByOwner(accessToken, ownerId, range)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === "not_found") {
          setError("Owner not found");
        } else if (err instanceof ApiError && err.code === "feature_disabled") {
          setError("Lead Center is disabled");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load owner detail");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, range, accessToken]);

  return (
    <Drawer
      open={row != null}
      onClose={onClose}
      title={row?.name ?? "Owner"}
      subtitle={row ? humanizeRole(row.role) : undefined}
    >
      {row && (
        <div style={{ display: "grid", gap: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {row.health_score != null && row.health_grade != null ? (
              <HealthBadge score={row.health_score} grade={row.health_grade} />
            ) : (
              <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>No health score yet</span>
            )}
            {detail && (
              <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{detail.phone_masked}</span>
            )}
          </div>

          {row.role === "pg_operator" && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--ad-text-2)",
                background: "var(--ad-surface-2)",
                border: "1px solid var(--ad-border)",
                borderRadius: 8,
                padding: "10px 12px"
              }}
            >
              Full PG analytics → PG Listings tab
            </div>
          )}

          {loading && <div style={{ color: "var(--ad-text-3)" }}>Loading…</div>}
          {!loading && error && <EmptyState title="Couldn't load owner detail" hint={error} />}

          {!loading && !error && detail && (
            <>
              <section>
                <SectionHeading>Lifetime pipeline</SectionHeading>
                <div className="admin-stat-grid">
                  <StatCard label="New" value={formatNumber(detail.funnel.new)} />
                  <StatCard label="Contacted" value={formatNumber(detail.funnel.contacted)} />
                  <StatCard
                    label="Visit scheduled"
                    value={formatNumber(detail.funnel.visit_scheduled)}
                  />
                  <StatCard
                    label="Deal done"
                    value={formatNumber(detail.funnel.deal_done)}
                    tone="brand"
                  />
                  <StatCard
                    label="Lost"
                    value={formatNumber(detail.funnel.lost)}
                    tone={detail.funnel.lost > 0 ? "warn" : "default"}
                  />
                  <StatCard
                    label="Total · lifetime"
                    value={formatNumber(detail.funnel.total)}
                    tone="trust"
                  />
                </div>
              </section>

              <section>
                <SectionHeading>{`Rates · last ${range}`}</SectionHeading>
                <div className="admin-stat-grid">
                  <StatCard
                    label="Median response"
                    value={formatMinutes(detail.rates.median_response_minutes)}
                  />
                  {/* Backend field is named called_within_24h_rate but the query doesn't
                   * actually gate on a 24h window (see Slice-5 carry-forward note on the
                   * rename) — label it by what it measures today, not the field name. */}
                  <StatCard
                    label="Called rate"
                    value={formatPct(detail.rates.called_within_24h_rate)}
                  />
                  <StatCard
                    label="Team-rescue rate"
                    value={formatPct(detail.rates.team_rescue_rate)}
                    tone="warn"
                  />
                  <StatCard
                    label="Refund rate"
                    value={formatPct(detail.rates.refund_rate)}
                    tone="danger"
                  />
                  <StatCard
                    label="Dispute rate"
                    value={formatPct(detail.rates.dispute_rate)}
                    tone={detail.rates.dispute_rate > 0 ? "danger" : "default"}
                  />
                </div>
              </section>

              <section>
                <SectionHeading>{`In-flight (${detail.in_flight.length})`}</SectionHeading>
                {detail.in_flight.length === 0 ? (
                  <EmptyState
                    title="No in-flight leads"
                    hint="Nothing currently needs a callback from this owner."
                  />
                ) : (
                  <div className="admin-feed">
                    {detail.in_flight.map((lead) => (
                      <div className="admin-feed__item" key={lead.lead_id}>
                        <span
                          className="admin-feed__dot"
                          data-severity={
                            lead.access_state === "expired"
                              ? "high"
                              : lead.access_state === "locked"
                                ? "medium"
                                : "low"
                          }
                          aria-hidden="true"
                        />
                        <div>
                          <div className="admin-feed__summary">
                            <strong>{lead.seeker.name}</strong>
                            <span style={{ color: "var(--ad-text-2)" }}>
                              {" "}
                              — {lead.listing_title}
                            </span>
                          </div>
                          <div className="admin-feed__meta">
                            <StatusPill
                              status={lead.access_state}
                              tone={ACCESS_TONE[lead.access_state] ?? "muted"}
                              noDot
                            />
                            {lead.called_at ? (
                              <span className="admin-feed__chip">
                                ✓ {lead.called_by === "team" ? "team" : "owner"} called
                              </span>
                            ) : (
                              <span className="admin-feed__chip">✗ not called</span>
                            )}
                          </div>
                        </div>
                        <span className="admin-feed__time">
                          {formatRelativeTime(lead.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h4
      style={{
        margin: "0 0 12px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: "var(--ad-text-3)"
      }}
    >
      {children}
    </h4>
  );
}
