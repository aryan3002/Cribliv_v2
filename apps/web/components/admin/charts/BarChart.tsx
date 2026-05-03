"use client";

import {
  Bar,
  BarChart as RechartsBar,
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
  layout?: "horizontal" | "vertical";
  tooltipFormatter?: (value: number) => string;
}

export function BarChart({
  data,
  xKey,
  yKey,
  height = 240,
  color = "#0066FF",
  layout = "horizontal",
  tooltipFormatter
}: Props) {
  const isHorizontal = layout === "horizontal";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RechartsBar
        data={data}
        layout={isHorizontal ? "horizontal" : "vertical"}
        margin={{ top: 8, right: 16, bottom: 4, left: isHorizontal ? 0 : 60 }}
      >
        <CartesianGrid
          stroke="#EEF1F5"
          strokeDasharray="3 3"
          horizontal={isHorizontal}
          vertical={!isHorizontal}
        />
        {isHorizontal ? (
          <>
            <XAxis
              dataKey={xKey}
              tick={{ fontSize: 11, fill: "#6B7280" }}
              tickLine={false}
              axisLine={{ stroke: "#E6E8EB" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#6B7280" }}
              tickLine={false}
              axisLine={false}
              width={40}
            />
          </>
        ) : (
          <>
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: "#6B7280" }}
              tickLine={false}
              axisLine={{ stroke: "#E6E8EB" }}
            />
            <YAxis
              type="category"
              dataKey={xKey}
              tick={{ fontSize: 11, fill: "#6B7280" }}
              tickLine={false}
              axisLine={false}
              width={100}
            />
          </>
        )}
        <Tooltip
          cursor={{ fill: "rgba(0,102,255,0.06)" }}
          contentStyle={{
            background: "#fff",
            border: "1px solid #E6E8EB",
            borderRadius: 8,
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(15, 23, 42, 0.06)"
          }}
          formatter={(v: unknown) => (tooltipFormatter ? tooltipFormatter(Number(v)) : String(v))}
        />
        <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </RechartsBar>
    </ResponsiveContainer>
  );
}
