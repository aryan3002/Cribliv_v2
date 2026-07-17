import { parseBlogEmbeds, type BlogSegment } from "../../lib/blog-embeds";
import { fetchListingCard, fetchPgCard } from "../../lib/blog-embed-cards";
import { ListingCardItem } from "../listing-card";
import { PgListingCard } from "../pg/PgListingCard";

type ListingSeg = Extract<BlogSegment, { type: "listing" }>;
type PgSeg = Extract<BlogSegment, { type: "pg" }>;

// Bound the number of live embeds fetched per post so a pathological body can't
// fan out into hundreds of requests.
const MAX_EMBEDS = 12;

const wrapStyle = { margin: "1.75rem 0", maxWidth: 460 } as const;

/**
 * Server component that renders a prepared blog body, expanding `{{listing:…}}`
 * / `{{pg:…}}` tokens into live, crawlable listing cards interleaved with the
 * article HTML. Card data is fetched server-side (SSR, ISR-cached with the
 * page); an unavailable listing renders nothing so the post never breaks.
 *
 * Only used when the body actually contains embeds — see the caller, which
 * keeps the single-`dangerouslySetInnerHTML` fast path for ordinary posts.
 */
export async function BlogBody({
  html,
  locale
}: {
  html: string;
  locale: string;
  /** Reserved for ?ref=blog-<slug> attribution on embedded card links. */
  slug?: string;
}) {
  const segments = parseBlogEmbeds(html);

  const listingIds = Array.from(
    new Set(segments.filter((s): s is ListingSeg => s.type === "listing").map((s) => s.id))
  ).slice(0, MAX_EMBEDS);
  const pgSegs = Array.from(
    new Map(
      segments.filter((s): s is PgSeg => s.type === "pg").map((s) => [`${s.city}/${s.id}`, s])
    ).values()
  ).slice(0, MAX_EMBEDS);

  const [listingEntries, pgEntries] = await Promise.all([
    Promise.all(listingIds.map(async (id) => [id, await fetchListingCard(id)] as const)),
    Promise.all(
      pgSegs.map(async (s) => [`${s.city}/${s.id}`, await fetchPgCard(s.city, s.id)] as const)
    )
  ]);
  const listingMap = new Map(listingEntries);
  const pgMap = new Map(pgEntries);

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === "html") {
          // display:contents keeps the fragment out of the layout so the
          // article's typography rules still apply to the inner elements.
          return (
            <div
              key={i}
              style={{ display: "contents" }}
              dangerouslySetInnerHTML={{ __html: seg.html }}
            />
          );
        }
        if (seg.type === "listing") {
          const card = listingMap.get(seg.id);
          if (!card) return null;
          return (
            <div key={i} style={wrapStyle} data-blog-embed="listing">
              <ListingCardItem
                listing={card}
                locale={locale}
                heartSlot={<span aria-hidden="true" />}
              />
            </div>
          );
        }
        const card = pgMap.get(`${seg.city}/${seg.id}`);
        if (!card) return null;
        return (
          <div key={i} style={wrapStyle} data-blog-embed="pg">
            <PgListingCard listing={card} locale={locale} />
          </div>
        );
      })}
    </>
  );
}
