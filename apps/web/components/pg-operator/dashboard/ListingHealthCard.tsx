"use client";
import { useState } from "react";
import type { PgDashboardListingHealth } from "@cribliv/shared-types";
import { motion } from "framer-motion";
import { Eye, Heart, MousePointerClick, MapPin, BedDouble, DoorOpen, Users } from "lucide-react";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

function titleCase(s?: string | null): string {
  if (!s) return "";
  return s
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
function statusVariant(status: string) {
  const s = status.toLowerCase();
  if (s === "active" || s === "published" || s === "live") return styles.lbadgeActive;
  if (s === "draft" || s === "pending" || s === "pending_review") return styles.lbadgePending;
  return styles.lbadgeDraft;
}
function statusLabel(status: string) {
  return status.replace(/_/g, " ");
}
function relativeUpdated(iso?: string | null) {
  if (!iso) return null;
  const updated = new Date(iso).getTime();
  if (!Number.isFinite(updated)) return null;
  const days = Math.floor((Date.now() - updated) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const GENDER: Record<string, string> = { boys: "Boys", girls: "Girls", coed: "Co-ed" };

function scoreGradient(score: number | null): string {
  if (score == null) return "var(--d-border-strong)";
  if (score >= 70) return "var(--d-success)";
  if (score >= 40) return "var(--d-brand)";
  return "var(--d-danger)";
}

function scoreDisplayColor(score: number | null): string {
  if (score == null) return "var(--d-text-soft)";
  if (score >= 70) return "var(--d-success)";
  if (score >= 40) return "var(--d-warning)";
  return "var(--d-danger)";
}

export default function ListingHealthCard({
  data,
  heroGradient
}: {
  data: PgDashboardListingHealth;
  heroGradient?: string;
}) {
  const [imgOk, setImgOk] = useState(true);
  const score = data.composite_score ?? null;
  const name = data.title?.trim() || `PG #${data.listing_id.slice(0, 8)}`;
  const loc = [titleCase(data.locality_slug), titleCase(data.city_slug)].filter(Boolean).join(", ");
  const updated = relativeUpdated(data.last_updated);
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

  // Inline SVG sparkline from trend_7d
  const series = (data.trend_7d ?? []).map((p) => p.views ?? 0);
  const sparkMax = Math.max(...series, 1);
  const pts = series
    .map((v, i) => `${(i / (series.length - 1 || 1)) * 80},${30 - (v / sparkMax) * 28}`)
    .join(" ");
  const sparkColor = data.status === "active" ? "var(--d-success)" : "var(--d-brand)";

  return (
    <motion.article
      className={styles.lcard}
      data-status={data.status}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Hero */}
      <div
        className={styles.lhero}
        style={{ background: heroGradient ?? "linear-gradient(135deg,#16335f,#0b1f3d)" }}
      >
        <div className={styles.lheroOverlay} />
        {data.cover_photo && imgOk && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.cover_photo} alt={name} loading="lazy" onError={() => setImgOk(false)} />
        )}
        <span className={`${styles.lbadge} ${statusVariant(data.status)}`}>
          <span className={styles.lbadgeDot} />
          {statusLabel(data.status)}
        </span>
        {rent && <span className={styles.lprice}>{rent}</span>}
      </div>

      {/* Card body */}
      <div className={styles.lcardBody}>
        <div className={styles.lcardTitle}>{name}</div>
        {loc && (
          <span className={styles.lcardLoc}>
            <MapPin size={12} /> {loc}
          </span>
        )}
        {updated && <div className={styles.lupdated}>Updated {updated}</div>}

        {chips.length > 0 && (
          <div className={styles.lchips}>
            {chips.map((c) => (
              <span key={c.label} className={styles.lchip}>
                {c.icon} {c.label}
              </span>
            ))}
          </div>
        )}

        {/* Metrics + sparkline */}
        <div className={styles.lmetrics}>
          <div className={styles.lmetric}>
            <div className={styles.lmetricVal}>{data.views_7d.toLocaleString()}</div>
            <div className={styles.lmetricLabel}>
              <Eye size={11} /> Views
            </div>
          </div>
          <div className={styles.lmetric}>
            <div className={styles.lmetricVal}>{data.contact_unlocks_7d.toLocaleString()}</div>
            <div className={styles.lmetricLabel}>
              <Heart size={11} /> Leads
            </div>
          </div>
          <div className={styles.lmetric}>
            <div className={styles.lmetricVal}>
              {data.search_appearances_7d > 0 ? pct(data.ctr_7d) : "—"}
            </div>
            <div className={styles.lmetricLabel}>
              <MousePointerClick size={11} /> CTR
            </div>
          </div>
          {series.length >= 2 ? (
            <svg viewBox="0 0 80 30" className={styles.lspark}>
              <polyline
                points={pts}
                fill="none"
                stroke={sparkColor}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 80 30" className={styles.lspark}>
              <text x="40" y="18" textAnchor="middle" fontSize="9" fill="var(--d-text-soft)">
                No data
              </text>
            </svg>
          )}
        </div>

        {/* Quality bar */}
        {score != null && (
          <>
            <div className={styles.lscoreRow}>
              <span className={styles.lscoreLabel}>Listing quality</span>
              <span className={styles.lscoreVal} style={{ color: scoreDisplayColor(score) }}>
                {score}/100
              </span>
            </div>
            <div className={styles.lbarTrack}>
              <motion.div
                className={styles.lbarFill}
                initial={{ width: 0 }}
                animate={{ width: `${score}%` }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                style={{ background: scoreGradient(score) }}
              />
            </div>
          </>
        )}
      </div>
    </motion.article>
  );
}
