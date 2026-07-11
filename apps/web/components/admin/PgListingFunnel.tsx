"use client";

import { SectionCard } from "./primitives/SectionCard";
import { StatCard } from "./primitives/StatCard";
import type { PgListingAnalytics } from "../../lib/admin-api";

interface Props {
  data: PgListingAnalytics;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function fmtDuration(sec: number | null): string {
  if (sec == null) return "-";
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

/**
 * Listing-process funnel: started → steps → submitted → published, with
 * drop-off, conversion, time-to-publish, and the manual/voice split.
 */
export function PgListingFunnel({ data }: Props) {
  const { funnel } = data;
  const stageOrder: Array<{ label: string; value: number }> = [
    { label: "Started", value: funnel.wizard_started },
    { label: "Submitted", value: funnel.submitted },
    { label: "Published", value: funnel.published }
  ];
  const max = Math.max(1, funnel.wizard_started);

  return (
    <SectionCard title="Listing funnel" subtitle={`Last ${data.range_days} days`}>
      <div className="admin-stat-grid" style={{ marginBottom: 14 }}>
        <StatCard label="Start → Submit" value={pct(data.conversion)} tone="brand" />
        <StatCard label="Start → Publish" value={pct(data.publish_conversion)} tone="trust" />
        <StatCard
          label="Median time to publish"
          value={fmtDuration(data.median_time_to_publish_sec)}
        />
        <StatCard label="Abandoned" value={funnel.abandoned} tone="warn" />
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8
        }}
      >
        {stageOrder.map((s, i) => {
          const prev = i === 0 ? s.value : stageOrder[i - 1].value;
          const drop = prev > 0 ? 1 - s.value / prev : 0;
          return (
            <li key={s.label} data-testid={`stage-${s.label.toLowerCase()}`}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 13,
                  marginBottom: 3
                }}
              >
                <span>{s.label}</span>
                <span style={{ color: "var(--ad-text-3)" }}>
                  {s.value}
                  {i > 0 && drop > 0 ? ` · −${pct(drop)} drop-off` : ""}
                </span>
              </div>
              <div
                style={{ height: 8, borderRadius: 4, background: "var(--ad-surface-2, #eef1f5)" }}
              >
                <div
                  style={{
                    height: 8,
                    borderRadius: 4,
                    width: `${Math.max(2, (s.value / max) * 100)}%`,
                    background: "var(--ad-brand, #0066FF)"
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div style={{ marginTop: 14, fontSize: 12, color: "var(--ad-text-3)" }}>
        Source split: manual <strong>{data.by_source.manual}</strong> · voice{" "}
        <strong>{data.by_source.voice}</strong>
      </div>
    </SectionCard>
  );
}
