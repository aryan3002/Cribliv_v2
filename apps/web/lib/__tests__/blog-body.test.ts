import { describe, it, expect } from "vitest";
import { localizeBlogBody, stripBodyH1, prepareBlogBody } from "../blog-body";

describe("localizeBlogBody", () => {
  it("prefixes a locale-less internal link to a real route with the active locale (en)", () => {
    // Real broken link captured from production (pgs-in-lucknow post)
    const html = `explore available <a href="/rent-in/lucknow">rentals in Lucknow</a> to find`;
    expect(localizeBlogBody(html, "en")).toBe(
      `explore available <a href="/en/rent-in/lucknow">rentals in Lucknow</a> to find`
    );
  });

  it("prefixes with the hi locale on Hindi pages", () => {
    const html = `<a href="/blog/tenant-maintenance-rights">tenant maintenance rights guide</a>`;
    expect(localizeBlogBody(html, "hi")).toBe(
      `<a href="/hi/blog/tenant-maintenance-rights">tenant maintenance rights guide</a>`
    );
  });

  it("localizes every real content route prefix", () => {
    for (const seg of [
      "city/lucknow/gomti-nagar",
      "pg/delhi",
      "listing/abc-123",
      "search",
      "map"
    ]) {
      const html = `<a href="/${seg}">x</a>`;
      expect(localizeBlogBody(html, "en")).toBe(`<a href="/en/${seg}">x</a>`);
    }
  });

  it("leaves an already-localized link unchanged", () => {
    const html = `<a href="/en/city/delhi">Delhi</a> and <a href="/hi/pg/noida">Noida</a>`;
    expect(localizeBlogBody(html, "en")).toBe(html);
  });

  it("unwraps a link to a non-existent route, keeping the anchor text", () => {
    // Real broken links captured from production (no such route exists)
    const html = `see <a href="/pg-for-girls-in-lucknow">girls PG in Lucknow</a> options`;
    expect(localizeBlogBody(html, "en")).toBe(`see girls PG in Lucknow options`);
  });

  it("unwraps but preserves inner markup for unknown routes", () => {
    const html = `<a href="/pg-in-lucknow"><strong>PG</strong> here</a>`;
    expect(localizeBlogBody(html, "en")).toBe(`<strong>PG</strong> here`);
  });

  it("leaves external and non-path links untouched", () => {
    const external = `<a href="https://example.com">site</a>`;
    const protocolRel = `<a href="//cdn.example.com/x">cdn</a>`;
    const hash = `<a href="#faq">faq</a>`;
    const mailto = `<a href="mailto:hi@cribliv.com">mail</a>`;
    expect(localizeBlogBody(external, "en")).toBe(external);
    expect(localizeBlogBody(protocolRel, "en")).toBe(protocolRel);
    expect(localizeBlogBody(hash, "en")).toBe(hash);
    expect(localizeBlogBody(mailto, "en")).toBe(mailto);
  });

  it("preserves other attributes and href position within the tag", () => {
    const html = `<a class="cta" href="/pg/delhi" target="_self" rel="noopener">PG</a>`;
    expect(localizeBlogBody(html, "en")).toBe(
      `<a class="cta" href="/en/pg/delhi" target="_self" rel="noopener">PG</a>`
    );
  });

  it("preserves query strings and hash fragments", () => {
    const html = `<a href="/rent-in/lucknow?bhk=2#top">2BHK</a>`;
    expect(localizeBlogBody(html, "en")).toBe(`<a href="/en/rent-in/lucknow?bhk=2#top">2BHK</a>`);
  });

  it("localizes a bare root link", () => {
    expect(localizeBlogBody(`<a href="/">home</a>`, "hi")).toBe(`<a href="/hi">home</a>`);
  });

  it("handles multiple links in one body", () => {
    const html = `<p><a href="/rent-in/lucknow">A</a> and <a href="/pg-in-lucknow">B</a> and <a href="/en/blog/x">C</a></p>`;
    expect(localizeBlogBody(html, "en")).toBe(
      `<p><a href="/en/rent-in/lucknow">A</a> and B and <a href="/en/blog/x">C</a></p>`
    );
  });

  it("does not touch <area> or other tags that start with 'a'", () => {
    const html = `<area href="/rent-in/lucknow" alt="x">`;
    expect(localizeBlogBody(html, "en")).toBe(html);
  });

  it("returns empty / falsy input unchanged", () => {
    expect(localizeBlogBody("", "en")).toBe("");
  });
});

describe("stripBodyH1", () => {
  it("removes a leading h1 that duplicates the page title", () => {
    // Real shape captured from production: body starts with the SEO <h1>.
    const html = `<h1>Tenant Rights in India: Essential Protections</h1> <p>Understanding tenant rights...</p>`;
    expect(stripBodyH1(html)).toBe(` <p>Understanding tenant rights...</p>`);
  });

  it("removes an h1 with attributes", () => {
    const html = `<h1 class="x" id="y">Title</h1><p>body</p>`;
    expect(stripBodyH1(html)).toBe(`<p>body</p>`);
  });

  it("removes every h1 so the page-level title is the sole h1", () => {
    const html = `<h1>One</h1><p>a</p><h1>Two</h1><p>b</p>`;
    expect(stripBodyH1(html)).toBe(`<p>a</p><p>b</p>`);
  });

  it("leaves h2 and h3 section headings untouched", () => {
    const html = `<h2>Section</h2><p>a</p><h3>Sub</h3>`;
    expect(stripBodyH1(html)).toBe(html);
  });

  it("returns empty input unchanged", () => {
    expect(stripBodyH1("")).toBe("");
  });
});

describe("prepareBlogBody", () => {
  it("strips the duplicate h1 and localizes internal links in one pass", () => {
    const html = `<h1>Tenant Rights</h1><p>see <a href="/rent-in/lucknow">rentals</a> and <a href="/pg-in-lucknow">pg</a></p>`;
    expect(prepareBlogBody(html, "en")).toBe(
      `<p>see <a href="/en/rent-in/lucknow">rentals</a> and pg</p>`
    );
  });
});
