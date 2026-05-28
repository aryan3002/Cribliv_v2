"use client";

import { Scale } from "lucide-react";
import { useMapState } from "./hooks/useMapState";

interface BottomBarProps {
  onBenchmarkClick?: () => void;
}

function formatBudget(rent: number): string {
  if (rent >= 100000) return `${(rent / 100000).toFixed(1)}L`;
  if (rent >= 1000) return `${Math.round(rent / 1000)}K`;
  return String(rent);
}

export function BottomBar({ onBenchmarkClick }: BottomBarProps) {
  const { pins, seekerPins, isLoading, demandViewActive } = useMapState();

  const totalCount = pins.length;
  const verifiedCount = pins.filter((p) => p.verification_status === "verified").length;
  const belowMarketCount = pins.filter((p) => p.belowMarket).length;
  const seekerCount = seekerPins.length;
  const avgSeekerBudget =
    seekerPins.length > 0
      ? Math.round(seekerPins.reduce((s, p) => s + p.budget_max, 0) / seekerPins.length)
      : 0;

  if (isLoading && totalCount === 0) {
    return (
      <div className="cmap-bottombar">
        <span className="cmap-bottombar__stat" style={{ opacity: 0.5 }}>
          Searching this area...
        </span>
      </div>
    );
  }

  if (totalCount === 0 && !demandViewActive) {
    return (
      <div className="cmap-bottombar">
        <span className="cmap-bottombar__stat">No listings in this area. Try zooming out.</span>
      </div>
    );
  }

  if (demandViewActive) {
    return (
      <div className="cmap-bottombar">
        <span className="cmap-bottombar__stat">
          <span className="cmap-bottombar__dot cmap-bottombar__dot--seeker" />
          <strong>{seekerCount}</strong> active seeker{seekerCount !== 1 ? "s" : ""} in view
        </span>
        {avgSeekerBudget > 0 && (
          <>
            <span className="cmap-bottombar__separator" />
            <span className="cmap-bottombar__stat">
              Avg budget <strong>₹{formatBudget(avgSeekerBudget)}</strong>
            </span>
          </>
        )}
        <span className="cmap-bottombar__separator" />
        <span className="cmap-bottombar__stat" style={{ opacity: 0.5 }}>
          {totalCount} listing{totalCount !== 1 ? "s" : ""} (faded)
        </span>
      </div>
    );
  }

  return (
    <div className="cmap-bottombar">
      <span className="cmap-bottombar__stat">
        <span className="cmap-bottombar__dot cmap-bottombar__dot--total" />
        <strong>{totalCount}</strong> listing{totalCount !== 1 ? "s" : ""} in view
      </span>
      <span className="cmap-bottombar__separator" />
      <span className="cmap-bottombar__stat">
        <span className="cmap-bottombar__dot cmap-bottombar__dot--verified" />
        <strong>{verifiedCount}</strong> verified
      </span>
      {belowMarketCount > 0 && (
        <>
          <span className="cmap-bottombar__separator" />
          <span className="cmap-bottombar__stat">
            <span className="cmap-bottombar__dot cmap-bottombar__dot--below" />
            <strong>{belowMarketCount}</strong> below market
          </span>
        </>
      )}
      {onBenchmarkClick && (
        <>
          <span className="cmap-bottombar__separator" />
          <button className="cmap-bottombar__link" onClick={onBenchmarkClick}>
            <Scale size={12} /> Is my rent fair?
          </button>
        </>
      )}
    </div>
  );
}
