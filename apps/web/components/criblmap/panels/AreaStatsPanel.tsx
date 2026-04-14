"use client";

import { TrendingUp, TrendingDown, Minus, ShieldCheck, Bell, X, BarChart3 } from "lucide-react";
import { useMapState, useMapDispatch } from "../hooks/useMapState";
import { useAreaStats } from "../hooks/useAreaStats";

function formatRentINR(rent: number): string {
  return rent.toLocaleString("en-IN");
}

function TrendIcon({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up") return <TrendingUp size={14} className="cmap-trend--up" />;
  if (trend === "down") return <TrendingDown size={14} className="cmap-trend--down" />;
  return <Minus size={14} className="cmap-trend--stable" />;
}

function TrendLabel({ trend }: { trend: "up" | "down" | "stable" }) {
  const labels = { up: "Rents rising", down: "Rents falling", stable: "Rents stable" };
  return <span className={`cmap-trend-label cmap-trend-label--${trend}`}>{labels[trend]}</span>;
}

export function AreaStatsPanel() {
  const { areaStats, drawMode } = useMapState();
  const dispatch = useMapDispatch();

  useAreaStats();

  if (drawMode !== "complete") {
    return (
      <div className="cmap-area-stats">
        <div className="cmap-area-stats__empty">
          <BarChart3 size={32} style={{ opacity: 0.3 }} />
          <p>Tap two corners on the map to define your area</p>
        </div>
      </div>
    );
  }

  if (!areaStats) {
    return (
      <div className="cmap-area-stats">
        <div className="cmap-area-stats__loading">Calculating stats...</div>
      </div>
    );
  }

  return (
    <div className="cmap-area-stats">
      <div className="cmap-area-stats__header">
        <div className="cmap-area-stats__headline">
          <span className="cmap-area-stats__count">{areaStats.total_pins}</span>
          <span className="cmap-area-stats__count-label">listings in area</span>
        </div>
        <div className="cmap-area-stats__trend">
          <TrendIcon trend={areaStats.trend} />
          <TrendLabel trend={areaStats.trend} />
        </div>
      </div>

      <div className="cmap-area-stats__verified">
        <ShieldCheck size={14} />
        <span>
          <strong>{areaStats.verified_count}</strong> verified ({areaStats.verified_pct}%)
        </span>
      </div>

      {areaStats.by_bhk.length > 0 && (
        <div className="cmap-area-stats__table">
          <div className="cmap-area-stats__row cmap-area-stats__row--header">
            <span>BHK</span>
            <span>Count</span>
            <span>Avg Rent</span>
            <span>Range</span>
          </div>
          {areaStats.by_bhk.map((row) => (
            <div key={row.bhk} className="cmap-area-stats__row">
              <span className="cmap-area-stats__bhk">{row.bhk ?? "N/A"} BHK</span>
              <span>{row.count}</span>
              <span className="cmap-area-stats__rent">₹{formatRentINR(row.avg_rent)}</span>
              <span className="cmap-area-stats__range">
                ₹{formatRentINR(row.min_rent)} — ₹{formatRentINR(row.max_rent)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="cmap-area-stats__actions">
        <button
          className="cmap-listing__cta cmap-listing__cta--primary"
          onClick={() => dispatch({ type: "SET_PANEL", panelContent: { type: "alert-zone-form" } })}
        >
          <Bell size={14} /> Save as Alert Zone
        </button>
        <button
          className="cmap-listing__cta cmap-listing__cta--secondary"
          onClick={() => dispatch({ type: "CLEAR_DRAW" })}
        >
          <X size={14} /> Clear Selection
        </button>
      </div>
    </div>
  );
}
