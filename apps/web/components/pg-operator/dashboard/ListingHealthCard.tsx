"use client";
import type { PgDashboardListingHealth } from "@cribliv/shared-types";
import { motion } from "framer-motion";
import { Activity, Eye, Unlock, Clock } from "lucide-react";
import { ListingFunnel } from "./ListingFunnel";

function relative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function getStatusVariant(status: string) {
  switch (status.toLowerCase()) {
    case "active":
    case "published":
      return "active";
    case "draft":
    case "pending":
      return "pending";
    default:
      return "draft";
  }
}

export default function ListingHealthCard({ data }: { data: PgDashboardListingHealth }) {
  const variant = getStatusVariant(data.status);

  return (
    <motion.article
      className="pgo-glass"
      data-status={data.status}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.3 }}
    >
      <div className="pgo-stat-card">
        {/* Header */}
        <div className="pgo-stat-card__header">
          <div className="pgo-stat-card__title">
            <Activity size={18} className="pgo-stat-card__title-icon" />
            <span>Listing Health</span>
          </div>
          <div className="pgo-stat-card__badge">
            <span className={`pgo-stat-card__badge-dot pgo-stat-card__badge-dot--${variant}`} />
            {data.status}
          </div>
        </div>

        {/* Metrics */}
        <div className="pgo-stat-card__metrics">
          <div className="pgo-metric">
            <div className="pgo-metric__label">
              <Eye size={14} /> Views (7d)
            </div>
            <div className="pgo-metric__value">{data.views_7d.toLocaleString()}</div>
          </div>
          <div className="pgo-metric">
            <div className="pgo-metric__label">
              <Unlock size={14} /> Unlocks (7d)
            </div>
            <div className="pgo-metric__value">{data.contact_unlocks_7d.toLocaleString()}</div>
          </div>
        </div>

        <ListingFunnel data={data} />

        {/* Quality score */}
        {data.composite_score != null && (
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 4
              }}
            >
              <span className="pgo-caption" style={{ fontSize: 12 }}>
                Listing Quality
              </span>
              <span className="pgo-caption" style={{ fontWeight: 600, fontSize: 12 }}>
                {data.composite_score}/100
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={data.composite_score}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Listing quality score"
              style={{
                height: 6,
                borderRadius: 3,
                background: "var(--pgo-border, rgba(255,255,255,0.12))",
                overflow: "hidden"
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${data.composite_score}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                style={{
                  height: "100%",
                  borderRadius: 3,
                  background:
                    data.composite_score >= 70
                      ? "var(--pgo-success, #22c55e)"
                      : data.composite_score >= 40
                        ? "var(--pgo-warning, #f59e0b)"
                        : "var(--pgo-danger, #ef4444)"
                }}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pgo-metric__footer">
          <Clock size={12} />
          Updated {relative(data.last_updated)}
        </div>
      </div>
    </motion.article>
  );
}
