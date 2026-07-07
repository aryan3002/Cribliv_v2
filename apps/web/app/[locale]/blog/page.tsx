import type { Metadata } from "next";
import Link from "next/link";
import styles from "./cribliv-times.module.css";
import { Masthead } from "./_components/Masthead";
import { formatDate, cityLabel, deskLabel, formatRent } from "./_components/blog-format";
import { fetchBlogList } from "../../../lib/blog-api";
import { fetchApi, buildSearchQuery } from "../../../lib/api";
import { authorPath } from "../../../lib/blog-author";
import { buildOrganization, buildWebSiteSearch, renderJsonLd } from "../../../lib/structured-data";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "hi" }];
}

export async function generateMetadata({
  params
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const hi = params.locale === "hi";
  const title = hi
    ? "Cribliv Times — शहरी भारत के लिए किराया इंटेलिजेंस"
    : "Cribliv Times — Rental Intelligence for Urban India";
  const description = hi
    ? "Cribliv का डेटा डेस्क: लाइव लिस्टिंग से किराया रुझान, इलाके की गाइड और किरायेदार अधिकार।"
    : "Cribliv's data desk: rent trends from live listings, neighbourhood guides, and tenant rights — reported for renters across India.";
  return {
    title,
    description,
    alternates: {
      canonical: `${BASE_URL}/en/blog`,
      languages: { en: `${BASE_URL}/en/blog`, hi: `${BASE_URL}/hi/blog` }
    },
    openGraph: {
      title,
      description,
      url: `${BASE_URL}/${params.locale}/blog`,
      siteName: "Cribliv",
      locale: hi ? "hi_IN" : "en_IN",
      type: "website"
    },
    twitter: { card: "summary", title, description }
  };
}

interface ClassifiedListing {
  id: string;
  title: string;
  city: string;
  locality?: string | null;
  listing_type: "flat_house" | "pg";
  monthly_rent: number;
}

export default async function BlogHubPage({ params }: { params: { locale: string } }) {
  const locale = params.locale;
  const hi = locale === "hi";

  const { items } = await fetchBlogList({ page_size: 12 });

  let listings: ClassifiedListing[] = [];
  try {
    const res = await fetchApi<{ items: ClassifiedListing[] }>(
      `/listings/search?${buildSearchQuery({ page_size: "6", sort: "newest" })}`,
      undefined,
      { server: true }
    );
    listings = res.items.slice(0, 3);
  } catch {
    // classifieds are best-effort; the paper still prints without them
  }

  const lead = items[0] ?? null;
  const railStories = items.slice(1, 4);
  const stripStories = items.slice(4, 7);
  const dateLabel =
    formatDate(lead?.published_at ?? null, locale) || formatDate(new Date().toISOString(), locale);

  return (
    <div className={styles.paper}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: renderJsonLd(buildWebSiteSearch(), buildOrganization())
        }}
      />
      <Masthead locale={locale} activeCategory={null} dateLabel={dateLabel} />

      {!lead ? (
        <p className={styles.empty}>
          {hi
            ? "आज कोई प्रकाशित रिपोर्ट नहीं है। जल्द ही लौटें।"
            : "No published reports yet. The presses are warming up — check back soon."}
        </p>
      ) : (
        <div className={styles.front}>
          <div className={styles.lead}>
            <p className={styles.kicker}>{deskLabel(lead.category_slug, hi)}</p>
            <Link href={`/${locale}/blog/${lead.slug}`} className={styles.leadLink}>
              <h2 className={styles.leadHeadline}>{lead.title}</h2>
            </Link>
            {lead.excerpt ? <p className={styles.dek}>{lead.excerpt}</p> : null}
            <div className={styles.byline}>
              {lead.city_slug ? (
                <span className={styles.dateline}>{cityLabel(lead.city_slug)} — </span>
              ) : null}
              {hi ? "द्वारा " : "By "}
              <Link href={authorPath(locale === "hi" ? "hi" : "en")}>{lead.author}</Link>
              {dateLabel ? ` · ${dateLabel}` : ""}
            </div>
            {lead.hero_image_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.hero} src={lead.hero_image_path} alt={lead.title} />
            ) : null}
            {lead.excerpt ? <p className={styles.excerpt}>{lead.excerpt}</p> : null}
          </div>

          <aside className={styles.rail}>
            <p className={styles.railHead}>{hi ? "और खबरें" : "Also Reported"}</p>
            {railStories.length === 0 ? (
              <p className={styles.railItem} style={{ color: "var(--ink-soft)" }}>
                {hi ? "और रिपोर्ट जल्द ही।" : "More reports soon."}
              </p>
            ) : (
              railStories.map((story) => (
                <div className={styles.railItem} key={story.slug}>
                  <p className={styles.kicker}>{deskLabel(story.category_slug, hi)}</p>
                  <Link href={`/${locale}/blog/${story.slug}`}>
                    <h4>{story.title}</h4>
                  </Link>
                  {story.excerpt ? <p>{story.excerpt}</p> : null}
                </div>
              ))
            )}
          </aside>
        </div>
      )}

      {stripStories.length > 0 ? (
        <>
          <div className={styles.stripRule} />
          <div className={styles.strip}>
            {stripStories.map((story) => (
              <Link
                className={styles.stripItem}
                href={`/${locale}/blog/${story.slug}`}
                key={story.slug}
              >
                <p className={styles.kicker}>{deskLabel(story.category_slug, hi)}</p>
                <h4>{story.title}</h4>
                {story.excerpt ? <p>{story.excerpt}</p> : null}
                <div className={styles.bylineSm}>
                  {hi ? "द्वारा " : "By "}
                  {story.author}
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      {listings.length > 0 ? (
        <section className={styles.classifieds} aria-label="Cribliv Classifieds">
          <div className={styles.classHead}>
            <h3>{hi ? "क्रिबलिव क्लासिफाइड्स" : "Cribliv Classifieds"}</h3>
            <span>{hi ? "सत्यापित लिस्टिंग" : "Verified listings · Updated hourly"}</span>
          </div>
          <div className={styles.ads}>
            {listings.map((listing) => (
              <Link
                className={styles.ad}
                href={`/${locale}/listing/${listing.id}`}
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
      ) : null}

      <div className={styles.colophon}>
        <b>Cribliv Times</b> —{" "}
        {hi
          ? "Cribliv के डेटा डेस्क का एक उत्पाद · हर आँकड़ा लाइव लिस्टिंग से"
          : "a data-desk product of Cribliv · Every figure sourced from live listings"}
      </div>
    </div>
  );
}
