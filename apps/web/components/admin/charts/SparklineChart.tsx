"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

interface Props {
  values: number[];
  tone?: "default" | "brand" | "trust" | "warn" | "danger";
}

const TONE_COLOR: Record<string, string> = {
  default: "#0066FF",
  brand: "#0066FF",
  trust: "#0D9F4F",
  warn: "#E88C00",
  danger: "#DC2626"
};

export function SparklineChart({ values, tone = "default" }: Props) {
  if (!values || values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  const color = TONE_COLOR[tone] ?? TONE_COLOR.default;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={1.6}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
