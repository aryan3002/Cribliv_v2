import { readFileSync } from "node:fs";
import { join } from "node:path";

const MD_DIR = join(process.cwd(), "content", "markdown");

/**
 * Coarse token estimate (chars / 4) — fine for advertising content size to
 * agents in `x-markdown-tokens`.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface MarkdownResult {
  body: string;
  contentType: string;
}

function readStaticFile(name: string): string | null {
  try {
    return readFileSync(join(MD_DIR, `${name}.md`), "utf-8");
  } catch {
    return null;
  }
}

/**
 * Map a request slug (already stripped of locale prefix) to a hand-authored
 * markdown file under content/markdown/. Returns null if no static markdown
 * exists for the route.
 */
export function getStaticMarkdown(slug: string): string | null {
  const normalized = slug.replace(/^\/+|\/+$/g, "");
  const map: Record<string, string> = {
    "": "home",
    home: "home",
    about: "about",
    "how-it-works": "how-it-works",
    pricing: "pricing",
    faq: "faq",
    "become-owner": "become-owner",
    contact: "contact",
    privacy: "privacy",
    terms: "terms"
  };
  const file = map[normalized];
  if (!file) return null;
  return readStaticFile(file);
}

/**
 * Generate a deterministic markdown card for a listing. Falls back to a stub
 * if the API fetch fails so we never serve an empty doc.
 */
export async function listingMarkdown(id: string, locale: "en" | "hi"): Promise<string> {
  const apiBase = (
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    process.env.API_BASE_URL ||
    "http://localhost:4000/v1"
  ).replace(/\/+$/, "");
  const url = apiBase.endsWith("/v1")
    ? `${apiBase}/listings/${id}`
    : `${apiBase}/v1/listings/${id}`;
  try {
    const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    const l = payload?.data ?? {};
    return [
      `# ${l.title ?? "Listing"}`,
      "",
      `- **Price**: ₹${l.price_inr ?? "?"}/month`,
      `- **BHK**: ${l.bhk ?? "—"}`,
      `- **Address**: ${l.address ?? "—"}`,
      l.locality_slug ? `- **Locality**: ${l.locality_slug}` : null,
      l.city_slug ? `- **City**: ${l.city_slug}` : null,
      typeof l.verified === "boolean" ? `- **Verified**: ${l.verified ? "yes" : "no"}` : null,
      "",
      l.description ? `${l.description}` : "",
      "",
      `## Photos`,
      "",
      ...(Array.isArray(l.photos) ? l.photos.map((p: string) => `- ${p}`) : ["(none)"]),
      "",
      `## See it on the web`,
      "",
      `- HTML: \`/${locale}/listing/${id}\``,
      `- JSON: \`/v1/listings/${id}\``,
      `- Similar: \`/v1/listings/${id}/similar\``,
      ""
    ]
      .filter((line) => line !== null)
      .join("\n");
  } catch {
    return [
      `# Listing ${id}`,
      "",
      `Could not fetch live data. Try the JSON API directly:`,
      "",
      `\`GET /v1/listings/${id}\``,
      ""
    ].join("\n");
  }
}

export async function pgMarkdown(id: string, locale: "en" | "hi"): Promise<string> {
  return [
    `# PG ${id}`,
    "",
    `Detail for this PG is best fetched live. The HTML page lives at`,
    `\`/${locale}/pg/${id}\` and supports \`Accept: text/markdown\`.`,
    "",
    `For programmatic access, see the \`pg-discovery\` skill at`,
    `\`/.well-known/agent-skills/pg-discovery.md\`.`,
    ""
  ].join("\n");
}

export function cityMarkdown(citySlug: string, locale: "en" | "hi"): string {
  return [
    `# Rentals in ${citySlug.replace(/-/g, " ")}`,
    "",
    `Cribliv covers ${citySlug.replace(/-/g, " ")} with verified listings, owner-direct contact,`,
    `and a 12-hour refund guarantee on bookings.`,
    "",
    `## Useful links`,
    "",
    `- Search: \`/${locale}/search?city=${citySlug}\``,
    `- City hub (HTML): \`/${locale}/city/${citySlug}\``,
    `- Localities: \`/v1/seo/localities/${citySlug}\``,
    `- Listings JSON: \`/v1/listings/search?city=${citySlug}\``,
    ""
  ].join("\n");
}
