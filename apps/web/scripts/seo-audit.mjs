#!/usr/bin/env node

/**
 * Page-level guard for the programmatic SEO surface.
 *
 * Samples URLs the sitemap actually submits and asserts each one is genuinely
 * indexable: HTTP 200, not `noindex`, has a non-empty `<h1>`, and carries a
 * self-referential canonical.
 *
 * This is the complement to `verify-sitemap.mjs`, which checks sitemap
 * *composition* (structure, the 50k limit, Lucknow localities) but never fetches
 * a page. That is precisely why it caught neither headline defect of 2026-07-26:
 *
 *   - 21,924 metro + 10,400 landmark URLs submitted with no inventory gate
 *   - ~19,000 of them serving HTTP 200 with an empty body and the title
 *     "Metro station not found" — soft 404s, invisible to a composition check
 *
 * Usage:
 *   BASE=https://cribliv.com SAMPLE=40 node apps/web/scripts/seo-audit.mjs
 *
 * Exits non-zero if any sampled URL fails, so it can gate a deploy.
 */

const BASE = (process.env.BASE || "https://cribliv.com").replace(/\/+$/, "");
const SAMPLE = Math.max(1, Number(process.env.SAMPLE || 40));

export function xmlDecode(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => xmlDecode(m[1].trim()));
}

/**
 * Deterministic, evenly-spread sample.
 *
 * Deliberately not a prefix and not random: a prefix would never reach the tail
 * of a chunk, and the broken metro URLs sat at the end of theirs. Deterministic
 * so a CI failure is reproducible.
 */
export function samplePaths(pool, size) {
  if (pool.length <= size) return [...pool];
  if (size <= 1) return pool.slice(0, size);
  const step = (pool.length - 1) / (size - 1);
  const picked = [];
  for (let i = 0; i < size; i++) {
    const value = pool[Math.round(i * step)];
    if (!picked.includes(value)) picked.push(value);
  }
  return picked;
}

function normaliseUrl(url) {
  return String(url).trim().replace(/\/+$/, "");
}

/**
 * True when two URLs differ only by their leading locale segment.
 *
 * This codebase deliberately canonicalises every locale to its `/en/` twin
 * (`buildAlternates` in lib/seo.ts hardcodes the en path), so a `/hi/` page
 * pointing at `/en/` is the intended shape, not a defect — treating it as one
 * would make this guard cry wolf on half the surface.
 *
 * Worth noting separately: canonicalising `/hi/` away while still SUBMITTING it
 * in the sitemap is contradictory, and is recorded as an open question in the
 * indexability spec rather than silently accepted here.
 */
function samePathIgnoringLocale(a, b) {
  const strip = (u) => normaliseUrl(u).replace(/^(https?:\/\/[^/]+)\/(en|hi)(?=\/|$)/, "$1");
  return strip(a) === strip(b);
}

function firstAttr(html, tagRe, attr) {
  const tag = html.match(tagRe);
  if (!tag) return null;
  const found = tag[0].match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return found ? found[1] : null;
}

/**
 * Pure verdict for one page. Reports EVERY problem rather than short-circuiting,
 * so one run tells you the full story.
 */
export function auditPage({ url, status, html }) {
  const problems = [];

  if (status !== 200) problems.push(`status ${status}`);

  const robotsTags = [...String(html).matchAll(/<meta[^>]+name\s*=\s*["']robots["'][^>]*>/gi)];
  if (robotsTags.some((t) => /noindex/i.test(t[0]))) {
    problems.push("noindex — the sitemap must not submit this");
  }

  const h1 = String(html).match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const h1Text = h1 ? h1[1].replace(/<[^>]*>/g, "").trim() : "";
  if (!h1Text) problems.push("no non-empty <h1> (soft-404 shape)");

  const canonical = firstAttr(html, /<link[^>]+rel\s*=\s*["']canonical["'][^>]*>/i, "href");
  if (!canonical) {
    problems.push("canonical missing");
  } else if (!samePathIgnoringLocale(canonical, url)) {
    problems.push(`canonical points elsewhere (${canonical})`);
  }

  return { url, ok: problems.length === 0, problems };
}

async function fetchText(url) {
  const res = await fetch(url);
  return { status: res.status, html: await res.text() };
}

async function main() {
  const index = await fetchText(`${BASE}/sitemap_index.xml`);
  if (index.status !== 200) throw new Error(`sitemap_index.xml returned ${index.status}`);

  const children = extractLocs(index.html);
  if (children.length === 0) throw new Error("sitemap index listed no child sitemaps");

  const urls = [];
  for (const child of children) {
    const path = new URL(child, BASE).pathname;
    const chunk = await fetchText(`${BASE}${path}`);
    if (chunk.status !== 200) throw new Error(`${path} returned ${chunk.status}`);
    urls.push(...extractLocs(chunk.html));
  }
  if (urls.length === 0) throw new Error("no URLs found across any sitemap chunk");

  const picked = samplePaths(urls, SAMPLE);
  const verdicts = [];
  for (const url of picked) {
    const path = new URL(url, BASE).pathname;
    const page = await fetchText(`${BASE}${path}`);
    verdicts.push(auditPage({ url, status: page.status, html: page.html }));
  }

  const failed = verdicts.filter((v) => !v.ok);
  for (const v of failed) {
    console.error(`FAIL ${new URL(v.url, BASE).pathname}`);
    for (const p of v.problems) console.error(`       - ${p}`);
  }

  console.log(
    `sampled ${picked.length} of ${urls.length} submitted URLs across ${children.length} chunks`
  );
  if (failed.length > 0) {
    throw new Error(`${failed.length} of ${picked.length} sampled URLs are not indexable`);
  }
  console.log("SEO AUDIT PASSED");
}

// Only run the CLI when invoked directly, so tests can import the pure helpers.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`SEO AUDIT FAILED: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
