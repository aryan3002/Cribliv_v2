import Link from "next/link";
import type { Route } from "next";
import { ArrowRight } from "lucide-react";

/**
 * Generic "card grid of related places" used by locality / metro / landmark
 * pages for cross-linking. Keep it dumb — caller decides what counts as
 * related.
 */
export function RelatedLinks({
  title,
  items,
  locale,
  emptyHint
}: {
  title: string;
  items: Array<{ href: string; label: string; sublabel?: string | null }>;
  locale: "en" | "hi";
  emptyHint?: string;
}) {
  if (items.length === 0) {
    if (!emptyHint) return null;
    return (
      <section style={{ marginBottom: "var(--space-8)" }}>
        <h3 style={{ marginBottom: "var(--space-3)" }}>{title}</h3>
        <p className="body-sm text-secondary">{emptyHint}</p>
      </section>
    );
  }
  return (
    <section style={{ marginBottom: "var(--space-8)" }} aria-label={title}>
      <h3 style={{ marginBottom: "var(--space-3)" }}>{title}</h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "var(--space-3)"
        }}
      >
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href as Route}
            className="card"
            style={{
              textDecoration: "none",
              padding: "var(--space-4)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-1)"
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 14 }}>{item.label}</span>
            {item.sublabel && (
              <span className="body-sm text-secondary" style={{ fontSize: 12 }}>
                {item.sublabel}
              </span>
            )}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: 12,
                color: "var(--brand)",
                marginTop: 4
              }}
            >
              {locale === "hi" ? "देखें" : "View"} <ArrowRight size={12} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
