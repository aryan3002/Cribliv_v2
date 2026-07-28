export interface TimesPost {
  slug: string;
  title: string;
  category: string | null;
  // Added so the panel can render a real lead story (kicker + headline + dek
  // + byline) instead of a bare headline. Optional — not required — so older
  // fixtures/mocks that only ever set slug/title/category (this file's own
  // test, times-panel.test.tsx's original suite) keep compiling; the route
  // handler always sends all three now, defaulting missing upstream data to
  // null (see apps/web/app/api/nav/times/route.ts).
  excerpt?: string | null;
  publishedAt?: string | null;
  author?: string | null;
}

let inflight: Promise<TimesPost[]> | null = null;

/**
 * Loads the Times panel's latest posts, once per session.
 *
 * Deliberately client-side: the header renders in the root layout, so a server
 * fetch here would opt the entire site out of ISR. Same-origin so it is not
 * subject to the API's browser CORS allowlist. Every failure resolves to an
 * empty list — the panel degrades to desks-only rather than breaking.
 */
export function loadTimesPosts(): Promise<TimesPost[]> {
  if (inflight) return inflight;
  inflight = fetch("/api/nav/times")
    .then((r) => (r.ok ? r.json() : { posts: [] }))
    .then((body) => (Array.isArray(body?.posts) ? (body.posts as TimesPost[]) : []))
    .catch(() => []);
  return inflight;
}

export function __resetTimesPostsForTests(): void {
  inflight = null;
}
