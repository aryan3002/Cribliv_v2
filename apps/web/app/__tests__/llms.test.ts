import { describe, it, expect } from "vitest";

import { GET } from "../llms.txt/route";

describe("llms.txt", () => {
  it("serves plain text, not the HTML app shell", async () => {
    const res = GET();
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const body = await res.text();
    expect(body).not.toContain("<!DOCTYPE");
    expect(body).not.toContain("<html");
  });

  it("follows the llmstxt.org shape: H1 title then a blockquote summary", async () => {
    const body = await GET().text();
    expect(body.startsWith("# Cribliv")).toBe(true);
    // first non-empty line after the title is a markdown blockquote
    const firstBlock = body.split("\n").find((l) => l.startsWith(">"));
    expect(firstBlock).toBeTruthy();
  });

  it("links the key surfaces as absolute canonical URLs", async () => {
    const body = await GET().text();
    for (const path of ["/", "/search", "/map", "/pg", "/about", "/blog"]) {
      expect(body).toContain(`(https://cribliv.com${path})`);
    }
  });

  it("lists every hub city that the sitemap does", async () => {
    const body = await GET().text();
    for (const slug of [
      "delhi",
      "gurugram",
      "noida",
      "ghaziabad",
      "faridabad",
      "chandigarh",
      "jaipur",
      "lucknow"
    ]) {
      expect(body).toContain(`https://cribliv.com/city/${slug}`);
    }
  });

  it("declares the Content-Signal stance so agents see the robots.txt policy", async () => {
    const body = await GET().text();
    expect(body).toContain("ai-input=yes");
    expect(body).toContain("ai-train=no");
  });
});
