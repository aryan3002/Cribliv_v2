import type { PgPortfolioSummary } from "@cribliv/shared-types";
import { AlertTriangle } from "lucide-react";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function FunnelConversion({ portfolio: p }: { portfolio: PgPortfolioSummary }) {
  const stages = [
    { label: "Appearances", value: p.appearances },
    { label: "Clicks", value: p.clicks },
    { label: "Views", value: p.views },
    { label: "Leads", value: p.leads }
  ];
  const max = Math.max(p.appearances, 1);

  // Stage-to-stage retention; only transitions with a non-zero source count.
  const transitions = stages.slice(0, -1).map((s, i) => {
    const next = stages[i + 1];
    const ratio = s.value > 0 ? next.value / s.value : null;
    return { label: `${s.label} → ${next.label}`, ratio };
  });
  const valid = transitions.filter((t) => t.ratio !== null) as Array<{
    label: string;
    ratio: number;
  }>;
  const leak = valid.length ? valid.reduce((m, t) => (t.ratio < m.ratio ? t : m)) : null;

  return (
    <div className="pgo-conv">
      <div className="pgo-conv__bars">
        {stages.map((s) => (
          <div key={s.label} className="pgo-conv__stage">
            <div
              className="pgo-conv__bar"
              style={{ width: `${Math.max((s.value / max) * 100, 4)}%` }}
            />
            <div className="pgo-conv__meta">
              <span className="pgo-conv__value">{s.value.toLocaleString()}</span>
              <span className="pgo-conv__label">{s.label}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="pgo-conv__transitions">
        {transitions.map((t) => (
          <span key={t.label} className="pgo-conv__chip">
            {t.label}: {t.ratio === null ? "—" : pct(t.ratio)}
          </span>
        ))}
      </div>
      {leak && (
        <div className="pgo-conv__leak">
          <AlertTriangle size={13} /> Biggest drop-off: <strong>{leak.label}</strong> (
          {pct(leak.ratio)} continue)
        </div>
      )}
    </div>
  );
}
