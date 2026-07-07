import { Injectable, Logger, Optional } from "@nestjs/common";
import { SeoAggregatesService } from "../seo/seo-aggregates.service";
import { buildRentChartSvg, rentBarsFromFacts } from "./blog-chart";
import { callBlogJson } from "./blog-llm";
import { countCitedDataPoints, qualityScore } from "./quality-gate";
import type {
  BlogBriefRow,
  BlogDataPoint,
  BlogFaqItem,
  BlogSource,
  QualityBreakdown
} from "./blog.types";

export type CallJson = <T>(opts: {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
}) => Promise<T | null>;

export interface GeneratedPost {
  slug: string;
  title: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  bodyEn: string;
  bodyHi: string;
  targetKeyword: string;
  intent: string | null;
  citySlug: string | null;
  categorySlug: string | null;
  faqItems: BlogFaqItem[];
  sources: BlogSource[];
  dataAsof: string | null;
  dataFacts: BlogDataPoint[];
  citedDataPointCount: number;
  isDataPost: boolean;
  quality: QualityBreakdown;
}

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function titleizeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function renderDataFactBlock(
  facts: BlogDataPoint[],
  dataAsof: string | null,
  place: string | null
): string {
  if (facts.length === 0) return "";

  const listingCount = facts.find((f) => f.key === "listing_count")?.value;
  const captionParts = ["Median monthly rent from Cribliv live listings"];
  if (place) captionParts.push(place);
  if (typeof listingCount === "number" && listingCount > 0) {
    captionParts.push(`based on ${listingCount} active listing${listingCount === 1 ? "" : "s"}`);
  }
  if (dataAsof) captionParts.push(`data as of ${dataAsof}`);
  const caption = `${captionParts.join(" · ")}.`;

  // When rent medians are available, lead with the Data Desk chart. Otherwise
  // fall back to the plain figures list (e.g. counts-only localities).
  const bars = rentBarsFromFacts(facts);
  if (bars.length > 0) {
    const title = place ? `What renters pay in ${place}` : "Median monthly rent by home type";
    return `
<figure data-blog-chart="cribliv-live-listings">
  ${buildRentChartSvg(bars, title)}
  <figcaption>${caption}</figcaption>
</figure>`;
  }

  const items = facts
    .map(
      (fact) =>
        `<li><strong>${fact.label}</strong>: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}</li>`
    )
    .join("");
  return `
<section data-blog-facts="cribliv-live-listings">
  <h2>Cribliv live rental data</h2>
  <p>These figures are sourced from Cribliv live listings and are used as grounding facts for this rental guide${dataAsof ? `, with data as of ${dataAsof}` : ""}.</p>
  <ul>${items}</ul>
</section>`;
}

@Injectable()
export class BlogGeneratorService {
  private readonly logger = new Logger(BlogGeneratorService.name);

  constructor(
    private readonly aggregates: SeoAggregatesService,
    @Optional() private readonly callJson: CallJson = (opts) => callBlogJson(opts)
  ) {}

  async buildDataFacts(brief: BlogBriefRow): Promise<BlogDataPoint[]> {
    if (!brief.city_slug) return [];

    const localities = await this.aggregates.localitiesForCity(brief.city_slug);
    const keyword = brief.target_keyword.toLowerCase();
    const match = localities.find(
      (locality) =>
        keyword.includes(locality.slug.replace(/-/g, " ")) || keyword.includes(locality.slug)
    );
    const localitySlug = match?.slug ?? localities[0]?.slug;
    if (!localitySlug) return [];

    const aggregates = await this.aggregates.aggregatesForLocality(brief.city_slug, localitySlug);
    const facts: BlogDataPoint[] = [];
    const push = (key: string, label: string, value: number | null, unit?: string) => {
      if (value != null) facts.push({ key, label, value, unit: unit ?? null });
    };

    push("median_rent_1bhk", "Median 1BHK rent", aggregates.median_rent_1bhk, "₹/mo");
    push("median_rent_2bhk", "Median 2BHK rent", aggregates.median_rent_2bhk, "₹/mo");
    push("median_rent_3bhk", "Median 3BHK rent", aggregates.median_rent_3bhk, "₹/mo");
    push("median_rent_pg", "Median PG rent", aggregates.median_rent_pg, "₹/mo");
    push("listing_count", "Active listings", aggregates.listing_count);
    push("pg_count", "PG listings", aggregates.pg_count);
    push("flat_count", "Flat/house listings", aggregates.flat_count);
    return facts;
  }

