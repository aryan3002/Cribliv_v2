import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../cribliv-times.module.css";
import { Masthead } from "../_components/Masthead";
import { formatDate, cityLabel, deskLabel, formatRent } from "../_components/blog-format";
import { fetchApi, buildSearchQuery } from "../../../../lib/api";
import { fetchBlogPost, fetchAllBlogSlugs } from "../../../../lib/blog-api";
import { stripBrandSuffix } from "../../../../lib/seo";
import { locales } from "../../../../lib/i18n";
import { prepareBlogBody } from "../../../../lib/blog-body";
import { hasBlogEmbeds } from "../../../../lib/blog-embeds";
import { BlogBody } from "../../../../components/blog/BlogBody";
import { EDITORIAL_AUTHOR, authorPath } from "../../../../lib/blog-author";
import { buildArticle, buildBreadcrumb, buildFaqPage } from "../../../../lib/structured-data";

// Two things are required for an article to be served from cache, and this route
// previously had neither despite the export below. First, every fetch in the
// tree must be cacheable — the post fetch, the bridge-listing fetch and the
// embed-card fetches all used `no-store`, and one uncached fetch opts the whole
// route into per-request SSR. Second, the route needs generateStaticParams:
// without it a page under a dynamic segment re-renders per request regardless of
// how well its fetches are cached, so we would pay CPU on every article view.
export const revalidate = 3600;

// Prerender the articles that exist at build time. Posts published later (the
// AI generation pipeline adds them continuously) are NOT listed here and are
// rendered on first request, then cached for `revalidate` — which is exactly the
// behaviour we want, and is why this list being incomplete is fine. It degrades
// to [] if the API is unreachable during the build; the route still ISRs.
export async function generateStaticParams() {
  const slugs = await fetchAllBlogSlugs();
  return locales.flatMap((locale) => slugs.map((slug) => ({ locale, slug })));
}

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

interface BridgeListing {
  id: string;
  title: string;
  city: string;
  locality?: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
  cover_photo?: string | null;
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const data = await fetchBlogPost(params.slug, { revalidate });
  if (!data) return { title: "Not found" };
  const { post } = data;
  // AI-generated post meta_titles sometimes append the brand despite the prompt
  // telling them not to; the layout template adds it regardless.
  const title = stripBrandSuffix(post.meta_title || post.title);
  const description = post.meta_description || post.excerpt || undefined;
  return {
    title,
    description,
    // Google Discover requires large image previews to surface a story at all.
    robots: { "max-image-preview": "large" },
    alternates: {
      canonical: `${BASE_URL}/en/blog/${post.slug}`,
      languages: {
        en: `${BASE_URL}/en/blog/${post.slug}`,
        hi: `${BASE_URL}/hi/blog/${post.slug}`
      }
    },
    openGraph: {
      title,
      description,
      type: "article",
      url: `${BASE_URL}/${params.locale}/blog/${post.slug}`,
      siteName: "Cribliv",
      locale: params.locale === "hi" ? "hi_IN" : "en_IN"
      // No `images` key: even an explicit `undefined` here blocks Next from
      // merging in the file-based opengraph-image.tsx card (verified — the
      // front page, which omits the key, gets its card; this page did not).
      // The branded Times card should win for every story anyway.
    },
    twitter: { card: "summary_large_image", title, description }
  };
}

