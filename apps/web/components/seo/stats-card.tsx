import type { PageAggregates } from "../../lib/seo-api";

/**
 * Compact pill row showing live aggregates for the current place. Always
 * renders even when counts are zero — replaces missing data with em-dashes
 * so the layout stays stable and crawlers see consistent structure.
 */
export function StatsCard({
  aggregates,
  locale
}: {
  aggregates: PageAggregates;
  locale: "en" | "hi";
}) {
  const fmt = (n: number | null) => (n == null || n === 0 ? "—" : `₹${n.toLocaleString("en-IN")}`);
  const pills = [
    {
      label: locale === "hi" ? "लिस्टिंग" : "Listings",
      value: aggregates.listing_count.toString()
    },
    {
      label: locale === "hi" ? "PG" : "PG",
      value: aggregates.pg_count.toString()
    },
    {
      label: locale === "hi" ? "फ्लैट" : "Flats",
      value: aggregates.flat_count.toString()
    },
    {
      label: locale === "hi" ? "PG (मध्य)" : "PG median",
      value: fmt(aggregates.median_rent_pg)
    },
    {
      label: locale === "hi" ? "1BHK (मध्य)" : "1BHK median",
      value: fmt(aggregates.median_rent_1bhk)
    },
    {
      label: locale === "hi" ? "2BHK (मध्य)" : "2BHK median",
      value: fmt(aggregates.median_rent_2bhk)
    }
  ];

  return (
    <div
      className="card"
      style={{
        padding: "var(--space-4)",
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--space-4)",
        marginBottom: "var(--space-6)"
      }}
    >
      {pills.map((p) => (
        <div key={p.label} style={{ minWidth: 100 }}>
          <div
            className="body-sm text-secondary"
            style={{ fontSize: 11, letterSpacing: "0.05em", textTransform: "uppercase" }}
          >
            {p.label}
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, marginTop: 2 }}>{p.value}</div>
        </div>
      ))}
    </div>
  );
}
