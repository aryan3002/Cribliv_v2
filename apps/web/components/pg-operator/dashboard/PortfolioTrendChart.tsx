"use client";
import { useState } from "react";
import type { TrendPoint } from "@cribliv/shared-types";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from "recharts";
import styles from "@/app/[locale]/pg-operator/dashboard/pg-dashboard.module.css";

type Range = 7 | 30;

export function PortfolioTrendChart({ trend }: { trend: TrendPoint[] }) {
  const [range, setRange] = useState<Range>(30);
  const visible = trend.slice(-range);

  return (
    <div className={styles.trendPanel}>
      <div className={styles.trendHead}>
        <div>
          <h3 className={styles.trendTitle}>Funnel trend</h3>
          <div className={styles.trendLegend}>
            <span className={styles.legendPill}>
              <span className={styles.legendDot} style={{ background: "var(--d-brand)" }} />
              Views
            </span>
            <span className={styles.legendPill}>
              <span className={styles.legendDot} style={{ background: "var(--d-warning)" }} />
              Leads
            </span>
          </div>
        </div>
        <div className={styles.rangeToggle} role="group" aria-label="Trend range">
          {([7, 30] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              className={`${styles.rangeBtn} ${range === r ? styles.rangeBtnActive : ""}`}
              aria-pressed={range === r}
              onClick={() => setRange(r)}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>
      <span data-testid="trend-point-count" style={{ display: "none" }}>
        {visible.length}
      </span>
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="pgoViews" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--d-brand)" stopOpacity={0.18} />
                <stop offset="100%" stopColor="var(--d-brand)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--d-border)" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: "var(--d-text-soft)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "var(--d-surface)",
                border: "1px solid var(--d-border)",
                borderRadius: 10,
                color: "var(--d-text)"
              }}
              labelStyle={{ color: "var(--d-text-soft)" }}
              cursor={{ stroke: "var(--d-border-strong)" }}
            />
            <Area
              type="monotone"
              dataKey="views"
              stroke="var(--d-brand)"
              strokeWidth={2.5}
              fill="url(#pgoViews)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="leads"
              stroke="var(--d-warning)"
              strokeWidth={2}
              fill="transparent"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
