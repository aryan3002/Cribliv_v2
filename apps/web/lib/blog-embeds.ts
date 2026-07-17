// Blog authors can embed live property/PG cards anywhere in a post body using
// tokens: `{{listing:<uuid>}}` and `{{pg:<citySlug>/<uuid>}}`. The tokens are
// stored literally in the HTML body (body_en / body_hi) and expanded at render
// time into SSR, crawlable listing cards. This module is the pure parser that
// splits a body into an ordered list of html / listing / pg segments; the
// rendering + data-fetching lives in the BlogBody server component.

export type BlogSegment =
  | { type: "html"; html: string }
  | { type: "listing"; id: string }
  | { type: "pg"; city: string; id: string };

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

// `{{listing:<uuid>}}` or `{{pg:<citySlug>/<uuid>}}`, tolerant of surrounding
// whitespace inside the braces. Anything that doesn't match this exact shape
// (e.g. a non-uuid id, or a pg token without an id) is left untouched as html.
const EMBED_SOURCE = `\\{\\{\\s*(?:listing:\\s*(${UUID})|pg:\\s*([a-z0-9-]+)\\/\\s*(${UUID}))\\s*\\}\\}`;

/**
 * Split blog body HTML into ordered segments around embed tokens. Non-token
 * text stays as `html` segments; valid tokens become `listing` / `pg` segments.
 * Adjacent tokens produce no empty html segment between them.
 */
export function parseBlogEmbeds(html: string): BlogSegment[] {
  if (!html) return [];
  const re = new RegExp(EMBED_SOURCE, "gi");
  const segments: BlogSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(html)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "html", html: html.slice(lastIndex, match.index) });
    }
    const [, listingId, pgCity, pgId] = match;
    if (listingId) {
      segments.push({ type: "listing", id: listingId });
    } else if (pgCity && pgId) {
      segments.push({ type: "pg", city: pgCity, id: pgId });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < html.length) {
    segments.push({ type: "html", html: html.slice(lastIndex) });
  }
  return segments;
}

/** True if a body contains at least one valid embed token. */
export function hasBlogEmbeds(html: string): boolean {
  if (!html) return false;
  return new RegExp(EMBED_SOURCE, "i").test(html);
}

/**
 * Splice `insert` into `text`, replacing the [start, end) range (a collapsed
 * caret when start === end). Positions are clamped into bounds. Used to insert
 * an embed token at the editor's caret.
 */
export function insertAtRange(text: string, insert: string, start: number, end: number): string {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return text.slice(0, s) + insert + text.slice(e);
}
