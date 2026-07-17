import type { PageAggregates } from "../../lib/seo-api";

/**
 * Metric tiles for the current place — listing mix + median rents + the
 * zero-brokerage trust signal. Renders even when counts are zero (em-dash) so
 * the layout stays stable and crawlers see a consistent structure.
 */
export function StatsCard({
  aggregates,
  locale
}: {
  aggregates: PageAggregates;
  locale: "en" | "hi";
}) {
  const fmt = (n: number | null) => (n == null || n === 0 ? "—" : `₹${n.toLocaleString("en-IN")}`);

  const tiles: Array<{ label: string; value: string }> = [
    {
      label: locale === "hi" ? "लिस्टिंग" : "Listings",
      value: aggregates.listing_count.toString()
    },
    { label: locale === "hi" ? "PG" : "PGs", value: aggregates.pg_count.toString() },
    { label: locale === "hi" ? "फ्लैट" : "Flats", value: aggregates.flat_count.toString() },
    {
      label: locale === "hi" ? "1BHK औसत" : "1BHK median",
      value: fmt(aggregates.median_rent_1bhk)
    },
    {
      label: locale === "hi" ? "2BHK औसत" : "2BHK median",
      value: fmt(aggregates.median_rent_2bhk)
    },
    { label: locale === "hi" ? "ब्रोकरेज" : "Brokerage", value: "₹0" }
  ];

  return (
    <div className="seo-stats" role="list">
      {tiles.map((t) => (
        <div key={t.label} className="seo-stat" role="listitem">
          <div className="seo-stat__value">{t.value}</div>
          <div className="seo-stat__label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}
