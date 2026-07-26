export interface TimesPost {
  slug: string;
  title: string;
  category: string | null;
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
