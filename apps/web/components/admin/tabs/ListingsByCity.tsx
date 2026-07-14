"use client";

import { useMemo, useState } from "react";
import type { AdminCityCount } from "../../../lib/admin-api";
import { EmptyState } from "../primitives/EmptyState";

/* ── Pure aggregation (exported for testing) ──────────────────────────────
 * The /admin/analytics/listings endpoint returns one row per (city, locality).
 * Roll that up into city totals + a per-city locality breakdown, each sorted
 * by count desc, so the panel can show cities first and drill into localities.
 */
export interface CityTotal {
  city: string;
  count: number;
}
export interface LocalityCount {
  name: string;
  count: number;
}

export function aggregateByCity(rows: AdminCityCount[]): {
  cities: CityTotal[];
  localitiesByCity: Record<string, LocalityCount[]>;
} {
  const totals = new Map<string, number>();
  const byCity: Record<string, LocalityCount[]> = {};

  for (const r of rows) {
    totals.set(r.city, (totals.get(r.city) ?? 0) + r.count);
    if (r.locality) {
      (byCity[r.city] ??= []).push({ name: r.locality, count: r.count });
    }
  }
  for (const city of Object.keys(byCity)) {
    byCity[city].sort((a, b) => b.count - a.count);
  }

  const cities = [...totals.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);

  return { cities, localitiesByCity: byCity };
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ── One horizontal bar row (city or locality) ──────────────────────────── */
interface BarRowProps {
  label: string;
  count: number;
  max: number;
  tone: "city" | "locality";
  active?: boolean;
  onClick?: () => void;
}

function BarRow({ label, count, max, tone, active, onClick }: BarRowProps) {
  const pct = max > 0 ? Math.max(3, Math.round((count / max) * 100)) : 0;
  const clickable = onClick != null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={clickable ? !!active : undefined}
      disabled={!clickable}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(88px, 34%) 1fr auto",
        alignItems: "center",
        gap: 10,
        width: "100%",
        border: "none",
        background: active ? "var(--ad-brand-soft)" : "transparent",
        borderRadius: "var(--ad-radius-sm)",
        padding: "7px 8px",
        cursor: clickable ? "pointer" : "default",
        textAlign: "left",
        font: "inherit"
      }}
    >
      <span
        title={label}
        style={{
          fontSize: 12,
          color: active ? "var(--ad-brand)" : "var(--ad-text-2)",
          fontWeight: tone === "city" ? 600 : 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis"
        }}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        style={{
          height: 10,
          background: "var(--ad-surface-2)",
          borderRadius: 999,
          overflow: "hidden"
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            width: `${pct}%`,
            background: tone === "city" ? "var(--ad-brand)" : "#7AA7FF",
            borderRadius: 999
          }}
        />
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ad-text)",
          minWidth: 22,
          textAlign: "right",
          fontVariantNumeric: "tabular-nums"
        }}
      >
        {count}
      </span>
    </button>
  );
}

const HEADING: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--ad-text-3)",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginBottom: 8
};

/* ── The panel: cities (master) + localities of the selected city (detail) ── */
export function ListingsByCity({ rows }: { rows: AdminCityCount[] }) {
  const { cities, localitiesByCity } = useMemo(() => aggregateByCity(rows), [rows]);
  const [selected, setSelected] = useState<string | null>(null);

  if (rows.length === 0) {
    return <EmptyState title="No city data yet" />;
  }

  // Default to the biggest city so the detail pane is never empty on first paint.
  const activeCity =
    selected && cities.some((c) => c.city === selected) ? selected : cities[0].city;
  const localities = localitiesByCity[activeCity] ?? [];
  const cityMax = cities[0]?.count ?? 0;
  const locMax = localities[0]?.count ?? 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 24
      }}
    >
      <div>
        <div style={HEADING}>By city</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {cities.map((c) => (
            <BarRow
              key={c.city}
              label={titleCase(c.city)}
              count={c.count}
              max={cityMax}
              tone="city"
              active={c.city === activeCity}
              onClick={() => setSelected(c.city)}
            />
          ))}
        </div>
      </div>

      <div>
        <div style={HEADING}>{titleCase(activeCity)} · localities</div>
        {localities.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {localities.slice(0, 12).map((l) => (
              <BarRow key={l.name} label={l.name} count={l.count} max={locMax} tone="locality" />
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--ad-text-3)", padding: "7px 8px" }}>
            No locality breakdown for this city.
          </div>
        )}
      </div>
    </div>
  );
}