export default async function BlogDetailPage({
  params
}: {
  params: { locale: string; slug: string };
}) {
  const locale = params.locale;
  const hi = locale === "hi";
  const data = await fetchBlogPost(params.slug, { revalidate });
  if (!data) notFound();
  const { post, related } = data;

  // Conversion bridge: pull a few real listings matched to the story (same city,
  // and BHK if the title/slug implies one), so the article ends on live rentals
  // — each link is tagged ?ref=blog-{slug} for click -> unlock attribution.
  const bhkMatch = `${post.title} ${post.slug}`.match(/(\d)\s*bhk/i);
  let bridgeListings: BridgeListing[] = [];
  if (post.city_slug) {
    try {
      const query = buildSearchQuery({
        city: post.city_slug,
        sort: "verified",
        page_size: "3",
        ...(bhkMatch ? { bhk: bhkMatch[1] } : {})
      });
      const res = await fetchApi<{ items: BridgeListing[] }>(
        `/listings/search?${query}`,
        undefined,
        { revalidate }
      );
      bridgeListings = (res.items ?? []).slice(0, 3);
    } catch {
      // best-effort — the article still prints without live listings
    }
  }

  // Render-time prep of the LLM-generated body: drop the embedded duplicate H1
  // (the page renders post.title as the sole H1) and localize internal links,
  // whose stored hrefs are locale-relative (`/rent-in/lucknow`) and would 404
  // without a `/{locale}` segment. See lib/blog-body.ts.
  const body = prepareBlogBody((hi && post.body_hi) || post.body_en || "", locale);
  // Stored titles sometimes carry the "| Cribliv" SEO suffix; that belongs in
  // the <title> template, never in a printed headline.
  const headline = stripBrandSuffix(post.title);
  const dateLabel = formatDate(post.published_at ?? post.updated_at, locale);
  const authorIsPersona = post.author === EDITORIAL_AUTHOR.name;
  const sourceLabels = (post.sources || []).map((s) => s.label).filter(Boolean);

  // Most AI-generated posts publish without art, and Google Discover only
  // surfaces stories with a large in-article image. When there's no hero,
  // print a photograph from a live listing in the story's city — captioned and
  // linked, in the "every figure sourced from live listings" spirit.
  const heroListing = !post.hero_image_path
    ? (bridgeListings.find((b) => b.cover_photo) ?? null)
    : null;
  const heroSrc = post.hero_image_path ?? heroListing?.cover_photo ?? null;

  const articleJsonLd = buildArticle({
    headline,
    description: post.meta_description || post.excerpt,
    authorName: post.author,
    authorUrl: authorPath(hi ? "hi" : "en"),
    datePublished: post.published_at,
    dateModified: post.updated_at,
    image: heroSrc,
    url: `/${locale}/blog/${post.slug}`
  });
  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Cribliv Times", href: `/${locale}/blog` },
    { name: headline, href: `/${locale}/blog/${post.slug}` }
  ]);
  const jsonLdNodes = [articleJsonLd, breadcrumbJsonLd];
  if (post.faq_items?.length) jsonLdNodes.push(buildFaqPage(post.faq_items));

  return (
    <div className={styles.paper}>
      {jsonLdNodes.map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}
      <Masthead locale={locale} activeCategory={post.category_slug ?? null} dateLabel={dateLabel} />

      <Link href={`/${locale}/blog`} className={styles.backToFront}>
        {hi ? "← मुख पृष्ठ" : "← Front Page"}
      </Link>

      <article className={styles.article}>
        <p className={`${styles.kicker} ${styles.articleKicker}`}>
          {deskLabel(post.category_slug, hi)}
        </p>
        <h1 className={styles.articleTitle}>{headline}</h1>
        <div className={styles.articleByline}>
          {post.city_slug ? <>{cityLabel(post.city_slug)} · </> : null}
          {hi ? "द्वारा " : "By "}
          {authorIsPersona ? (
            <Link href={authorPath(hi ? "hi" : "en")}>{post.author}</Link>
          ) : (
            post.author
          )}
          {dateLabel ? ` · ${dateLabel}` : ""}
        </div>

        {post.hero_image_path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.hero} src={post.hero_image_path} alt={headline} />
        ) : heroListing?.cover_photo ? (
          <figure className={styles.heroFigure}>
            <Link href={`/${locale}/listing/${heroListing.id}?ref=blog-${post.slug}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.hero} src={heroListing.cover_photo} alt={heroListing.title} />
            </Link>
            <figcaption className={styles.heroCaption}>
              {hi ? "चित्र: " : "Pictured: "}
              <Link href={`/${locale}/listing/${heroListing.id}?ref=blog-${post.slug}`}>
                {heroListing.title}
              </Link>
              {" · "}
              {hi ? "लाइव लिस्टिंग" : "a live Cribliv listing"}
            </figcaption>
          </figure>
        ) : null}

        {hasBlogEmbeds(body) ? (
          <div className={styles.articleBody}>
            <BlogBody html={body} locale={locale} slug={post.slug} revalidate={revalidate} />
          </div>
        ) : (
          <div className={styles.articleBody} dangerouslySetInnerHTML={{ __html: body }} />
        )}

        {sourceLabels.length > 0 ? (
          <p className={styles.sourceLine}>
            {hi ? "स्रोत: " : "Source: "}
            {sourceLabels.join(" · ")}
            {post.data_asof ? ` · ${hi ? "डेटा" : "data as of"} ${post.data_asof}` : ""}
          </p>
        ) : null}

        <div className={styles.shareRow}>
          <span className={styles.shareLabel}>{hi ? "यह रिपोर्ट भेजें" : "Pass this along"}</span>
          <a
            className={styles.shareLink}
            href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
              `${headline} — ${BASE_URL}/${locale}/blog/${post.slug}`
            )}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {hi ? "WhatsApp पर भेजें →" : "Share on WhatsApp →"}
          </a>
        </div>

        {post.faq_items?.length ? (
          <>
            <h2 className={styles.faqHead}>
              {hi ? "अक्सर पूछे जाने वाले प्रश्न" : "Questions & Answers"}
            </h2>
            {post.faq_items.map((faq, i) => (
              <div className={styles.faqItem} key={i}>
                <strong>{faq.q}</strong>
                <p>{faq.a}</p>
              </div>
            ))}
          </>
        ) : null}
      </article>

      {bridgeListings.length > 0 ? (
        <section className={styles.classifieds} aria-label="Rentals related to this story">
          <div className={styles.classHead}>
            <h3>
              {hi
                ? `${cityLabel(post.city_slug ?? "")} में उपलब्ध किराये`
                : `Open rentals in ${cityLabel(post.city_slug ?? "")}`}
            </h3>
            <span>{hi ? "सत्यापित लिस्टिंग" : "Verified · from live listings"}</span>
          </div>
          <div className={styles.ads}>
            {bridgeListings.map((listing) => (
              <Link
                className={styles.ad}
                href={`/${locale}/listing/${listing.id}?ref=blog-${post.slug}`}
                key={listing.id}
              >
                <div className={styles.adTop}>
                  <h5>{listing.title}</h5>
                  <span className={styles.price}>
                    {formatRent(listing.monthly_rent)}
                    <small>{hi ? "/माह" : "/month"}</small>
                  </span>
                </div>
                <p>
                  {[listing.locality, cityLabel(listing.city)].filter(Boolean).join(", ")} ·{" "}
                  {listing.listing_type === "pg" ? "PG" : hi ? "फ्लैट" : "Flat/House"}
                </p>
                <span className={styles.adCta}>
                  {hi ? "संपर्क अनलॉक करें →" : "Unlock contact →"}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : post.city_slug ? (
        <div className={styles.bridge}>
          <div>
            <p className={styles.kicker}>{hi ? "क्लासिफाइड्स से" : "From the Classifieds"}</p>
            <strong>
              {hi
                ? `${cityLabel(post.city_slug)} में सत्यापित किराये अभी उपलब्ध हैं।`
                : `Verified rentals in ${cityLabel(post.city_slug)} are open now.`}
            </strong>
          </div>
          <Link href={`/${locale}/city/${post.city_slug}`} className={styles.bridgeCta}>
            {hi
              ? `${cityLabel(post.city_slug)} में खोजें →`
              : `Browse ${cityLabel(post.city_slug)} →`}
          </Link>
        </div>
      ) : null}

      {related.length > 0 ? (
        <div className={styles.related}>
          <p className={styles.relatedHead}>{hi ? "संबंधित रिपोर्ट" : "Related Reporting"}</p>
          {related.map((rel) => (
            <div className={styles.relatedItem} key={rel.slug}>
              <Link href={`/${locale}/blog/${rel.slug}`}>{stripBrandSuffix(rel.title)}</Link>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.colophon}>
        <b>Cribliv Times</b>,{" "}
        {hi
          ? "Cribliv के डेटा डेस्क का एक उत्पाद"
          : "a data-desk product of Cribliv · Every figure sourced from live listings"}
      </div>
    </div>
  );
}