  // Applies an editor instruction to one field of an existing post and returns
  // the full revised text (body stays HTML; title/excerpt stay plain). Used by
  // the admin "ask AI to revise" edit control — it proposes, the human saves.
  async revise(input: {
    target: "body" | "title" | "excerpt";
    currentText: string;
    instruction: string;
    keyword: string;
  }): Promise<string | null> {
    const isBody = input.target === "body";
    const guidance = isBody
      ? "Return valid HTML using only <p>, <h2>, <h3>, <ul>, <li>, <blockquote>. Keep the parts the instruction does not mention. Never invent statistics or numbers not already present."
      : "Return plain text only — no HTML, no quotes around it.";
    const result = await this.callJson<{ revised: string }>({
      system:
        "You are a senior editor for an Indian rental platform. Apply the user's instruction to the provided content and return the COMPLETE revised version of that field. " +
        guidance +
        ' Reply JSON only as {"revised":"..."}.',
      user:
        `Target keyword: ${input.keyword}\nField: ${input.target}\n` +
        `INSTRUCTION: ${input.instruction}\n\nCURRENT ${input.target.toUpperCase()}:\n${input.currentText}`,
      maxTokens: isBody ? 4000 : 500,
      temperature: 0.4
    });
    const revised = result?.revised?.trim();
    return revised && revised.length > 0 ? revised : null;
  }

