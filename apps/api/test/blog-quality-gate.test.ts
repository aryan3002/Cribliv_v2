import { describe, it, expect } from "vitest";
import {
  countCitedDataPoints,
  countInternalLinks,
  countWords,
  keywordDensity,
  qualityScore
} from "../src/modules/blog/quality-gate";
import type { QualityInput } from "../src/modules/blog/quality-gate";

function goodBody(): string {
  const intro =
    "<h1>2BHK rent in Gomti Nagar</h1>" +
    "<p>The median 2BHK rent in Gomti Nagar is ₹18,000 based on live Cribliv listings. " +
    "This guide breaks down what tenants actually pay across the neighbourhood.</p>";
  const filler =
    "<p>" + "Gomti Nagar offers wide roads, parks and reliable water supply. ".repeat(120) + "</p>";
  const links =
    '<p>See more <a href="/city/lucknow/gomti-nagar">flats in Gomti Nagar</a>, ' +
    '<a href="/rent-in/lucknow">rentals in Lucknow</a>, and ' +
    '<a href="/city/lucknow/metro/gomti-nagar">homes near the metro</a>.</p>';
  const data = "<p>Median 2BHK: ₹18,000. Median 1BHK: ₹11,000. Active listings: 42.</p>";
  return intro + data + filler + links;
}

function goodInput(): QualityInput {
  return {
    title: "2BHK rent in Gomti Nagar - Cribliv",
    h1: "2BHK rent in Gomti Nagar",
    bodyHtml: goodBody(),
    targetKeyword: "2bhk rent gomti nagar",
    faqItems: [{ q: "What is the average 2BHK rent in Gomti Nagar?", a: "About ₹18,000." }],
    sources: [{ label: "Cribliv live listings", asof: "2026-07-01" }],
    isDataPost: true,
    citedDataPointCount: 3,
    uniquenessDistance: 0.42
  };
}

describe("quality-gate helpers", () => {
  it("countWords strips HTML tags", () => {
    expect(countWords("<p>one two three</p>")).toBe(3);
  });

  it("countInternalLinks counts only internal hrefs", () => {
    const html =
      '<a href="/city/lucknow/gomti-nagar">a</a>' +
      '<a href="https://google.com">b</a>' +
      '<a href="/rent-in/lucknow">c</a>' +
      '<a href="#top">d</a>' +
      '<a href="mailto:x@y.com">e</a>';
    expect(countInternalLinks(html)).toBe(2);
  });

  it("countCitedDataPoints counts rupee figures + source-backed numbers", () => {
    const n = countCitedDataPoints("<p>₹18,000 and ₹11,000 and 42 listings</p>", [
      { label: "Cribliv" }
    ]);
    expect(n).toBeGreaterThanOrEqual(3);
  });

  it("keywordDensity is a fraction of total words", () => {
    const d = keywordDensity("rent rent rent other words here now", "rent");
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });
});

describe("qualityScore - good post passes", () => {
  it("passes every check for a solid data post", () => {
    const out = qualityScore(goodInput());
    const failed = out.checks.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toEqual([]);
    expect(out.passed).toBe(true);
    expect(out.score).toBe(1);
  });
});

describe("qualityScore - golden slop set (each must fail)", () => {
  it("fails on hedge/AI phrases", () => {
    const input = goodInput();
    input.bodyHtml = input.bodyHtml.replace(
      "</p>",
      " In conclusion, as an AI language model, it's important to note this. </p>"
    );
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "banned_phrases")?.passed).toBe(false);
  });

  it("fails when too short", () => {
    const input = goodInput();
    input.bodyHtml = "<h1>2BHK rent in Gomti Nagar</h1><p>Too short. ₹18,000.</p>";
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "word_count")?.passed).toBe(false);
  });

  it("fails when internal links are missing", () => {
    const input = goodInput();
    input.bodyHtml = input.bodyHtml
      .replace('href="/city/lucknow/gomti-nagar"', 'href="https://x.com"')
      .replace('href="/rent-in/lucknow"', 'href="https://y.com"')
      .replace('href="/city/lucknow/metro/gomti-nagar"', 'href="https://z.com"');
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "internal_links")?.passed).toBe(false);
  });

  it("fails a data post with too few cited data points", () => {
    const input = goodInput();
    input.citedDataPointCount = 1;
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "data_points")?.passed).toBe(false);
  });

  it("fails when the keyword is absent from the title/H1/first 100 words", () => {
    const input = goodInput();
    input.title = "Some unrelated title - Cribliv";
    input.h1 = "Some unrelated heading";
    input.bodyHtml = input.bodyHtml.replace(/2BHK rent in Gomti Nagar/g, "Homes here");
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "keyword_placement")?.passed).toBe(false);
  });

  it("fails when the keyword is stuffed (density too high)", () => {
    const input = goodInput();
    input.bodyHtml =
      "<h1>2bhk rent gomti nagar</h1><p>" + "2bhk rent gomti nagar ".repeat(80) + "</p>";
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "keyword_stuffing")?.passed).toBe(false);
  });

  it("fails when not unique enough vs the existing corpus", () => {
    const input = goodInput();
    input.uniquenessDistance = 0.08;
    const out = qualityScore(input);
    expect(out.passed).toBe(false);
    expect(out.checks.find((c) => c.id === "uniqueness")?.passed).toBe(false);
  });

  it("treats a null uniqueness distance (empty corpus) as unique", () => {
    const input = goodInput();
    input.uniquenessDistance = null;
    const out = qualityScore(input);
    expect(out.checks.find((c) => c.id === "uniqueness")?.passed).toBe(true);
  });
});
