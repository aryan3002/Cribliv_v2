// Blog article bodies are LLM-generated HTML stored once per post and served
// under BOTH /en and /hi. The generator emits internal links locale-relative
// (e.g. `/rent-in/lucknow`, `/blog/tenant-rights-guide`) with no `/{locale}`
// segment — but every page in this app lives under `/{locale}/...`, so a raw
// locale-less link 404s. This rewriter runs at render time and injects the
// active locale into internal links that point at real routes, and unwraps
// links whose first path segment is not a real route (LLM hallucinations like
// `/pg-for-girls-in-lucknow`) so we never render a link straight to a 404.

// Every real top-level route segment under `app/[locale]/`. A link whose first
// segment is in this set gets the active locale prefixed; anything else is
// treated as unresolvable and unwrapped to plain text.
const KNOWN_ROUTES = new Set([
  "about",
  "admin",
  "auth",
  "become-owner",
  "blog",
  "city",
  "contact",
  "faq",
  "how-it-works",
  "listing",
  "map",
  "owner",
  "pg",
  "pg-operator",
  "pricing",
  "privacy",
  "rent-agreement",
  "rent-in",
  "search",
  "settings",
  "shortlist",
  "tenant",
  "terms"
]);

const LOCALE_SEGMENTS = new Set(["en", "hi"]);

// Matches a full anchor element. `<a\b` will not match `<area` (no word
// boundary between `a` and `r`). Inner content is non-greedy so it stops at the
// first `</a>`; blog anchors never nest.
const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF_RE = /\shref\s*=\s*(["'])(.*?)\1/i;

function firstSegment(path: string): string {
  return path.replace(/^\//, "").split(/[/?#]/)[0] ?? "";
}

const H1_RE = /<h1\b[^>]*>[\s\S]*?<\/h1>/gi;

/**
 * Remove `<h1>` elements from the article body. The generator embeds the SEO
 * H1 at the top of the body, but the detail page already renders `post.title`
 * as the page-level `<h1>` — leaving both produces two near-duplicate H1s. The
 * page-level title is the canonical H1, so the body should carry none.
 */
export function stripBodyH1(html: string): string {
  if (!html) return html;
  return html.replace(H1_RE, "");
}

/**
 * Localize internal links inside an LLM-generated blog body.
 * @param html the stored article HTML (`body_en` / `body_hi`)
 * @param locale the active locale (`en` | `hi`)
 */
export function localizeBlogBody(html: string, locale: string): string {
  if (!html) return html;

  return html.replace(ANCHOR_RE, (full: string, attrs: string, inner: string) => {
    const hrefMatch = attrs.match(HREF_RE);
    if (!hrefMatch) return full;

    const href = hrefMatch[2].trim();

    // Only touch root-relative internal paths. Leave external (`https://`),
    // protocol-relative (`//host`), hash (`#id`), and scheme (`mailto:`) links.
    if (!href.startsWith("/") || href.startsWith("//")) return full;

    if (href === "/") {
      return `<a${attrs.replace(hrefMatch[0], ` href="/${locale}"`)}>${inner}</a>`;
    }

    const seg = firstSegment(href);

    // Already carries a locale prefix — nothing to do.
    if (LOCALE_SEGMENTS.has(seg)) return full;

    // Real route → inject the active locale.
    if (KNOWN_ROUTES.has(seg)) {
      const rebuilt = attrs.replace(hrefMatch[0], ` href="/${locale}${href}"`);
      return `<a${rebuilt}>${inner}</a>`;
    }

    // Unresolvable route (hallucinated / malformed) → drop the link, keep text.
    return inner;
  });
}

/**
 * Full render-time preparation of a stored blog body: drop the duplicate H1 and
 * localize internal links. Call this before injecting the body into the page.
 */
export function prepareBlogBody(html: string, locale: string): string {
  return localizeBlogBody(stripBodyH1(html), locale);
}
