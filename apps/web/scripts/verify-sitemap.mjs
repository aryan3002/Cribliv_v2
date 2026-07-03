#!/usr/bin/env node

const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/+$/, "");
const API_BASE = (process.env.API_BASE || "http://localhost:4000/v1").replace(/\/+$/, "");
const SITEMAP_LIMIT = 50000;
const THIN_LISTING_THRESHOLD = 3;

function fail(message) {
  throw new Error(message);
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    fail(`GET ${url} failed with ${response.status}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    fail(`GET ${url} failed with ${response.status}`);
  }
  return response.json();
}

function xmlDecode(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => xmlDecode(match[1].trim()));
}

function pathFor(url) {
  return new URL(url, BASE).pathname;
}

function assertSitemapIndex(xml) {
  const indexRootCount = [...xml.matchAll(/<sitemapindex(?:\s|>)/g)].length;
  if (indexRootCount !== 1) {
    fail("/sitemap_index.xml is not a sitemapindex document");
  }
  if (/<urlset(?:\s|>)/.test(xml)) {
    fail("/sitemap_index.xml unexpectedly contains a urlset root");
  }
}

function localityPaths(slug) {
  return [`/en/city/lucknow/${slug}`, `/hi/city/lucknow/${slug}`];
}

function hasLocalityPathOrChild(allPaths, slug) {
  return localityPaths(slug).some(
    (rootPath) =>
      allPaths.has(rootPath) || [...allPaths].some((path) => path.startsWith(`${rootPath}/`))
  );
}

async function getLucknowLocalities() {
  const payload = await fetchJson(`${API_BASE}/seo/localities/lucknow`);
  const rows = payload?.data?.items;
  if (!Array.isArray(rows)) {
    fail("GET /v1/seo/localities/lucknow did not return data.items[]");
  }
  return rows.map((row) => ({
    slug: String(row.slug || ""),
    listing_count: Number(row.listing_count || 0)
  }));
}

async function main() {
  const indexXml = await fetchText(`${BASE}/sitemap_index.xml`);
  assertSitemapIndex(indexXml);

  const childSitemaps = extractLocs(indexXml);
  if (childSitemaps.length < 3) {
    fail(`expected at least 3 child sitemaps, found ${childSitemaps.length}`);
  }

  const allPaths = new Set();
  for (const childUrl of childSitemaps) {
    const childPath = pathFor(childUrl);
    const childXml = await fetchText(`${BASE}${childPath}`);
    if (!/<urlset(?:\s|>)/.test(childXml)) {
      fail(`${childPath} is not a urlset document`);
    }

    const locs = extractLocs(childXml);
    if (locs.length > SITEMAP_LIMIT) {
      fail(`${childPath} has ${locs.length} URLs, over the ${SITEMAP_LIMIT} limit`);
    }
    for (const loc of locs) allPaths.add(pathFor(loc));
  }

  const localityRows = await getLucknowLocalities();
  const missingKept = [];
  const presentThin = [];

  for (const locality of localityRows) {
    if (!locality.slug) continue;
    if (locality.listing_count >= THIN_LISTING_THRESHOLD) {
      const missingLocale = localityPaths(locality.slug).some((path) => !allPaths.has(path));
      if (missingLocale) missingKept.push(`${locality.slug} (${locality.listing_count})`);
    } else if (hasLocalityPathOrChild(allPaths, locality.slug)) {
      presentThin.push(`${locality.slug} (${locality.listing_count})`);
    }
  }

  if (missingKept.length > 0) {
    fail(`indexable Lucknow localities missing from sitemap: ${missingKept.join(", ")}`);
  }
  if (presentThin.length > 0) {
    fail(`thin Lucknow localities present in sitemap: ${presentThin.join(", ")}`);
  }

  const keptCount = localityRows.filter(
    (row) => row.listing_count >= THIN_LISTING_THRESHOLD
  ).length;
  const thinCount = localityRows.length - keptCount;

  console.log(`thin excluded: ${thinCount}, kept present: ${keptCount}`);
  console.log(`checked ${childSitemaps.length} sitemap chunks, ${allPaths.size} unique URLs`);
  console.log("SITEMAP VERIFICATION PASSED");
}

main().catch((error) => {
  console.error(`SITEMAP VERIFICATION FAILED: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
