"use client";
import { useState } from "react";
import type { PgDashboardListingHealth } from "@cribliv/shared-types";
import { motion } from "framer-motion";
import {
  Eye,
  Heart,
  MousePointerClick,
  Clock,
  ArrowUpRight,
  MapPin,
  Building2,
  BedDouble,
  DoorOpen,
  Users,
  Search,
  Flame,
  TrendingUp,
  TrendingDown,
  Minus
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

function relative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
function titleCase(s?: string | null): string {
  if (!s) return "";
  return s
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function statusVariant(status: string) {
  const s = status.toLowerCase();
  if (s === "active" || s === "published") return styles.lbadgeActive;
  if (s === "draft" || s === "pending" || s === "pending_review") return styles.lbadgePending;
  return styles.lbadgeDraft;
}
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const GENDER: Record<string, string> = { boys: "Boys", girls: "Girls", coed: "Co-ed" };

export default function ListingHealthCard({ data }: { data: PgDashboardListingHealth }) {
  const [imgOk, setImgOk] = useState(true);
  const score = data.composite_score ?? null;
  const scoreColor =
    score == null ? "#94a3b8" : score >= 70 ? "#10b981" : score >= 40 ? "#f59e0b" : "#ef4444";
  const name = data.title?.trim() || `PG #${data.listing_id.slice(0, 8)}`;
  const loc = [titleCase(data.locality_slug), titleCase(data.city_slug)].filter(Boolean).join(", ");
  const rent =
    data.starting_rent_paise && data.starting_rent_paise > 0
      ? `from ₹${Math.round(data.starting_rent_paise / 100).toLocaleString("en-IN")}/mo`
      : null;

  const chips: { icon: React.ReactNode; label: string }[] = [];
  if (data.gender_policy)
    chips.push({
      icon: <Users size={11} />,
      label: GENDER[data.gender_policy] ?? data.gender_policy
    });
  if (data.total_beds)
    chips.push({ icon: <BedDouble size={11} />, label: `${data.total_beds} beds` });
  if (data.total_vacancy != null)
    chips.push({ icon: <DoorOpen size={11} />, label: `${data.total_vacancy} vacant` });

  return (
    <motion.article
      className={styles.lcard}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className={styles.lmedia}>
        {data.cover_photo && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.cover_photo} alt={name} loading="lazy" onError={() => setImgOk(false)} />
        ) : (
          <Building2 size={28} strokeWidth={1.5} />
        )}
        <span className={`${styles.lbadge} ${statusVariant(data.status)} ${styles.lmediaBadge}`}>
          <span className={styles.lbadgeDot} /> {titleCase(data.status)}
        </span>
        {rent && <span className={styles.lmediaRent}>{rent}</span>}
      </div>

      <div className={styles.lcardTop}>
        <div style={{ minWidth: 0 }}>
          <div className={styles.lcardId}>PG listing</div>
          <div className={styles.lcardTitle}>{name}</div>
          {loc && (
            <span className={styles.lcardLoc}>
              <MapPin size={12} /> {loc}
            </span>
          )}
        </div>
      </div>

      {chips.length > 0 && (
        <div className={styles.lchips}>
          {chips.map((c) => (
            <span key={c.label} className={styles.lchip}>
              {c.icon}
              {c.label}
            </span>
          ))}
        </div>
      )}

      <div className={styles.lstats} style={{ marginTop: 14 }}>
        <div className={styles.lstat}>
          <div className={styles.lstatVal}>{data.views_7d.toLocaleString()}</div>
          <div className={styles.lstatLabel}>
            <Eye size={11} /> Views
          </div>
        </div>
        <div className={styles.lstat}>
          <div className={styles.lstatVal}>{data.contact_unlocks_7d.toLocaleString()}</div>
          <div className={styles.lstatLabel}>
            <Heart size={11} /> Leads
          </div>
        </div>
        <div className={styles.lstat}>
          <div className={styles.lstatVal}>
            {data.search_appearances_7d > 0 ? pct(data.ctr_7d) : "—"}
          </div>
          <div className={styles.lstatLabel}>
            <MousePointerClick size={11} /> CTR
          </div>
        </div>
      </div>

      <div className={styles.lcardBody}>
        {score != null && (
          <>
            <div className={styles.lscoreRow}>
              <span className={styles.lscoreLabel}>Listing quality</span>
              <span className={styles.lscoreVal} style={{ color: scoreColor }}>
                {score}/100
              </span>
            </div>
            <div className={styles.lbarTrack}>
              <motion.div
                className={styles.lbarFill}
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                style={{ background: scoreColor }}
              />
            </div>
          </>
        )}

        <div className={styles.linsightLine}>
          <span className={styles.linsightItem}>
            <Search size={12} style={{ color: "var(--d-text-soft)" }} />
            <strong>{data.search_appearances_7d.toLocaleString()}</strong> appearances
          </span>
          <span className={styles.linsightItem}>
            <Flame size={12} style={{ color: "var(--d-text-soft)" }} />
            <strong>{data.views_7d > 0 ? pct(data.interest_rate_7d) : "—"}</strong> interest
          </span>
        </div>

        {(() => {
          const series = data.trend_7d ?? [];
          const total = series.reduce((n, p) => n + (p.views ?? 0), 0);
          if (total <= 0) {
            return (
              <>
                <div className={styles.lsparkHead}>
                  <span className={styles.lsparkLabel}>
                    <Eye size={12} /> Views · last 7 days
                  </span>
                </div>
                <div className={styles.lsparkEmpty}>No views in the last 7 days</div>
              </>
            );
          }
          const first = series[0]?.views ?? 0;
          const last = series[series.length - 1]?.views ?? 0;
          const delta = first > 0 ? Math.round(((last - first) / first) * 100) : null;
          const up = delta != null && delta > 0;
          const down = delta != null && delta < 0;
          const trendColor = up ? "#059669" : down ? "#dc2626" : "var(--d-text-soft)";
          return (
            <>
              <div className={styles.lsparkHead}>
                <span className={styles.lsparkLabel}>
                  <Eye size={12} /> Views · last 7 days
                </span>
                <span className={styles.lsparkTrend} style={{ color: trendColor }}>
                  {up ? (
                    <TrendingUp size={12} />
                  ) : down ? (
                    <TrendingDown size={12} />
                  ) : (
                    <Minus size={12} />
                  )}
                  {delta != null ? `${up ? "+" : ""}${delta}%` : `${total} total`}
                </span>
              </div>
              <div className={styles.lspark}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id={`g-${data.listing_id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area
                      type="monotone"
                      dataKey="views"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill={`url(#g-${data.listing_id})`}
                      isAnimationActive={false}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          );
        })()}

        <div className={styles.lfooter}>
          <Clock size={11} /> Updated {relative(data.last_updated)}
          <ArrowUpRight
            size={13}
            style={{ marginLeft: "auto", color: "var(--d-primary-strong)" }}
          />
        </div>
      </div>
    </motion.article>
  );
}
