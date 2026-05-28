"use client";

import {
  Area,
  AreaChart as RechartsArea,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

interface Props {
  data: Array<Record<string, string | number>>;
  xKey: string;
  yKey: string;
  height?: number;
  color?: string;
  tooltipFormatter?: (value: number) => string;
  xTickFormatter?: (value: string) => string;
}

export function AreaChart({
  data,
  xKey,
  yKey,
  height = 220,
  color = "#0066FF",
  tooltipFormatter,
  xTickFormatter
}: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsArea data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <defs>
          <linearGradient id={`fill-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#EEF1F5" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={xKey}
          tick={{ fontSize: 11, fill: "#6B7280" }}
          tickLine={false}
          axisLine={{ stroke: "#E6E8EB" }}
          tickFormatter={xTickFormatter}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "#6B7280" }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          cursor={{ stroke: color, strokeWidth: 1, strokeDasharray: "3 3" }}
          contentStyle={{
            background: "#fff",
            border: "1px solid #E6E8EB",
            borderRadius: 8,
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(15, 23, 42, 0.06)"
          }}
          formatter={(v: unknown) => (tooltipFormatter ? tooltipFormatter(Number(v)) : String(v))}
        />
        <Area
          type="monotone"
          dataKey={yKey}
          stroke={color}
          strokeWidth={2}
          fill={`url(#fill-${color.slice(1)})`}
          isAnimationActive={false}
        />
      </RechartsArea>
    </ResponsiveContainer>
  );
}
