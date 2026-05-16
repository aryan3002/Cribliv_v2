import Link from "next/link";
import type { Route } from "next";
import { intentsByCategory } from "../../lib/intent-filters";

/**
 * Grid of internal links to every intent for a given surface (locality /
 * metro / landmark). The heart of programmatic-SEO internal linking — gives
 * crawlers a clean, consistent anchor-text path into every intent page.
 */
export function IntentGrid({
  baseHref,
  surface,
  locale
}: {
  /** Base URL (no trailing slash). Intent slug is appended as /{intent}. */
  baseHref: string;
  surface: "locality" | "metro" | "landmark";
  locale: "en" | "hi";
}) {
  const groups = intentsByCategory(surface);
  return (
    <section
      aria-label={locale === "hi" ? "श्रेणी के अनुसार ब्राउज़ करें" : "Browse by category"}
      style={{ marginBottom: "var(--space-10)" }}
    >
      {groups.map((group) => (
        <div key={group.category.slug} style={{ marginBottom: "var(--space-6)" }}>
          <h3 style={{ marginBottom: "var(--space-3)" }}>
            {locale === "hi" ? group.category.label_hi : group.category.label_en}
          </h3>
          <div
            className="chip-row"
            style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-2)" }}
          >
            {group.intents.map((intent) => (
              <Link
                key={intent.slug}
                href={`${baseHref}/${intent.slug}` as Route}
                className="chip-btn"
                style={{ textDecoration: "none" }}
              >
                {locale === "hi" ? intent.label_hi : intent.label_en}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}
