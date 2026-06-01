import type { PgSearchInsights } from "@cribliv/shared-types";
import { Search, SlidersHorizontal, SearchX } from "lucide-react";

function Panel({
  icon: Icon,
  title,
  empty,
  children
}: {
  icon: typeof Search;
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="pgo-insights__panel">
      <div className="pgo-insights__head">
        <Icon size={14} /> <span>{title}</span>
      </div>
      {hasChildren ? (
        <ul className="pgo-insights__list">{children}</ul>
      ) : (
        <p className="pgo-insights__empty">{empty}</p>
      )}
    </div>
  );
}

export function SearchInsights({ insights }: { insights: PgSearchInsights }) {
  return (
    <div className="pgo-insights">
      <Panel icon={Search} title="Top searches" empty="No searches yet">
        {insights.top_queries.map((q) => (
          <li key={q.query} className="pgo-insights__row">
            <span className="pgo-insights__term">{q.query}</span>
            <span className="pgo-insights__count">{q.count}</span>
          </li>
        ))}
      </Panel>

      <Panel icon={SlidersHorizontal} title="Popular filters" empty="No filters yet">
        {insights.top_filters.map((f) => (
          <li key={`${f.key}:${f.value}`} className="pgo-insights__row">
            <span className="pgo-insights__term">
              {f.key}: {f.value}
            </span>
            <span className="pgo-insights__count">{f.count}</span>
          </li>
        ))}
      </Panel>

      <Panel icon={SearchX} title="Unmet demand" empty="No unmet demand yet">
        {insights.zero_result_queries.map((q) => (
          <li key={q.query} className="pgo-insights__row">
            <span className="pgo-insights__term">{q.query}</span>
            <span className="pgo-insights__count pgo-insights__count--warn">{q.count}</span>
          </li>
        ))}
      </Panel>
    </div>
  );
}
