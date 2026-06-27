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
              <span className={styles.legendDot} style={{ background: "#3a8bff" }} />
              Views
            </span>
            <span className={styles.legendPill}>
              <span className={styles.legendDot} style={{ background: "#ff8e92" }} />
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
                <stop offset="0%" stopColor="#3a8bff" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#3a8bff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,.06)" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10, fill: "rgba(255,255,255,.35)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis hide />
            <Tooltip
              contentStyle={{
                background: "#0a1020",
                border: "1px solid rgba(255,255,255,.1)",
                borderRadius: 10,
                color: "#fff"
              }}
              labelStyle={{ color: "rgba(255,255,255,.6)" }}
              cursor={{ stroke: "rgba(255,255,255,.15)" }}
            />
            <Area
              type="monotone"
              dataKey="views"
              stroke="#3a8bff"
              strokeWidth={2.5}
              fill="url(#pgoViews)"
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="leads"
              stroke="#ff8e92"
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
