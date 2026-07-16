import Link from "next/link";
import type { Route } from "next";
import { ArrowRight, MapPin } from "lucide-react";
import { IntentGrid } from "./intent-grid";
import { StatsCard } from "./stats-card";
import { ListingsGrid } from "./listings-grid";
import { RelatedLinks } from "./related-links";
import { FaqSection } from "./faq-section";
import type { PageAggregates, ListingCard, SeoCopy } from "../../lib/seo-api";
import { jsonLdSafe } from "../../lib/jsonld";

export interface ProgrammaticPageProps {
  locale: "en" | "hi";
  /** Big H1 for the page. */
  h1: string;
  /** Optional intro paragraph above the stats card. */
  intro?: string | null;
  /** Place name, used for the "Popular searches in {place}" heading. */
  placeName?: string | null;
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
          dangerouslySetInnerHTML={{ __html: jsonLdSafe(node) }}
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

        {/* Hero — lead with the place, the numbers and a CTA, not filters. */}
        <header className="seo-hero">
          <h1 className="seo-hero__title">
            <MapPin size={20} className="seo-hero__pin" aria-hidden="true" />
            <span>{props.h1}</span>
          </h1>
          {props.intro && <p className="seo-hero__intro">{props.intro}</p>}

          <StatsCard aggregates={props.aggregates} locale={locale} />

          {props.nearbyBlurb && <p className="seo-hero__nearby">{props.nearbyBlurb}</p>}

          <div className="seo-hero__cta">
            <Link href={props.viewAllHref as Route} className="btn btn--primary btn--lg">
              {props.ctaLabel} <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        </header>

        {/* Listings first — real inventory above the fold, not the filter wall. */}
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

        {/* Popular searches — compact internal-linking band, below the listings. */}
        {props.intentBaseHref && (
          <IntentGrid
            baseHref={props.intentBaseHref}
            surface={props.intentSurface}
            locale={locale}
            placeName={props.placeName}
          />
        )}

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

        <section className="seo-cta-band">
          <Link href={props.ctaHref as Route} className="btn btn--primary btn--lg">
            {props.ctaLabel} <ArrowRight size={18} aria-hidden="true" />
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
