import { NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

const DISALLOW = [
  "/api/",
  "/auth/",
  "/en/tenant/",
  "/en/owner/",
  "/en/admin/",
  "/hi/tenant/",
  "/hi/owner/",
  "/hi/admin/"
];

/**
 * robots.txt with Content-Signal directives (contentsignals.org / draft-romm-aipref-contentsignals).
 *
 * Defaults reflect Cribliv's stance:
 *   search=yes      — we want classic search engines to index us
 *   ai-train=no     — listing copy + photos may not be used for model training
 *   ai-input=yes    — AI agents may use our pages as grounded inputs (with citation)
 *
 * Hand-authored as a route handler (not Next's metadata `robots()`) because
 * the metadata API has no first-class support for the Content-Signal directive.
 */
export const dynamic = "force-static";

export function GET() {
  const lines: string[] = [
    "User-Agent: *",
    "Allow: /",
    ...DISALLOW.map((p) => `Disallow: ${p}`),
    "",
    "# Content Signals (https://contentsignals.org)",
    "# search=yes ai-train=no ai-input=yes",
    "Content-Signal: search=yes, ai-train=no, ai-input=yes",
    "",
    `Sitemap: ${BASE_URL}/sitemap_index.xml`,
    ""
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
