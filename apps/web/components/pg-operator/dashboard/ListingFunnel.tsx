"use client";
import type { PgDashboardListingHealth } from "@cribliv/shared-types";
import { ResponsiveContainer, LineChart, Line } from "recharts";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function ListingFunnel({ data }: { data: PgDashboardListingHealth }) {
  // Distinguish "no data" (denominator 0) from a true 0% rate.
  const ctrLabel = data.search_appearances_7d > 0 ? pct(data.ctr_7d) : "—";
  const interestLabel = data.views_7d > 0 ? pct(data.interest_rate_7d) : "—";

  const cells: Array<{ label: string; value: string }> = [
    { label: "Appearances", value: data.search_appearances_7d.toLocaleString() },
    { label: "CTR", value: ctrLabel },
    { label: "Views", value: data.views_7d.toLocaleString() },
    { label: "Interest", value: interestLabel },
    { label: "Leads", value: data.contact_unlocks_7d.toLocaleString() }
  ];

  return (
    <div className="pgo-funnel">
      <div className="pgo-funnel__row">
        {cells.map((c) => (
          <div key={c.label} className="pgo-funnel__cell">
            <div className="pgo-funnel__cell-value">{c.value}</div>
            <div className="pgo-funnel__cell-label">{c.label}</div>
          </div>
        ))}
      </div>
      <div className="pgo-funnel__spark" style={{ height: 48 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.trend_7d}>
            <Line
              type="monotone"
              dataKey="appearances"
              stroke="var(--brand, #0066FF)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="views"
              stroke="#8aa"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="leads"
              stroke="#0a0"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
