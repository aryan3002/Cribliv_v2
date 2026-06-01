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

type Range = 7 | 30;

export function PortfolioTrendChart({ trend }: { trend: TrendPoint[] }) {
  const [range, setRange] = useState<Range>(30);
  const visible = trend.slice(-range);

  return (
    <div className="pgo-trend">
      <div className="pgo-trend__head">
        <h3 className="pgo-trend__title">Funnel trend</h3>
        <div className="pgo-trend__toggle" role="group" aria-label="Trend range">
          {[7, 30].map((r) => (
            <button
              key={r}
              type="button"
              className={`pgo-trend__range${range === r ? " pgo-trend__range--active" : ""}`}
              aria-pressed={range === r}
              onClick={() => setRange(r as Range)}
            >
              {r}d
            </button>
          ))}
        </div>
      </div>
      <span data-testid="trend-point-count" style={{ display: "none" }}>
        {visible.length}
      </span>
      <div className="pgo-trend__chart" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={visible} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="pgoAppr" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--brand, #0066FF)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--brand, #0066FF)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,.06)" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 10 }}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={24}
            />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} width={32} />
            <Tooltip />
            <Area
              type="monotone"
              dataKey="appearances"
              stroke="var(--brand, #0066FF)"
              fill="url(#pgoAppr)"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="views"
              stroke="#14b8a6"
              fill="transparent"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="leads"
              stroke="#22c55e"
              fill="transparent"
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
