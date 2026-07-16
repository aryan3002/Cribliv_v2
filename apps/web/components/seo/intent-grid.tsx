import Link from "next/link";
import type { Route } from "next";
import { intentsFor } from "../../lib/intent-filters";

/**
 * Compact "popular searches" row — a single tight band of internal links to
 * every intent for a surface (locality / metro / landmark). Every link stays in
 * the server-rendered HTML so crawlers still get the full anchor-text path into
 * each intent page; it's just visually condensed and lives below the listings
 * rather than dominating the top of the page.
 */
export function IntentGrid({
  baseHref,
  surface,
  locale,
  placeName
}: {
  /** Base URL (no trailing slash). Intent slug is appended as /{intent}. */
  baseHref: string;
  surface: "locality" | "metro" | "landmark";
  locale: "en" | "hi";
  /** Optional place name for the heading. */
  placeName?: string | null;
}) {
  const intents = intentsFor(surface);
  if (intents.length === 0) return null;

  const heading =
    locale === "hi"
      ? placeName
        ? `${placeName} में लोकप्रिय खोज`
        : "लोकप्रिय खोज"
      : placeName
        ? `Popular searches in ${placeName}`
        : "Popular searches";

  return (
    <section className="seo-popular" aria-label={heading}>
      <h2 className="seo-popular__title">{heading}</h2>
      <div className="chip-row">
        {intents.map((intent) => (
          <Link
            key={intent.slug}
            href={`${baseHref}/${intent.slug}` as Route}
            className="chip-btn chip-btn--sm"
          >
            {locale === "hi" ? intent.label_hi : intent.label_en}
          </Link>
        ))}
      </div>
    </section>
  );
}
