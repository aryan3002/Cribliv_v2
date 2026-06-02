"use client";

import { SectionCard } from "./primitives/SectionCard";
import { StatCard } from "./primitives/StatCard";
import { EmptyState } from "./primitives/EmptyState";
import type { PgListingAnalytics } from "../../lib/admin-api";

interface Props {
  data: PgListingAnalytics;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Content quality + score health: geocode rate, avg photos, the missing-field
 * heatmap, and the persisted listing_scores distribution (Plan 2 → ranking).
 */
export function PgListingQuality({ data }: Props) {
  const { quality, score_health } = data;
  const maxMissing = Math.max(1, ...quality.missing_field_heatmap.map((m) => m.count));
  const distTotal = Math.max(
    1,
    score_health.distribution.reduce((s, d) => s + d.count, 0)
  );

  return (
    <SectionCard title="Content quality & score health" subtitle={`Last ${data.range_days} days`}>
      <div className="admin-stat-grid" style={{ marginBottom: 14 }}>
        <StatCard label="Geocode rate" value={pct(quality.geocode_rate)} tone="trust" />
        <StatCard label="Avg photos" value={quality.avg_photos.toFixed(1)} />
        <StatCard
          label="Avg score"
          value={
            score_health.avg_composite != null ? Math.round(score_health.avg_composite * 100) : "—"
          }
          tone="brand"
        />
        <StatCard
          label="Scored / active"
          value={`${score_health.with_score}/${score_health.active_pg}`}
        />
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Score distribution</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {score_health.distribution.map((d) => (
          <div
            key={d.bucket}
            style={{ flex: 1, textAlign: "center" }}
            data-testid={`dist-${d.bucket}`}
          >
            <div
              style={{
                height: 8,
                borderRadius: 4,
                background:
                  d.bucket === "high"
                    ? "var(--pgo-success,#22c55e)"
                    : d.bucket === "mid"
                      ? "var(--pgo-warning,#f59e0b)"
                      : "var(--pgo-danger,#ef4444)",
                width: `${Math.max(4, (d.count / distTotal) * 100)}%`,
                margin: "0 auto"
              }}
            />
            <div style={{ fontSize: 11, color: "var(--ad-text-3)", marginTop: 4 }}>
              {d.bucket} · {d.count}
            </div>
          </div>
        ))}
      </div>
      {score_health.without_score > 0 && (
        <div style={{ fontSize: 12, color: "var(--pgo-warning,#b45309)", marginBottom: 14 }}>
          {score_health.without_score} active PG{score_health.without_score === 1 ? "" : "s"} have
          no score row yet.
        </div>
      )}

      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Missing-field heatmap</div>
      {quality.missing_field_heatmap.length === 0 ? (
        <EmptyState title="No missing-field data in range" />
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6
          }}
        >
          {quality.missing_field_heatmap.map((m) => (
            <li
              key={m.field}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
              data-testid={`missing-${m.field}`}
            >
              <span style={{ width: 130, fontSize: 12 }}>{m.field}</span>
              <div
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: "var(--ad-surface-2,#eef1f5)"
                }}
              >
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    width: `${(m.count / maxMissing) * 100}%`,
                    background: "var(--pgo-danger,#ef4444)"
                  }}
                />
              </div>
              <span
                style={{ width: 32, textAlign: "right", fontSize: 12, color: "var(--ad-text-3)" }}
              >
                {m.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
