"use client";

import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { SparklineChart } from "../charts/SparklineChart";

export type StatTone = "default" | "brand" | "trust" | "warn" | "danger";

interface Props {
  label: string;
  value: ReactNode;
  delta?: { value: number; suffix?: string } | null;
  spark?: number[];
  tone?: StatTone;
}

export function StatCard({ label, value, delta, spark, tone = "default" }: Props) {
  return (
    <div
      className={`admin-stat${tone !== "default" ? " admin-stat--accent" : ""}`}
      data-tone={tone === "default" ? undefined : tone}
    >
      <div className="admin-stat__label">{label}</div>
      <div className="admin-stat__value">{value}</div>
      <div className="admin-stat__row">
        {delta != null ? (
          <span
            className={`admin-stat__delta admin-stat__delta--${
              delta.value > 0 ? "up" : delta.value < 0 ? "down" : "neutral"
            }`}
          >
            {delta.value > 0 ? (
              <ArrowUp size={11} aria-hidden="true" />
            ) : delta.value < 0 ? (
              <ArrowDown size={11} aria-hidden="true" />
            ) : (
              <ArrowRight size={11} aria-hidden="true" />
            )}
            {Math.abs(delta.value)}
            {delta.suffix ?? "%"}
          </span>
        ) : (
          <span className="admin-stat__delta admin-stat__delta--neutral">&nbsp;</span>
        )}
        {spark && spark.length > 0 && (
          <div className="admin-stat__spark">
            <SparklineChart values={spark} tone={tone} />
          </div>
        )}
      </div>
    </div>
  );
}
