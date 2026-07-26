import { NextResponse } from "next/server";

const BASE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://cribliv.com";

// Hub cities we surface first — mirrors HUB_CITIES in ../sitemap.ts so the two
// stay in step. [slug, display name].
const HUB_CITIES: Array<[string, string]> = [
  ["delhi", "Delhi"],
  ["gurugram", "Gurugram"],
  ["noida", "Noida"],
  ["ghaziabad", "Ghaziabad"],
  ["faridabad", "Faridabad"],
  ["chandigarh", "Chandigarh"],
  ["jaipur", "Jaipur"],
  ["lucknow", "Lucknow"]
];

/**
 * llms.txt — a curated, machine-readable map of the site for LLMs and AI agents
 * (https://llmstxt.org). Complements robots.txt (crawl control) and
 * sitemap_index.xml (full URL inventory) by giving agents a short, high-signal
 * entry point: what Cribliv is, plus links to the surfaces worth grounding on.
 *
 * Served as a route handler (not a static public/ file) so links are built from
 * NEXT_PUBLIC_SITE_URL and the city list can track the sitemap in one place.
 * Unlike robots.txt this is host-agnostic: every link is an absolute canonical
 * cribliv.com URL, so it is safe to serve on preview hosts too.
 */
export const dynamic = "force-static";

export function GET() {
  const u = (path: string) => `${BASE_URL}${path}`;

  const lines: string[] = [
    "# Cribliv",
    "",
    "> Cribliv is an AI-powered rental and PG (paying-guest) discovery platform for Delhi NCR and North India. Every listing shows photos, rent, locality, and verification status up front, so renters find verified homes without brokers or spam.",
    "",
    "Cribliv matches renters to live, verified rental listings using natural-language and voice search in Hindi and English. Owners and PG operators list directly; renters unlock verified owner contact details.",
    "",
    "## Core",
    "",
    `- [Home — AI rental search](${u("/")}): Natural-language and voice search across live, verified rentals in Delhi NCR and North India.`,
    `- [Search rentals](${u("/search")}): Filterable results for flats and houses to rent.`,
    `- [Map search](${u("/map")}): Browse verified rentals on an interactive map.`,
    `- [PG accommodation](${u("/pg")}): Paying-guest listings with rent, meals, and verification details.`,
    "",
    "## Cities",
    "",
    ...HUB_CITIES.map(
      ([slug, name]) =>
        `- [${name} rentals](${u(`/city/${slug}`)}): Verified flats, houses, and PGs to rent in ${name}.`
    ),
    "",
    "## Company",
    "",
    `- [About Cribliv](${u("/about")}): How Cribliv verifies listings and helps renters.`,
    `- [How it works](${u("/how-it-works")}): The journey from search to a verified owner contact.`,
    `- [List your property](${u("/become-owner")}): For owners and PG operators.`,
    `- [Pricing](${u("/pricing")}): Contact-unlock and listing plans.`,
    `- [FAQ](${u("/faq")}): Answers on verification, refunds, and how renting on Cribliv works.`,
    `- [Contact](${u("/contact")})`,
    "",
    "## Blog",
    "",
    `- [Cribliv blog](${u("/blog")}): Rental-market data, local-area guides, and tenancy advice for North India.`,
    "",
    "## Optional",
    "",
    `- [Privacy policy](${u("/privacy")})`,
    `- [Terms of service](${u("/terms")})`,
    "",
    "## Usage",
    "",
    `AI agents may use these pages as grounded, cited inputs (Content-Signal: ai-input=yes). Listing copy and photos may not be used for model training (ai-train=no). See ${u("/robots.txt")}.`,
    ""
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600"
    }
  });
}
