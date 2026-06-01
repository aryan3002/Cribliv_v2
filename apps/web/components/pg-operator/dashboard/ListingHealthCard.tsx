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

        {/* Footer */}
        <div className="pgo-metric__footer">
          <Clock size={12} />
          Updated {relative(data.last_updated)}
        </div>
      </div>
    </motion.article>
  );
}
