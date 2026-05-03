"use client";

import { Drawer } from "../primitives/Drawer";
import type { OwnerHealthRow } from "../../../lib/admin-api";
import {
  formatMinutes,
  formatNumber,
  formatPhone,
  formatRelativeTime
} from "../../../lib/admin/format";

const COMPONENT_LABELS: Record<keyof OwnerHealthRow["components"], string> = {
  listings: "Listings (active vs paused)",
  response: "Response time",
  deal: "Deal-done rate",
  freshness: "Login recency",
  trust: "Report-free streak"
};

interface Props {
  owner: OwnerHealthRow | null;
  onClose: () => void;
  onAdjustWallet?: (ownerUserId: string) => void;
  onPauseListings?: (ownerUserId: string) => void;
}

export function HealthDrawer({ owner, onClose, onAdjustWallet, onPauseListings }: Props) {
  return (
    <Drawer
      open={!!owner}
      onClose={onClose}
      title={owner?.name || formatPhone(owner?.phone) || "Owner"}
      subtitle={owner ? `${formatPhone(owner.phone)} · ${owner.owner_user_id}` : undefined}
      footer={
        owner ? (
          <>
            {onAdjustWallet && (
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => onAdjustWallet(owner.owner_user_id)}
              >
                Adjust wallet
              </button>
            )}
            {onPauseListings && owner.listings_active > 0 && (
              <button
                type="button"
                className="admin-btn admin-btn--ghost"
                onClick={() => onPauseListings(owner.owner_user_id)}
              >
                Pause listings
              </button>
            )}
            <button type="button" className="admin-btn admin-btn--primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : undefined
      }
    >
      {owner && (
        <div className="admin-health-detail">
          <div className="admin-health-detail__hero">
            <div className="admin-health-detail__big-score" data-grade={owner.grade}>
              {owner.score}
            </div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-heading)" }}>
                Grade {owner.grade}
              </div>
              <div style={{ color: "var(--ad-text-3)", fontSize: 12.5, marginTop: 4 }}>
                Last seen {formatRelativeTime(owner.last_login_at)} ·{" "}
                {owner.report_count > 0 ? `${owner.report_count} reports` : "no reports"}
              </div>
            </div>
          </div>

          <section>
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
              Score breakdown
            </h4>
            <div className="admin-health-detail__components">
              {(Object.keys(owner.components) as Array<keyof OwnerHealthRow["components"]>).map(
                (k) => {
                  const c = owner.components[k];
                  return (
                    <div key={k} className="admin-health-detail__component">
                      <div className="admin-health-detail__component-name">
                        {COMPONENT_LABELS[k]}
                        <span style={{ color: "var(--ad-text-3)", marginLeft: 6 }}>
                          ×{(c.weight * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="admin-health-detail__component-bar">
                        <div style={{ width: `${c.value}%` }} />
                      </div>
                      <div className="admin-health-detail__component-value">{c.value}</div>
                    </div>
                  );
                }
              )}
            </div>
          </section>

          <section>
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
              Last 60 days
            </h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                gap: 12
              }}
            >
              <Metric label="Active listings" value={formatNumber(owner.listings_active)} />
              <Metric label="Paused listings" value={formatNumber(owner.listings_paused)} />
              <Metric label="Avg response" value={formatMinutes(owner.avg_response_minutes)} />
              <Metric label="Unlocks" value={formatNumber(owner.unlocks_60d)} />
              <Metric label="Deals done" value={formatNumber(owner.deals_done_60d)} />
              <Metric label="Reports" value={formatNumber(owner.report_count)} />
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--ad-surface-2)",
        padding: "10px 12px",
        borderRadius: 8
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ad-text-3)"
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 4,
          fontFamily: "var(--font-heading)",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--ad-text)"
        }}
      >
        {value}
      </div>
    </div>
  );
}
