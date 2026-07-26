import { describe, expect, it } from "vitest";

import { auditPage, extractLocs, samplePaths } from "../seo-audit.mjs";

/**
 * The recurrence guard for the indexability work.
 *
 * `verify-sitemap.mjs` already checks sitemap *composition* (structure, the 50k
 * limit, Lucknow localities) but never fetches a page — which is why it did not
 * catch either headline defect: 21,924 ungated metro URLs, or ~19,000 HTTP-200
 * soft 404s whose bodies were empty.
 *
 * Every defect in the 2026-07-26 spec would have failed one of these four
 * assertions on day one.
 */
const OK_HTML = `
  <html><head>
    <link rel="canonical" href="https://cribliv.com/en/city/lucknow/gomti-nagar"/>
  </head><body><h1>Rent Flats in Gomti Nagar</h1></body></html>`;

const URL_OK = "https://cribliv.com/en/city/lucknow/gomti-nagar";

describe("auditPage", () => {
  it("passes a healthy page", () => {
    expect(auditPage({ url: URL_OK, status: 200, html: OK_HTML })).toMatchObject({
      ok: true,
      problems: []
    });
  });

  it("fails a non-200", () => {
    const v = auditPage({ url: URL_OK, status: 500, html: OK_HTML });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("500");
  });

  it("fails a noindex page — the sitemap must not submit one", () => {
    const html = OK_HTML.replace("<head>", '<head><meta name="robots" content="noindex, follow"/>');
    const v = auditPage({ url: URL_OK, status: 200, html });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("noindex");
  });

  it("fails the soft-404 shape: HTTP 200 with no h1", () => {
    // This is exactly what /en/city/faridabad/metro/kashmere-gate served —
    // 30KB of chrome, zero visible content, status 200.
    const html = `<html><head>
      <link rel="canonical" href="${URL_OK}"/></head><body><div>nav only</div></body></html>`;
    const v = auditPage({ url: URL_OK, status: 200, html });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("h1");
  });

  it("treats a whitespace-only h1 as missing", () => {
    const html = OK_HTML.replace("Rent Flats in Gomti Nagar", "   ");
    expect(auditPage({ url: URL_OK, status: 200, html }).ok).toBe(false);
  });

  it("accepts an h1 containing nested markup", () => {
    const html = OK_HTML.replace(
      "Rent Flats in Gomti Nagar",
      "Rent <span>Flats</span> in Gomti Nagar"
    );
    expect(auditPage({ url: URL_OK, status: 200, html }).ok).toBe(true);
  });

  it("fails a missing canonical", () => {
    const html = OK_HTML.replace(/<link rel="canonical"[^>]*>/, "");
    const v = auditPage({ url: URL_OK, status: 200, html });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("canonical");
  });

  it("fails a canonical pointing at a different page", () => {
    const html = OK_HTML.replace("gomti-nagar", "aliganj");
    const v = auditPage({ url: URL_OK, status: 200, html });
    expect(v.ok).toBe(false);
    expect(v.problems.join(" ")).toContain("canonical");
  });

  it("accepts a hi page canonicalising to its en twin — the codebase's deliberate shape", () => {
    // buildAlternates hardcodes the /en/ path for every locale. Flagging that
    // would make the guard cry wolf on half the surface.
    const hiUrl = URL_OK.replace("/en/", "/hi/");
    expect(auditPage({ url: hiUrl, status: 200, html: OK_HTML }).ok).toBe(true);
  });

  it("still rejects a canonical pointing at a different path in another locale", () => {
    const hiUrl = URL_OK.replace("/en/", "/hi/");
    const html = OK_HTML.replace("gomti-nagar", "aliganj");
    expect(auditPage({ url: hiUrl, status: 200, html }).ok).toBe(false);
  });

  it("tolerates a trailing-slash difference in the canonical", () => {
    const html = OK_HTML.replace(URL_OK, `${URL_OK}/`);
    expect(auditPage({ url: URL_OK, status: 200, html }).ok).toBe(true);
  });

  it("reports every problem at once, not just the first", () => {
    const v = auditPage({ url: URL_OK, status: 404, html: "<html><body></body></html>" });
    expect(v.problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe("extractLocs", () => {
  it("pulls and xml-decodes loc values", () => {
    const xml = "<urlset><url><loc>https://x.test/a?b=1&amp;c=2</loc></url></urlset>";
    expect(extractLocs(xml)).toEqual(["https://x.test/a?b=1&c=2"]);
  });

  it("returns [] for a document with no locs", () => {
    expect(extractLocs("<urlset></urlset>")).toEqual([]);
  });
});

describe("samplePaths", () => {
  it("returns everything when the pool is smaller than the sample size", () => {
    expect(samplePaths(["a", "b"], 5)).toEqual(["a", "b"]);
  });

  it("caps at the requested size", () => {
    expect(samplePaths(["a", "b", "c", "d"], 2)).toHaveLength(2);
  });

  it("spreads the sample across the pool rather than taking a prefix", () => {
    const pool = Array.from({ length: 100 }, (_, i) => `u${i}`);
    const picked = samplePaths(pool, 4);
    // A prefix-only sample would never reach the tail, so a leak confined to the
    // end of a chunk (exactly how the metro URLs were ordered) would be missed.
    expect(picked).toContain("u0");
    expect(picked.some((u: string) => Number(u.slice(1)) > 50)).toBe(true);
  });

  it("is deterministic so a failure can be reproduced", () => {
    const pool = Array.from({ length: 50 }, (_, i) => `u${i}`);
    expect(samplePaths(pool, 7)).toEqual(samplePaths(pool, 7));
  });
});