  async generate(
    brief: BlogBriefRow,
    uniquenessDistance: number | null = null
  ): Promise<GeneratedPost | null> {
    const isDataPost = brief.post_type === "data_report";
    const dataFacts = await this.buildDataFacts(brief);
    const factsBlock = dataFacts.length
      ? dataFacts
          .map((fact) => `- ${fact.label}: ${fact.value}${fact.unit ? ` ${fact.unit}` : ""}`)
          .join("\n")
      : "(no live figures available - do NOT invent any numbers)";
    const linkBlock = brief.internal_link_targets
      .map((target) => `- ${target.label} -> ${target.href}`)
      .join("\n");

    const outline = await this.callJson<{
      sections: Array<{ heading: string; subheadings?: string[] }>;
    }>({
      system:
        "You are a senior real-estate content editor. Produce a JSON outline (H2/H3) for a blog post from the brief. Reply JSON only.",
      user:
        `Brief keyword: ${brief.target_keyword}\nIntent: ${brief.intent ?? "informational"}\n` +
        `Base outline: ${JSON.stringify(brief.outline)}\n` +
        'Return {"sections":[{"heading":"...","subheadings":["..."]}]} covering the brief with 4-7 sections.',
      temperature: 0.4
    });
    if (!outline?.sections?.length) {
      this.logger.debug(`Outline step failed for brief ${brief.id}`);
      return null;
    }

    const draft = await this.callJson<{ html: string }>({
      system:
        'You write section-by-section blog prose for an Indian rental platform. Use ONLY the provided facts for any numbers. Weave in the provided internal links naturally. Reply JSON only with {"html": "..."}.',
      user:
        `Keyword: ${brief.target_keyword}\nOutline: ${JSON.stringify(outline.sections)}\n\n` +
        `GROUND-TRUTH FACTS (quote these exact numbers; never invent others):\n${factsBlock}\n\n` +
        `MANDATORY internal links to include (use the exact hrefs):\n${linkBlock}\n\n` +
        `Write ${isDataPost ? "1200+" : "900+"} words of helpful HTML (<p>, <h2>, <h3>, <ul>). ` +
        "Open with an H1 that contains the keyword and state the headline number in the first 100 words.",
      maxTokens: 4000,
      temperature: 0.5
    });
    if (!draft?.html) {
      this.logger.debug(`Section step failed for brief ${brief.id}`);
      return null;
    }

    const checked = await this.callJson<{ html: string; ok: boolean }>({
      system:
        'You are a fact-checker. Given the draft HTML and the ground-truth facts, remove or correct any number NOT present in the facts, and remove unsupported claims. Reply JSON only with {"html":"<corrected html>","ok":true}.',
      user: `FACTS:\n${factsBlock}\n\nDRAFT:\n${draft.html}`,
      maxTokens: 4000,
      temperature: 0.2
    });
    const bodyAfterCheck = checked?.html && checked.html.length > 200 ? checked.html : draft.html;

    const seo = await this.callJson<{
      title: string;
      h1: string;
      meta_title: string;
      meta_description: string;
      excerpt: string;
      faq_items: BlogFaqItem[];
      body_hi: string;
    }>({
      system:
        "You are an SEO + readability editor. Given the body HTML and keyword, produce title, H1, meta, excerpt, a 3-5 item FAQ, and a faithful Hindi (Devanagari) rendering of the body. Keyword must appear naturally in title, H1, and the first 100 words. Reply JSON only.",
      user:
        `Keyword: ${brief.target_keyword}\nBODY:\n${bodyAfterCheck}\n\n` +
        'Return {"title","h1","meta_title","meta_description","excerpt","faq_items":[{"q","a"}],"body_hi"}.',
      maxTokens: 4000,
      temperature: 0.4
    });
    if (!seo?.title || !seo.h1 || !seo.body_hi) {
      this.logger.debug(`SEO step failed for brief ${brief.id}`);
      return null;
    }

    const bodyWithH1 = bodyAfterCheck.includes("<h1")
      ? bodyAfterCheck
      : `<h1>${seo.h1}</h1>\n${bodyAfterCheck}`;
    const dataAsof = isDataPost ? new Date().toISOString().slice(0, 10) : null;
    const place = brief.city_slug ? titleizeSlug(brief.city_slug) : null;
    const bodyEn = `${bodyWithH1}\n${renderDataFactBlock(dataFacts, dataAsof, place)}`;
    // Data posts cite live listings; non-data posts (guides/evergreen) are
    // attributed to Cribliv's editorial desk. Every post carries >=1 source so
    // the gate's "cited sources" check can pass — otherwise non-data posts are
    // structurally forced to needs_attention and can never become a draft.
    const sources: BlogSource[] = isDataPost
      ? [{ label: "Cribliv live listings", asof: dataAsof }]
      : [{ label: "Cribliv editorial", asof: null }];
    const citedDataPointCount = countCitedDataPoints(bodyEn, sources);
    const quality = qualityScore({
      title: seo.title,
      h1: seo.h1,
      bodyHtml: bodyEn,
      targetKeyword: brief.target_keyword,
      faqItems: seo.faq_items ?? [],
      sources,
      isDataPost,
      citedDataPointCount,
      uniquenessDistance
    });

    return {
      slug: slugify(brief.target_keyword),
      title: seo.title,
      h1: seo.h1,
      metaTitle: seo.meta_title,
      metaDescription: seo.meta_description,
      excerpt: seo.excerpt,
      bodyEn,
      bodyHi: seo.body_hi,
      targetKeyword: brief.target_keyword,
      intent: brief.intent,
      citySlug: brief.city_slug,
      categorySlug: brief.category_slug,
      faqItems: seo.faq_items ?? [],
      sources,
      dataAsof,
      dataFacts,
      citedDataPointCount,
      isDataPost,
      quality
    };
  }
}
