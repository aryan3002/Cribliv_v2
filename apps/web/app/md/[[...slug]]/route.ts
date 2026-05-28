import { NextRequest, NextResponse } from "next/server";
import {
  approxTokens,
  cityMarkdown,
  getStaticMarkdown,
  listingMarkdown,
  pgMarkdown
} from "../../../lib/markdown-for-agents";

const LOCALES = ["en", "hi"] as const;

function isLocale(s: string): s is (typeof LOCALES)[number] {
  return (LOCALES as readonly string[]).includes(s);
}

/**
 * Internal markdown rendering route used by the Accept: text/markdown
 * content-negotiation middleware. Not for human navigation, but kept on a
 * public (non-underscore) path so Next's App Router will actually route it
 * — folders prefixed with `_` are excluded from routing.
 *
 * Optional catch-all `[[...slug]]` so a bare `/md` also resolves to home.
 *
 * Slug shapes handled:
 *   /md                 → home (bare)
 *   /md/home            → home
 *   /md/{locale}        → locale home
 *   /md/{locale}/{page} → static page (about, faq, pricing, ...)
 *   /md/{locale}/listing/{id}
 *   /md/{locale}/pg/{id}
 *   /md/{locale}/city/{citySlug}
 */
export async function GET(_req: NextRequest, { params }: { params: { slug?: string[] } }) {
  const parts = params.slug ?? [];
  let locale: "en" | "hi" = "en";
  let rest = parts;
  if (parts.length > 0 && isLocale(parts[0])) {
    locale = parts[0];
    rest = parts.slice(1);
  }

  let body: string | null = null;

  if (rest.length === 0) {
    body = getStaticMarkdown("home");
  } else if (rest.length === 1) {
    body = getStaticMarkdown(rest[0]);
  } else if (rest.length === 2 && rest[0] === "listing") {
    body = await listingMarkdown(rest[1], locale);
  } else if (rest.length === 2 && rest[0] === "pg") {
    body = await pgMarkdown(rest[1], locale);
  } else if (rest.length === 2 && rest[0] === "city") {
    body = cityMarkdown(rest[1], locale);
  }

  if (body == null) {
    body = [
      `# Markdown not available for this route`,
      "",
      `This page does not yet have an agent-friendly markdown rendering.`,
      `Try the JSON API at \`/v1/openapi.json\` or the HTML page directly.`,
      ""
    ].join("\n");
    return new NextResponse(body, {
      status: 406,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "x-markdown-tokens": String(approxTokens(body)),
        Vary: "Accept"
      }
    });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "x-markdown-tokens": String(approxTokens(body)),
      "Cache-Control": "public, max-age=300",
      Vary: "Accept"
    }
  });
}
