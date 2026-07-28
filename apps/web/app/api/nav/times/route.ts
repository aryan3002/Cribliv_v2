import { NextResponse } from "next/server";
import { fetchBlogList } from "../../../../lib/blog-api";

/**
 * Same-origin feed for the Cribliv Times nav panel.
 *
 * Two reasons this is a route handler rather than a direct call from the panel:
 * the header renders in the root layout, so a *server* fetch there would opt
 * every page on the site out of ISR; and the API's browser CORS allowlist does
 * not include cribliv.com, so a direct browser→API call fails in production.
 * The client hits this same-origin handler, which calls the API server-side.
 *
 * A blog outage must never break the header, so every failure path returns 200
 * with an empty list and the panel falls back to desks-only.
 */
export const revalidate = 900;

const MAX_POSTS = 4;

export async function GET() {
  try {
    const res = await fetchBlogList({ page: 1, page_size: MAX_POSTS }, { revalidate });
    const posts = (res?.items ?? [])
      .map((item) => ({
        slug: item.slug ?? "",
        title: item.title ?? "",
        category: item.category_slug ?? null,
        // Everything below is new (the panel used to render bare headlines
        // only): excerpt is the lead story's "dek", publishedAt/author feed
        // its byline. All three are nullable in the upstream BlogListItem
        // shape, so the panel must already tolerate any of them missing.
        excerpt: item.excerpt ?? null,
        publishedAt: item.published_at ?? null,
        author: item.author ?? null
      }))
      .filter((p) => p.slug.length > 0 && p.title.length > 0)
      .slice(0, MAX_POSTS);

    return NextResponse.json(
      { posts },
      {
        headers: { "cache-control": `public, s-maxage=${revalidate}, stale-while-revalidate=3600` }
      }
    );
  } catch {
    return NextResponse.json({ posts: [] }, { status: 200 });
  }
}
