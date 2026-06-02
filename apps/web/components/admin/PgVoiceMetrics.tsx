"use client";

import { SectionCard } from "./primitives/SectionCard";
import { StatCard } from "./primitives/StatCard";
import type { PgListingAnalytics } from "../../lib/admin-api";

interface Props {
  data: PgListingAnalytics;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Voice-listing health: sessions, completion %, fallback %. */
export function PgVoiceMetrics({ data }: Props) {
  const { voice } = data;
  return (
    <SectionCard title="Voice listing" subtitle={`Last ${data.range_days} days`}>
      <div className="admin-stat-grid">
        <StatCard label="Sessions" value={voice.sessions} tone="brand" />
        <StatCard label="Completion rate" value={pct(voice.completion_rate)} tone="trust" />
        <StatCard label="Fallback rate" value={pct(voice.fallback_rate)} tone="warn" />
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--ad-text-3)" }}>
        Voice starts <strong>{data.by_source.voice}</strong> · completion = sessions with{" "}
        <code>ended_at</code>; fallback derived from voice start→submit.
      </div>
    </SectionCard>
  );
}
