import type { Metadata } from "next";
import Link from "next/link";
import styles from "./cribliv-times.module.css";
import { Masthead } from "./_components/Masthead";
import { formatDate, cityLabel, deskLabel, formatRent } from "./_components/blog-format";
import { fetchBlogList, type BlogListItem } from "../../../lib/blog-api";
import { fetchApi, buildSearchQuery } from "../../../lib/api";
import { authorPath, displayAuthor } from "../../../lib/blog-author";
import { stripBrandSuffix } from "../../../lib/seo";
import { BLOG_DESKS } from "../../../lib/blog-desks";
import { buildOrganization, buildWebSiteSearch } from "../../../lib/structured-data";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

// The Rent Index box is single-city while the catalogue is: nav panels and the
// data desk both cover Lucknow only by design (see nav-model.ts).
const RENT_INDEX_CITY = "lucknow";
const RENT_INDEX_ROWS = 6;
// A median over a couple of listings is noise, not a figure fit to print —
// mirrors DATA_TREND_MIN_LISTINGS on the API's topic planner.
const RENT_INDEX_MIN_LISTINGS = 5;

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
    ? "Cribliv Times: शहरी भारत के लिए किराया इंटेलिजेंस"
    : "Cribliv Times: Rental Intelligence for Urban India";
  const description = hi
    ? "Cribliv का डेटा डेस्क: लाइव लिस्टिंग से किराया रुझान, इलाके की गाइड और किरायेदार अधिकार।"
    : "Cribliv's data desk: rent trends from live listings, neighbourhood guides, and tenant rights, reported for renters across India.";
  return {
    title,
    description,
    // Google Discover requires large image previews to surface a story at all.
    robots: { "max-image-preview": "large" },
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

interface RentIndexRow {
  slug: string;
  name: string;
  listingCount: number;
  metric: "pg" | "2bhk" | "1bhk";
  median: number;
}

interface LocalityListItem {
  slug: string;
  name_en: string;
  listing_count: number;
}

interface LocalityAggregates {
  pg_count: number;
  flat_count: number;
  median_rent_pg: number | null;
  median_rent_1bhk: number | null;
  median_rent_2bhk: number | null;
}

// The paper's "weather box": median rents by locality, straight from the same
// live-listing aggregates the locality SEO pages print. All fetches are
// ISR-cached; any failure degrades to hiding the panel.
async function fetchRentIndex(): Promise<RentIndexRow[]> {
  try {
    const { items } = await fetchApi<{ items: LocalityListItem[] }>(
      `/seo/localities/${RENT_INDEX_CITY}`,
      undefined,
      { revalidate: 3600 }
    );
    const top = items
      .filter((loc) => (loc.listing_count ?? 0) >= RENT_INDEX_MIN_LISTINGS)
      .slice(0, RENT_INDEX_ROWS);
    const rows = await Promise.all(
      top.map(async (loc): Promise<RentIndexRow | null> => {
        const data = await fetchApi<{ aggregates: LocalityAggregates } | null>(
          `/seo/localities/${RENT_INDEX_CITY}/${loc.slug}`,
          undefined,
          { revalidate: 3600 }
        );
        const agg = data?.aggregates;
        if (!agg) return null;
        // Quote whichever market the locality actually is: PG medians where PGs
        // dominate, flat medians otherwise.
        const preferPg = agg.pg_count >= agg.flat_count;
        const candidates: Array<[RentIndexRow["metric"], number | null]> = preferPg
          ? [
              ["pg", agg.median_rent_pg],
              ["2bhk", agg.median_rent_2bhk],
              ["1bhk", agg.median_rent_1bhk]
            ]
          : [
              ["2bhk", agg.median_rent_2bhk],
              ["1bhk", agg.median_rent_1bhk],
              ["pg", agg.median_rent_pg]
            ];
        const found = candidates.find(([, value]) => value != null);
        if (!found || found[1] == null) return null;
        return {
          slug: loc.slug,
          name: loc.name_en,
          listingCount: loc.listing_count,
          metric: found[0],
          median: found[1]
        };
      })
    );
    return rows.filter((row): row is RentIndexRow => row !== null);
  } catch {
    return [];
  }
}

function metricLabel(metric: RentIndexRow["metric"], hi: boolean): string {
  if (metric === "pg") return hi ? "PG माध्यिका" : "PG median";
  if (metric === "2bhk") return hi ? "2BHK माध्यिका" : "2BHK median";
  return hi ? "1BHK माध्यिका" : "1BHK median";
}

export default async function BlogHubPage({ params }: { params: { locale: string } }) {
  const locale = params.locale;
  const hi = locale === "hi";

  // ISR-cached ({ revalidate: 3600 }) so this index stays static — a single
  // no-store fetch would force the whole route into per-request dynamic SSR.
  // 40 stories: enough to fill the lead/rail/strip plus every desk band, so the
  // whole archive is reachable from the front page.
  const { items } = await fetchBlogList({ page_size: 40 }, { revalidate: 3600 });

  let listings: ClassifiedListing[] = [];
  try {
    const res = await fetchApi<{ items: ClassifiedListing[] }>(
      `/listings/search?${buildSearchQuery({ page_size: "6", sort: "newest" })}`,
      undefined,
      { revalidate: 3600 }
    );
    listings = res.items.slice(0, 6);
  } catch {
    // classifieds are best-effort; the paper still prints without them
  }

  const rentIndex = await fetchRentIndex();

  // "Most Read" rail box — first-party reader tallies (POST /blog/:slug/view).
  // Hidden until at least three stories have real readership, so a young paper
  // never prints an embarrassingly thin chart.
  let mostRead: Array<{ slug: string; title: string; views: number }> = [];
  try {
    const res = await fetchApi<{ items: Array<{ slug: string; title: string; views: number }> }>(
      `/blog/most-read?days=7&limit=5`,
      undefined,
      { revalidate: 3600 }
    );
    mostRead = (res.items ?? []).filter((item) => item.views > 0);
    if (mostRead.length < 3) mostRead = [];
  } catch {
    // the paper prints without the chart
  }

  const lead = items[0] ?? null;
  // Six sub-features (three 2-up rows) under the lead: without them the lead
  // column (headline + dek only when there's no hero photo) runs far shorter
  // than the rail and the grid prints a column of blank paper. Slightly
  // overfilling the lead column is deliberate — leftover air then sits under
  // the rail, where a sidebar ending early reads as normal.
  const subLeads = items.slice(1, 7);
  const railStories = items.slice(7, 10);
  const stripStories = items.slice(10, 13);
  // Everything below the fold, grouped by desk so no published story is
  // unreachable from the front page.
  const rest = items.slice(13);
  const deskBands = BLOG_DESKS.map((desk) => ({
    desk,
    stories: rest.filter((story) => story.category_slug === desk.slug).slice(0, 6)
  })).filter((band) => band.stories.length > 0);
  const dateLabel =
    formatDate(lead?.published_at ?? null, locale) || formatDate(new Date().toISOString(), locale);

  const storyDate = (story: BlogListItem) => formatDate(story.published_at, locale);

  return (
    <div className={styles.paper}>
      {[buildWebSiteSearch(), buildOrganization()].map((node, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
        />
      ))}
      <Masthead locale={locale} activeCategory={null} dateLabel={dateLabel} />

      {!lead ? (
        <p className={styles.empty}>
          {hi
            ? "आज कोई प्रकाशित रिपोर्ट नहीं है। जल्द ही लौटें।"
            : "No published reports yet. The presses are warming up. Check back soon."}
        </p>
      ) : (
        <div className={styles.front}>
          <div className={styles.lead}>
            <p className={styles.kicker}>{deskLabel(lead.category_slug, hi)}</p>
            <Link href={`/${locale}/blog/${lead.slug}`} className={styles.leadLink}>
              <h2 className={styles.leadHeadline}>{stripBrandSuffix(lead.title)}</h2>
            </Link>
            {lead.excerpt ? <p className={styles.dek}>{lead.excerpt}</p> : null}
            <div className={styles.byline}>
              {lead.city_slug ? (
                <span className={styles.dateline}>{cityLabel(lead.city_slug)} · </span>
              ) : null}
              {hi ? "द्वारा " : "By "}
              <Link href={authorPath(locale === "hi" ? "hi" : "en")}>
                {displayAuthor(lead.author)}
              </Link>
              {dateLabel ? ` · ${dateLabel}` : ""}
            </div>
            {lead.hero_image_path ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.hero}
                src={lead.hero_image_path}
                alt={stripBrandSuffix(lead.title)}
              />
            ) : null}
            {subLeads.length > 0 ? (
              <div className={styles.subLeads}>
                {subLeads.map((story) => (
                  <Link
                    className={styles.subLead}
                    href={`/${locale}/blog/${story.slug}`}
                    key={story.slug}
                  >
                    <p className={styles.kicker}>{deskLabel(story.category_slug, hi)}</p>
                    <h4>{stripBrandSuffix(story.title)}</h4>
                    {story.excerpt ? <p>{story.excerpt}</p> : null}
                    <div className={styles.bylineSm}>
                      {hi ? "द्वारा " : "By "}
                      {displayAuthor(story.author)}
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          <aside className={styles.rail}>
            {rentIndex.length > 0 ? (
              <div className={styles.numbers}>
                <p className={styles.railHead}>
                  {hi ? "किराया सूचकांक — लखनऊ" : "The Rent Index — Lucknow"}
                </p>
                {rentIndex.map((row) => (
                  <Link
                    key={row.slug}
                    className={styles.numRow}
                    href={`/${locale}/city/${RENT_INDEX_CITY}/${row.slug}`}
                  >
                    <span className={styles.numLabel}>
                      {row.name}
                      <small>
                        {metricLabel(row.metric, hi)} ·{" "}
                        {hi ? `${row.listingCount} लिस्टिंग` : `${row.listingCount} listings`}
                      </small>
                    </span>
                    <p className={styles.numValue}>{formatRent(row.median)}</p>
                  </Link>
                ))}
                <Link className={styles.numMore} href={`/${locale}/city/${RENT_INDEX_CITY}`}>
                  {hi ? "पूरा इलाका डेटा →" : "Full locality data →"}
                </Link>
              </div>
            ) : null}
            {mostRead.length > 0 ? (
              <div className={styles.numbers} style={{ marginBottom: 14 }}>
                <p className={styles.railHead}>
                  {hi ? "इस हफ़्ते सबसे ज़्यादा पढ़ी गईं" : "Most Read This Week"}
                </p>
                {mostRead.map((item, i) => (
                  <Link
                    key={item.slug}
                    className={styles.numRow}
                    href={`/${locale}/blog/${item.slug}`}
                  >
                    <span className={styles.numLabel}>
                      {i + 1}. {stripBrandSuffix(item.title)}
                    </span>
                    <p className={styles.numValue}>{item.views.toLocaleString("en-IN")}</p>
                  </Link>
                ))}
              </div>
            ) : null}
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
                    <h4>{stripBrandSuffix(story.title)}</h4>
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
                <h4>{stripBrandSuffix(story.title)}</h4>
                {story.excerpt ? <p>{story.excerpt}</p> : null}
                <div className={styles.bylineSm}>
                  {hi ? "द्वारा " : "By "}
                  {displayAuthor(story.author)}
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      {deskBands.map(({ desk, stories }) => (
        <section key={desk.slug} aria-label={hi ? desk.hi : desk.en}>
          <div className={styles.bandHead}>
            <h3 className={styles.bandTitle}>{hi ? desk.hi : desk.en}</h3>
            <Link className={styles.bandMore} href={`/${locale}/blog/category/${desk.slug}`}>
              {hi ? "पूरा डेस्क →" : "All reporting →"}
            </Link>
          </div>
          <div className={styles.deskGrid}>
            {stories.map((story) => (
              <Link
                className={styles.deskCard}
                href={`/${locale}/blog/${story.slug}`}
                key={story.slug}
              >
                {story.city_slug ? (
                  <p className={styles.kicker}>{cityLabel(story.city_slug)}</p>
                ) : null}
                <h3>{stripBrandSuffix(story.title)}</h3>
                {story.excerpt ? <p>{story.excerpt}</p> : null}
                <div className={styles.bylineSm}>
                  {hi ? "द्वारा " : "By "}
                  {displayAuthor(story.author)}
                  {storyDate(story) ? ` · ${storyDate(story)}` : ""}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

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
        <b>Cribliv Times</b>,{" "}
        {hi
          ? "Cribliv के डेटा डेस्क का एक उत्पाद · हर आँकड़ा लाइव लिस्टिंग से"
          : "a data-desk product of Cribliv · Every figure sourced from live listings"}
      </div>
    </div>
  );
}
