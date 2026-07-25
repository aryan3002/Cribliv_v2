import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../cribliv-times.module.css";
import { Masthead } from "../../_components/Masthead";
import { formatDate } from "../../_components/blog-format";
import { fetchBlogList } from "../../../../../lib/blog-api";
import { EDITORIAL_AUTHOR } from "../../../../../lib/blog-author";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export function generateStaticParams() {
  return [
    { locale: "en", authorSlug: EDITORIAL_AUTHOR.slug },
    { locale: "hi", authorSlug: EDITORIAL_AUTHOR.slug }
  ];
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; authorSlug: string };
}): Promise<Metadata> {
  if (params.authorSlug !== EDITORIAL_AUTHOR.slug) return { title: "Not found" };
  const hi = params.locale === "hi";
  const title = `${EDITORIAL_AUTHOR.name}, ${EDITORIAL_AUTHOR.role}`;
  const description = hi ? EDITORIAL_AUTHOR.bio_hi : EDITORIAL_AUTHOR.bio_en;
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/blog/author/${EDITORIAL_AUTHOR.slug}`,
      languages: {
        en: `${BASE_URL}/en/blog/author/${EDITORIAL_AUTHOR.slug}`,
        hi: `${BASE_URL}/hi/blog/author/${EDITORIAL_AUTHOR.slug}`
      }
    }
  };
}

export default async function AuthorPage({
  params
}: {
  params: { locale: string; authorSlug: string };
}) {
  if (params.authorSlug !== EDITORIAL_AUTHOR.slug) notFound();
  const locale = params.locale;
  const hi = locale === "hi";

  const { items } = await fetchBlogList({ page_size: 12 });
  const byAuthor = items.filter((post) => post.author === EDITORIAL_AUTHOR.name).slice(0, 6);

  const personJsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: EDITORIAL_AUTHOR.name,
    jobTitle: EDITORIAL_AUTHOR.role,
    description: hi ? EDITORIAL_AUTHOR.bio_hi : EDITORIAL_AUTHOR.bio_en,
    url: `${BASE_URL}/${locale}/blog/author/${EDITORIAL_AUTHOR.slug}`,
    worksFor: { "@type": "Organization", name: "Cribliv", url: BASE_URL }
  };

  return (
    <div className={styles.paper}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <Masthead
        locale={locale}
        activeCategory={null}
        dateLabel={formatDate(new Date().toISOString(), locale)}
      />

      <Link href={`/${locale}/blog`} className={styles.backToFront}>
        {hi ? "← मुख पृष्ठ" : "← Front Page"}
      </Link>

      <article className={styles.article}>
        <p className={`${styles.kicker} ${styles.articleKicker}`}>{EDITORIAL_AUTHOR.desk}</p>
        <h1 className={styles.articleTitle}>{EDITORIAL_AUTHOR.name}</h1>
        <div className={styles.articleByline}>{EDITORIAL_AUTHOR.role}</div>
        <div className={styles.articleBody}>
          <p>{hi ? EDITORIAL_AUTHOR.bio_hi : EDITORIAL_AUTHOR.bio_en}</p>
        </div>
      </article>

      {byAuthor.length > 0 ? (
        <div className={styles.related}>
          <p className={styles.relatedHead}>{hi ? "हाल की रिपोर्ट" : "Recent Reporting"}</p>
          {byAuthor.map((post) => (
            <div className={styles.relatedItem} key={post.slug}>
              <Link href={`/${locale}/blog/${post.slug}`}>{post.title}</Link>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.colophon}>
        <b>Cribliv Times</b>, {hi ? "Cribliv का डेटा डेस्क" : "the Cribliv data desk"}
      </div>
    </div>
  );
}
