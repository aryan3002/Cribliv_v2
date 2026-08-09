import { fetchBlogList, type BlogListItem } from "./blog-api";
import { BLOG_DESKS } from "./blog-desks";

// Surfaces CRIBLIV TIMES stories on the programmatic SEO pages (locality hubs
// etc.) so the thousands of indexed money pages feed readers into the paper —
// and the paper's internal links feed authority back. Matching is slug-based:
// the topic planner derives post slugs from locality keywords ("rent trends in
// Alambagh" -> rent-trends-in-alambagh), so a locality's slug appearing as a
// token run inside a post slug is a reliable signal.

/** True when `localitySlug`'s hyphen-tokens appear consecutively in `postSlug`. */
export function slugMentionsLocality(postSlug: string, localitySlug: string): boolean {
  const post = postSlug.split("-");
  const loc = localitySlug.split("-").filter(Boolean);
  if (loc.length === 0) return false;
  for (let i = 0; i + loc.length <= post.length; i++) {
    if (loc.every((token, j) => post[i + j] === token)) return true;
  }
  return false;
}

/**
 * Pure selection: locality-matched stories first (newest first, as returned by
 * the API), then other stories to fill up to `limit` so the box never renders
 * half-empty on localities without dedicated coverage yet.
 */
export function matchTimesStories(
  items: BlogListItem[],
  localitySlug: string,
  limit = 3
): BlogListItem[] {
  const matched = items.filter((item) => slugMentionsLocality(item.slug, localitySlug));
  const rest = items.filter((item) => !slugMentionsLocality(item.slug, localitySlug));
  return [...matched, ...rest].slice(0, limit);
}

export function deskLabelFor(categorySlug: string | null, hi: boolean): string {
  const desk = BLOG_DESKS.find((d) => d.slug === categorySlug);
  if (desk) return hi ? desk.hi : desk.en;
  return hi ? "रिपोर्ट" : "Report";
}

/** Times stories for a locality page: city-scoped fetch, locality-ranked. */
export async function timesStoriesForLocality(
  citySlug: string,
  localitySlug: string,
  opts: { revalidate?: number; limit?: number } = {}
): Promise<BlogListItem[]> {
  const { items } = await fetchBlogList(
    { city: citySlug, page_size: 50 },
    { revalidate: opts.revalidate }
  );
  return matchTimesStories(items, localitySlug, opts.limit ?? 3);
}
