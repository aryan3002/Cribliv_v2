import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "../../cribliv-times.module.css";
import { Masthead, DESKS } from "../../_components/Masthead";
import { formatDate, deskLabel } from "../../_components/blog-format";
import { fetchBlogList } from "../../../../../lib/blog-api";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";
const DESK_SLUGS = DESKS.map((d) => d.slug).filter((s): s is string => !!s);

export function generateStaticParams() {
  return DESK_SLUGS.flatMap((categorySlug) => [
    { locale: "en", categorySlug },
    { locale: "hi", categorySlug }
  ]);
}

export async function generateMetadata({
  params
}: {
  params: { locale: string; categorySlug: string };
}): Promise<Metadata> {
  if (!DESK_SLUGS.includes(params.categorySlug)) return { title: "Not found" };
  const hi = params.locale === "hi";
  const desk = deskLabel(params.categorySlug, hi);
  const title = `${desk} · Cribliv Times`;
  const description = hi
    ? `Cribliv Times के ${desk} डेस्क से किराया रिपोर्ट और गाइड।`
    : `Reporting and guides from the ${desk} desk of Cribliv Times.`;
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/blog/category/${params.categorySlug}`,
      languages: {
        en: `${BASE_URL}/en/blog/category/${params.categorySlug}`,
        hi: `${BASE_URL}/hi/blog/category/${params.categorySlug}`
      }
    }
  };
}

export default async function DeskPage({
  params
}: {
  params: { locale: string; categorySlug: string };
}) {
  if (!DESK_SLUGS.includes(params.categorySlug)) notFound();
  const locale = params.locale;
  const hi = locale === "hi";
  const desk = deskLabel(params.categorySlug, hi);

  const { items } = await fetchBlogList({ category: params.categorySlug, page_size: 24 });

  return (
    <div className={styles.paper}>
      <Masthead
        locale={locale}
        activeCategory={params.categorySlug}
        dateLabel={formatDate(items[0]?.published_at ?? new Date().toISOString(), locale)}
      />

      <div className={styles.deskHead}>
        <p className={styles.kicker}>{hi ? "डेस्क" : "The Desk"}</p>
        <h1 className={styles.deskTitle}>{desk}</h1>
      </div>

      {items.length === 0 ? (
        <p className={styles.empty}>
          {hi ? "इस डेस्क से अभी कोई रिपोर्ट नहीं है।" : "No reports filed to this desk yet."}
        </p>
      ) : (
        <div className={styles.deskGrid}>
          {items.map((post) => (
            <Link className={styles.deskCard} href={`/${locale}/blog/${post.slug}`} key={post.slug}>
              <p className={styles.kicker}>{formatDate(post.published_at, locale)}</p>
              <h3>{post.title}</h3>
              {post.excerpt ? <p>{post.excerpt}</p> : null}
            </Link>
          ))}
        </div>
      )}

      <div className={styles.colophon}>
        <b>Cribliv Times</b>, {hi ? "Cribliv का डेटा डेस्क" : "the Cribliv data desk"}
      </div>
    </div>
  );
}
