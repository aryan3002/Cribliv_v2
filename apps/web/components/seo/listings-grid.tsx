import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";
import { ListingCardItem } from "../listing-card";
import type { ListingCard } from "../../lib/seo-api";

/**
 * Server-rendered grid of listing cards for SEO pages. Reuses the canonical
 * ListingCardItem so listings look identical across hub pages, search
 * results, and city pages.
 */
export function ListingsGrid({
  title,
  items,
  emptyMessage,
  viewAllHref,
  locale
}: {
  title: string;
  items: ListingCard[];
  emptyMessage: string;
  viewAllHref?: string;
  locale: "en" | "hi";
}) {
  if (items.length === 0) {
    return (
      <section style={{ marginBottom: "var(--space-10)" }}>
        <h3 style={{ marginBottom: "var(--space-3)" }}>{title}</h3>
        <p className="body-sm text-secondary">{emptyMessage}</p>
      </section>
    );
  }
  return (
    <section style={{ marginBottom: "var(--space-10)" }} aria-label={title}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--space-4)"
        }}
      >
        <h3 style={{ margin: 0 }}>{title}</h3>
        {viewAllHref && (
          <Link
            href={viewAllHref as Route}
            className="body-sm text-brand"
            style={{
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4
            }}
          >
            {locale === "hi" ? "सभी देखें" : "View all"} <ArrowRight size={14} />
          </Link>
        )}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "var(--space-6)"
        }}
      >
        {items.map((item) => (
          <ListingCardItem
            key={item.id}
            locale={locale}
            listing={{
              id: item.id,
              title: item.title,
              city: item.city,
              city_name: item.city_name ?? item.city,
              locality: item.locality ?? null,
              listing_type: item.listing_type,
              monthly_rent: item.monthly_rent,
              bhk: item.bhk ?? null,
              furnishing: item.furnishing ?? null,
              area_sqft: item.area_sqft ?? null,
              verification_status: item.verification_status,
              cover_photo: item.cover_photo ?? null
            }}
          />
        ))}
      </div>
    </section>
  );
}
