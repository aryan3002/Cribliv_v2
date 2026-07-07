import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../cribliv-times.module.css";
import { Masthead } from "../_components/Masthead";
import { formatDate, cityLabel, deskLabel } from "../_components/blog-format";
import { fetchBlogPost } from "../../../../lib/blog-api";
import { EDITORIAL_AUTHOR, authorPath } from "../../../../lib/blog-author";
import { buildArticle, buildBreadcrumb, buildFaqPage } from "../../../../lib/structured-data";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export async function generateMetadata({
  params
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  const data = await fetchBlogPost(params.slug);
  if (!data) return { title: "Not found — Cribliv Times" };
  const { post } = data;
  const title = post.meta_title || post.title;
  const description = post.meta_description || post.excerpt || undefined;
  return {
    title,
    description,
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
      locale: params.locale === "hi" ? "hi_IN" : "en_IN",
      images: post.hero_image_path ? [{ url: post.hero_image_path }] : undefined
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
  const data = await fetchBlogPost(params.slug);
  if (!data) notFound();
  const { post, related } = data;

  const body = (hi && post.body_hi) || post.body_en || "";
  const dateLabel = formatDate(post.published_at ?? post.updated_at, locale);
  const authorIsPersona = post.author === EDITORIAL_AUTHOR.name;
  const sourceLabels = (post.sources || []).map((s) => s.label).filter(Boolean);

  const articleJsonLd = buildArticle({
    headline: post.title,
    description: post.meta_description || post.excerpt,
    authorName: post.author,
    authorUrl: authorPath(hi ? "hi" : "en"),
    datePublished: post.published_at,
    dateModified: post.updated_at,
    image: post.hero_image_path,
    url: `/${locale}/blog/${post.slug}`
  });
  const breadcrumbJsonLd = buildBreadcrumb([
    { name: "Cribliv Times", href: `/${locale}/blog` },
    { name: post.title, href: `/${locale}/blog/${post.slug}` }
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
        <h1 className={styles.articleTitle}>{post.title}</h1>
        <div className={styles.articleByline}>
          {post.city_slug ? <>{cityLabel(post.city_slug)} — </> : null}
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
          <img className={styles.hero} src={post.hero_image_path} alt={post.title} />
        ) : null}

        <div className={styles.articleBody} dangerouslySetInnerHTML={{ __html: body }} />

        {sourceLabels.length > 0 ? (
          <p className={styles.sourceLine}>
            {hi ? "स्रोत: " : "Source: "}
            {sourceLabels.join(" · ")}
            {post.data_asof ? ` · ${hi ? "डेटा" : "data as of"} ${post.data_asof}` : ""}
          </p>
        ) : null}

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

      {post.city_slug ? (
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
              <Link href={`/${locale}/blog/${rel.slug}`}>{rel.title}</Link>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.colophon}>
        <b>Cribliv Times</b> —{" "}
        {hi
          ? "Cribliv के डेटा डेस्क का एक उत्पाद"
          : "a data-desk product of Cribliv · Every figure sourced from live listings"}
      </div>
    </div>
  );
}
