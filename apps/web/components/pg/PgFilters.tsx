"use client";

import { useRouter } from "next/navigation";
import { buildSearchQuery } from "../../lib/api";
import { track } from "../../lib/track";

const GENDERS = [
  { value: "boys", label: "Boys" },
  { value: "girls", label: "Girls" },
  { value: "coed", label: "Co-ed" }
];
const SHARING = [
  { value: "single", label: "Single" },
  { value: "double", label: "Double" },
  { value: "triple", label: "Triple" },
  { value: "quad", label: "Quad" }
];
const TENANT = [
  { value: "students", label: "Students" },
  { value: "working", label: "Working" },
  { value: "any", label: "Any" }
];
const SORTS = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "rent", label: "Rent: Low → High" }
];

export function PgFilters({
  locale,
  filters
}: {
  locale: string;
  filters: Record<string, string>;
}) {
  const router = useRouter();

  function navigate(next: Record<string, string>) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(next)) if (v) clean[k] = v;
    delete clean.page;
    const qs = buildSearchQuery(clean);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.push(`/${locale}/pg${qs ? `?${qs}` : ""}` as any);
  }

  function toggle(key: string, value: string) {
    const clearing = filters[key] === value;
    navigate({ ...filters, [key]: clearing ? "" : value });
    if (clearing) track("pg_filter_cleared", { filter_key: key });
    else track("pg_filter_applied", { filter_key: key, value });
  }

  function setBoolean(key: string) {
    const clearing = filters[key] === "true";
    navigate({ ...filters, [key]: clearing ? "" : "true" });
    if (clearing) track("pg_filter_cleared", { filter_key: key });
    else track("pg_filter_applied", { filter_key: key, value: "true" });
  }

  return (
    <div className="pg-filters" role="group" aria-label="PG filters">
      <FilterRow label="Gender">
        {GENDERS.map((g) => (
          <Chip
            key={g.value}
            active={filters.gender_policy === g.value}
            onClick={() => toggle("gender_policy", g.value)}
          >
            {g.label}
          </Chip>
        ))}
      </FilterRow>

      <FilterRow label="Sharing">
        {SHARING.map((s) => (
          <Chip
            key={s.value}
            active={filters.sharing === s.value}
            onClick={() => toggle("sharing", s.value)}
          >
            {s.label}
          </Chip>
        ))}
      </FilterRow>

      <FilterRow label="Tenant">
        {TENANT.map((t) => (
          <Chip
            key={t.value}
            active={filters.tenant_type === t.value}
            onClick={() => toggle("tenant_type", t.value)}
          >
            {t.label}
          </Chip>
        ))}
      </FilterRow>

      <FilterRow label="More">
        <Chip active={filters.ac === "true"} onClick={() => setBoolean("ac")}>
          AC
        </Chip>
        <Chip active={filters.food_included === "true"} onClick={() => setBoolean("food_included")}>
          Food included
        </Chip>
      </FilterRow>

      <FilterRow label="Sort">
        <select
          className="pg-filters__sort"
          value={filters.sort ?? "relevance"}
          onChange={(e) => {
            navigate({ ...filters, sort: e.target.value });
            track("pg_sort_changed", { sort_key: e.target.value });
          }}
          aria-label="Sort PGs"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </FilterRow>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="pg-filters__row">
      <span className="pg-filters__label">{label}</span>
      <div className="pg-filters__chips">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`pg-chip${active ? " pg-chip--active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
