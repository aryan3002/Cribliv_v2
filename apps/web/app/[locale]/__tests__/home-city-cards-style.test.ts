import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function cssBlock(selector: string) {
  const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  const bodyStart = css.indexOf("{", start) + 1;
  const bodyEnd = css.indexOf("\n}", bodyStart);
  return css.slice(bodyStart, bodyEnd);
}

describe("homepage city card map styling", () => {
  it("keeps the map image visible through the paper overlay", () => {
    const mapBlock = cssBlock(".home-city-card__map");
    const overlayBlock = cssBlock(".home-city-card__art::after");
    const opacity = Number(mapBlock.match(/opacity:\s*([0-9.]+)/)?.[1] ?? 0);

    expect(opacity).toBeGreaterThanOrEqual(0.5);
    expect(mapBlock).not.toContain("saturate(0.2)");
    expect(overlayBlock).not.toContain("rgba(255, 255, 255, 0.9)");
  });
});
