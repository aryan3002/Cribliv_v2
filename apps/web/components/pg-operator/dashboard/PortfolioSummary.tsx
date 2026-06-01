import type { PgPortfolioSummary } from "@cribliv/shared-types";
import { ArrowUp, ArrowDown, Eye, Search, Heart, MousePointerClick, Target } from "lucide-react";

const pct = (v: number) => `${Math.round(v * 100)}%`;

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="pgo-kpi__delta pgo-kpi__delta--flat">—</span>;
  const up = value >= 0;
  return (
    <span className={`pgo-kpi__delta ${up ? "pgo-kpi__delta--up" : "pgo-kpi__delta--down"}`}>
      {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {`${up ? "+" : "-"}${Math.abs(Math.round(value * 100))}%`}
    </span>
  );
}

export function PortfolioSummary({ portfolio: p }: { portfolio: PgPortfolioSummary }) {
  const cells = [
    {
      key: "appearances",
      label: "Search appearances",
      icon: Search,
      value: p.appearances.toLocaleString(),
      delta: p.deltas.appearances
    },
    {
      key: "views",
      label: "Views",
      icon: Eye,
      value: p.views.toLocaleString(),
      delta: p.deltas.views
    },
    {
      key: "leads",
      label: "Leads",
      icon: Heart,
      value: p.leads.toLocaleString(),
      delta: p.deltas.leads
    },
    {
      key: "ctr",
      label: "Click-through",
      icon: MousePointerClick,
      value: pct(p.ctr),
      delta: undefined
    },
    {
      key: "conversion",
      label: "Conversion",
      icon: Target,
      value: pct(p.conversion),
      delta: undefined
    }
  ];
  return (
    <div className="pgo-kpi-strip">
      {cells.map((c) => {
        const Icon = c.icon;
        return (
          <div key={c.key} className="pgo-kpi">
            <div className="pgo-kpi__head">
              <Icon size={14} className="pgo-kpi__icon" />
              <span className="pgo-kpi__label">{c.label}</span>
            </div>
            <div className="pgo-kpi__value">{c.value}</div>
            {c.delta !== undefined && (
              <div className="pgo-kpi__delta-row">
                <Delta value={c.delta} />
                <span className="pgo-kpi__delta-note">vs last week</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
