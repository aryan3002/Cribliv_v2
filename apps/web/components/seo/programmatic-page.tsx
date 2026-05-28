import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, MapPin } from "lucide-react";
import { IntentGrid } from "./intent-grid";
import { StatsCard } from "./stats-card";
import { ListingsGrid } from "./listings-grid";
import { RelatedLinks } from "./related-links";
import { FaqSection } from "./faq-section";
import type { PageAggregates, ListingCard, SeoCopy } from "../../lib/seo-api";

export interface ProgrammaticPageProps {
  locale: "en" | "hi";
  /** Big H1 for the page. */
  h1: string;
  /** Optional intro paragraph above the stats card. */
  intro?: string | null;
  /** Optional secondary paragraph after stats. */
  nearbyBlurb?: string | null;
  aggregates: PageAggregates;
  listings: ListingCard[];
  viewAllHref: string;
  /**
   * If set, an intent grid will render at this base href. Omit on intent×
   * leaf pages where the grid is redundant.
   */
  intentBaseHref?: string | null;
  intentSurface: "locality" | "metro" | "landmark";
  relatedSections: Array<{
    title: string;
    items: Array<{ href: string; label: string; sublabel?: string | null }>;
    emptyHint?: string;
  }>;
  faqItems: Array<{ q: string; a: string }>;
  jsonLd: object[];
  ctaHref: string;
  ctaLabel: string;
  breadcrumbs: Array<{ name: string; href: string }>;
}

export function ProgrammaticPage(props: ProgrammaticPageProps) {
  const { locale } = props;
  return (
    <>
      {props.jsonLd.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}

      <div
        className="container"
        style={{ paddingTop: "var(--space-6)", paddingBottom: "var(--space-12)" }}
      >
        {/* Breadcrumb */}
        <nav
          aria-label={locale === "hi" ? "ब्रेडक्रंब" : "Breadcrumb"}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: "var(--space-4)",
            fontSize: 12,
            color: "var(--text-secondary)"
          }}
        >
          {props.breadcrumbs.map((bc, i) => (
            <span key={bc.href}>
              {i > 0 && <span style={{ margin: "0 6px" }}>›</span>}
              {i < props.breadcrumbs.length - 1 ? (
                <Link
                  href={bc.href as Route}
                  style={{ color: "var(--text-secondary)", textDecoration: "none" }}
                >
                  {bc.name}
                </Link>
              ) : (
                <span aria-current="page" style={{ color: "var(--text)" }}>
                  {bc.name}
                </span>
              )}
            </span>
          ))}
        </nav>

        <header style={{ marginBottom: "var(--space-6)" }}>
          <h1 style={{ marginBottom: "var(--space-3)" }}>
            <MapPin
              size={22}
              style={{ display: "inline", marginRight: 8, color: "var(--brand)" }}
              aria-hidden="true"
            />
            {props.h1}
          </h1>
          {props.intro && (
            <p className="body-md text-secondary" style={{ maxWidth: 720 }}>
              {props.intro}
            </p>
          )}
        </header>

        <StatsCard aggregates={props.aggregates} locale={locale} />

        {props.nearbyBlurb && (
          <p
            className="body-sm text-secondary"
            style={{ maxWidth: 720, marginBottom: "var(--space-6)" }}
          >
            {props.nearbyBlurb}
          </p>
        )}

        {props.intentBaseHref && (
          <IntentGrid
            baseHref={props.intentBaseHref}
            surface={props.intentSurface}
            locale={locale}
          />
        )}

        <ListingsGrid
          title={locale === "hi" ? "उपलब्ध लिस्टिंग" : "Available listings"}
          items={props.listings}
          emptyMessage={
            locale === "hi"
              ? "अभी इस क्षेत्र में कोई सक्रिय लिस्टिंग नहीं है। नई लिस्टिंग के लिए अलर्ट सेट करें।"
              : "No active listings in this area yet. Set an alert to be notified when one appears."
          }
          viewAllHref={props.viewAllHref}
          locale={locale}
        />

        {props.relatedSections.map((section) => (
          <RelatedLinks
            key={section.title}
            title={section.title}
            items={section.items}
            locale={locale}
            emptyHint={section.emptyHint}
          />
        ))}

        <FaqSection
          title={locale === "hi" ? "अक्सर पूछे जाने वाले प्रश्न" : "Frequently asked questions"}
          items={props.faqItems}
        />

        <section style={{ marginTop: "var(--space-8)", textAlign: "center" }}>
          <Link href={props.ctaHref as Route} className="btn btn--primary btn--lg">
            {props.ctaLabel} <ArrowRight size={18} />
          </Link>
        </section>
      </div>
    </>
  );
}

/**
 * Coalesces AI copy (when present) with template defaults. Pages call this
 * to get a stable shape regardless of whether the AI ran.
 */
export function coalesceCopy(
  copy: SeoCopy | null,
  defaults: {
    h1: string;
    intro: string;
    faqs: Array<{ q: string; a: string }>;
    nearbyBlurb?: string | null;
  }
): {
  h1: string;
  intro: string;
  faqs: Array<{ q: string; a: string }>;
  nearbyBlurb: string | null;
} {
  return {
    h1: copy?.h1 || defaults.h1,
    intro: copy?.intro_paragraph || defaults.intro,
    faqs: copy?.faq_items && copy.faq_items.length > 0 ? copy.faq_items : defaults.faqs,
    nearbyBlurb: copy?.nearby_blurb ?? defaults.nearbyBlurb ?? null
  };
}
