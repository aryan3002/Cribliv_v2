"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 404 boundary for every localised route.
 *
 * Its absence meant `notFound()` calls in the SEO page templates produced an
 * empty HTTP 200 response — a soft 404, the worst possible crawl signal, and
 * the reason Search Console reported 98.8% "OK (200)" while most submitted URLs
 * were broken. See docs/superpowers/specs/2026-07-26-programmatic-seo-indexability-design.md §4.3.
 *
 * A `not-found.tsx` receives no params, so the locale is read from the pathname
 * to keep the recovery links in the visitor's language.
 */
export default function LocaleNotFound() {
  const pathname = usePathname();
  const locale = pathname?.startsWith("/hi") ? "hi" : "en";

  return (
    <section className="container container--narrow" style={{ paddingBlock: "var(--space-8)" }}>
      <h1>Page not found</h1>
      <p>This page does not exist. It may have been removed, or the address may be incorrect.</p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-3)",
          marginBlockStart: "var(--space-6)"
        }}
      >
        <Link className="btn btn--primary" href={`/${locale}`}>
          Go to homepage
        </Link>
        <Link className="btn btn--secondary" href={`/${locale}/search`}>
          Browse rentals
        </Link>
      </div>
    </section>
  );
}
