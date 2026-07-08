import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

function mediaBlock(query: string) {
  const start = css.indexOf(`@media ${query}`);
  if (start === -1) return "";

  const bodyStart = css.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    if (css[i] === "}") depth -= 1;
    if (depth === 0) {
      return css.slice(bodyStart + 1, i);
    }
  }

  return "";
}

describe("homepage mobile search dropdown styles", () => {
  it("keeps multi-source suggestions usable without rendering the desktop preview pane", () => {
    const mobileBlock = mediaBlock("(max-width: 720px)");

    expect(mobileBlock).toContain(".search-dropdown--with-preview");
    expect(mobileBlock).toContain(".search-dropdown__list");
    expect(mobileBlock).toMatch(/\.search-preview\s*\{[\s\S]*display:\s*none/);
    expect(mobileBlock).toMatch(
      /\.search-dropdown--with-preview\s*\.search-dropdown__list\s*\{[\s\S]*max-height:/
    );
    expect(mobileBlock).toContain("30dvh");
    expect(mobileBlock).toMatch(
      /\.search-dropdown--with-preview\s*\.search-dropdown__list\s*\{[\s\S]*overflow-y:\s*auto/
    );
  });
});
