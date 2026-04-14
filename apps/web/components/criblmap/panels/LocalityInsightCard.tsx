"use client";

import { useEffect, useState } from "react";
import {
  MapPin,
  TrendingUp,
  TrendingDown,
  Minus,
  ShieldCheck,
  Activity,
  Clock,
  Home,
  Bell,
  Sparkles
} from "lucide-react";
import { useMapState, useMapDispatch } from "../hooks/useMapState";
import { fetchApi, buildSearchQuery } from "../../../lib/api";

interface LocalityInsight {
  locality_name: string;
  summary: string | null;
  stats: {
    active_listings: number;
    avg_rent_2bhk: number | null;
    demand_score: number;
    median_days_active: number | null;
    verified_pct: number;
  };
  trend: "up" | "down" | "stable";
}

function formatRent(rent: number): string {
  return rent.toLocaleString("en-IN");
}

interface LocalityInsightCardProps {
  locale: string;
}

export function LocalityInsightCard({ locale }: LocalityInsightCardProps) {
  const { panelContent } = useMapState();
  const dispatch = useMapDispatch();
  const [insight, setInsight] = useState<LocalityInsight | null>(null);
  const [loading, setLoading] = useState(true);

  const lat = panelContent.type === "locality-insight" ? panelContent.lat : null;
  const lng = panelContent.type === "locality-insight" ? panelContent.lng : null;

  useEffect(() => {
    if (lat == null || lng == null) return;

    let cancelled = false;
    setLoading(true);

    const params = buildSearchQuery({
      lat,
      lng,
      city: "delhi",
      locale
    });

    fetchApi<LocalityInsight>(`/map/locality-insight?${params}`)
      .then((data) => {
        if (!cancelled) setInsight(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [lat, lng, locale]);

  if (loading) {
    return (
      <div className="cmap-locality">
        <div className="cmap-locality__loading">
          <Sparkles size={24} className="cmap-spin" />
          <p>Analyzing locality...</p>
        </div>
      </div>
    );
  }

  if (!insight) {
    return (
      <div className="cmap-locality">
        <div className="cmap-locality__empty">No data available for this area.</div>
      </div>
    );
  }

  const TrendIcon =
    insight.trend === "up" ? TrendingUp : insight.trend === "down" ? TrendingDown : Minus;
  const trendColor =
    insight.trend === "up"
      ? "var(--cmap-pin-verified)"
      : insight.trend === "down"
        ? "var(--amber, #f59e0b)"
        : "var(--cmap-text-muted)";

  return (
    <div className="cmap-locality">
      <div className="cmap-locality__header">
        <MapPin size={16} />
        <h3 className="cmap-locality__name">{insight.locality_name}</h3>
      </div>

      {insight.summary && (
        <div className="cmap-locality__summary">
          <Sparkles size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
          <p>{insight.summary}</p>
        </div>
      )}

      <div className="cmap-locality__grid">
        <div className="cmap-locality__stat">
          <Home size={16} />
          <div>
            <span className="cmap-locality__stat-value">{insight.stats.active_listings}</span>
            <span className="cmap-locality__stat-label">Active Listings</span>
          </div>
        </div>

        {insight.stats.avg_rent_2bhk && (
          <div className="cmap-locality__stat">
            <span className="cmap-locality__stat-icon">₹</span>
            <div>
              <span className="cmap-locality__stat-value">
                {formatRent(insight.stats.avg_rent_2bhk)}
              </span>
              <span className="cmap-locality__stat-label">Avg 2BHK Rent</span>
            </div>
          </div>
        )}

        <div className="cmap-locality__stat">
          <ShieldCheck size={16} />
          <div>
            <span className="cmap-locality__stat-value">{insight.stats.verified_pct}%</span>
            <span className="cmap-locality__stat-label">Verified</span>
          </div>
        </div>

        {insight.stats.median_days_active != null && (
          <div className="cmap-locality__stat">
            <Clock size={16} />
            <div>
              <span className="cmap-locality__stat-value">{insight.stats.median_days_active}d</span>
              <span className="cmap-locality__stat-label">Median Active</span>
            </div>
          </div>
        )}
      </div>

      <div className="cmap-locality__demand">
        <div className="cmap-locality__demand-header">
          <Activity size={14} />
          <span>Demand Score</span>
          <span className="cmap-locality__demand-value">{insight.stats.demand_score}/100</span>
        </div>
        <div className="cmap-locality__demand-bar">
          <div
            className="cmap-locality__demand-fill"
            style={{ width: `${insight.stats.demand_score}%` }}
          />
        </div>
      </div>

      <div className="cmap-locality__trend" style={{ color: trendColor }}>
        <TrendIcon size={14} />
        <span>
          {insight.trend === "up"
            ? "Supply increasing"
            : insight.trend === "down"
              ? "Supply decreasing"
              : "Supply stable"}{" "}
          (3-month)
        </span>
      </div>

      <div className="cmap-area-stats__actions">
        <button
          className="cmap-listing__cta cmap-listing__cta--secondary"
          onClick={() => {
            if (lat && lng) {
              dispatch({
                type: "SET_FILTERS",
                filters: {}
              });
            }
          }}
        >
          <Home size={14} /> See All Listings
        </button>
        <button
          className="cmap-listing__cta cmap-listing__cta--primary"
          onClick={() => dispatch({ type: "SET_PANEL", panelContent: { type: "alert-zone-form" } })}
        >
          <Bell size={14} /> Set Alert
        </button>
      </div>
    </div>
  );
}
