import { describe, it, expect } from "vitest";
import { parseBlogEmbeds, insertAtRange } from "../blog-embeds";

const LID = "11111111-2222-4333-8444-555555555555";
const LID2 = "99999999-8888-4777-8666-555544443333";
const PID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("parseBlogEmbeds", () => {
  it("returns an empty array for empty input", () => {
    expect(parseBlogEmbeds("")).toEqual([]);
  });

  it("returns a single html segment when there are no tokens", () => {
    expect(parseBlogEmbeds("<p>hello</p>")).toEqual([{ type: "html", html: "<p>hello</p>" }]);
  });

  it("splits a listing token out of the surrounding html, preserving order", () => {
    const html = `<p>before</p>{{listing:${LID}}}<p>after</p>`;
    expect(parseBlogEmbeds(html)).toEqual([
      { type: "html", html: "<p>before</p>" },
      { type: "listing", id: LID },
      { type: "html", html: "<p>after</p>" }
    ]);
  });

  it("parses a pg token into city + id", () => {
    const html = `x{{pg:lucknow/${PID}}}y`;
    expect(parseBlogEmbeds(html)).toEqual([
      { type: "html", html: "x" },
      { type: "pg", city: "lucknow", id: PID },
      { type: "html", html: "y" }
    ]);
  });

  it("handles multiple and adjacent tokens with no empty html between them", () => {
    const html = `{{listing:${LID}}}{{listing:${LID2}}}`;
    expect(parseBlogEmbeds(html)).toEqual([
      { type: "listing", id: LID },
      { type: "listing", id: LID2 }
    ]);
  });

  it("ignores malformed tokens (non-uuid / missing id) and keeps them as html", () => {
    const html = `<p>{{listing:not-a-uuid}} and {{pg:lucknow}}</p>`;
    expect(parseBlogEmbeds(html)).toEqual([{ type: "html", html }]);
  });

  it("tolerates whitespace inside the braces", () => {
    const html = `{{ listing: ${LID} }}`;
    expect(parseBlogEmbeds(html)).toEqual([{ type: "listing", id: LID }]);
  });

  it("mixes listing and pg tokens", () => {
    const html = `a{{listing:${LID}}}b{{pg:noida/${PID}}}c`;
    expect(parseBlogEmbeds(html)).toEqual([
      { type: "html", html: "a" },
      { type: "listing", id: LID },
      { type: "html", html: "b" },
      { type: "pg", city: "noida", id: PID },
      { type: "html", html: "c" }
    ]);
  });
});

describe("insertAtRange", () => {
  it("inserts at a collapsed caret position", () => {
    expect(insertAtRange("abcd", "X", 2, 2)).toBe("abXcd");
  });

  it("replaces a selected range", () => {
    expect(insertAtRange("abcd", "X", 1, 3)).toBe("aXd");
  });

  it("appends when the caret is at the end", () => {
    expect(insertAtRange("ab", "X", 2, 2)).toBe("abX");
  });

  it("clamps out-of-range positions to the end", () => {
    expect(insertAtRange("ab", "X", 99, 99)).toBe("abX");
  });
});
