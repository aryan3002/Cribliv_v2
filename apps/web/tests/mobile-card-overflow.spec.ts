import { expect, test } from "@playwright/test";

// A single-column listing grid must use `minmax(0, 1fr)`, never bare `1fr`
// (which resolves to `minmax(auto, 1fr)`). With bare `1fr`, a grid item whose
// min-content is wider than the viewport — a long non-wrapping title, a
// guest-gate overlay, a real cover photo — forces the single track past its
// container. `.tenant-results-page` then clips the overflow (overflow-x: clip),
// so the right edge of every card is cut off; and because it's clipped rather
// than scrolled, pinch-zoom can't reveal it ("cut from the side, and zooming
// out doesn't fix it"). Regression guard for the minmax(0,1fr) fix in
// apps/web/app/globals.css. Only reproduces with real content, so we force the
// worst case deterministically with a wide, non-wrapping probe child.

const IPHONE_VIEWPORT = { width: 393, height: 852 };

test.use({ viewport: IPHONE_VIEWPORT });

test("listing-grid track never exceeds its container on mobile", async ({ page }) => {
  await page.goto("/en/search?city=gurugram");

  const grid = page.locator(".listing-grid").first();
  await expect(grid).toBeVisible();

  const result = await page.evaluate(() => {
    const el = document.querySelector(".listing-grid") as HTMLElement | null;
    if (!el) return null;
    const containerWidth = el.getBoundingClientRect().width;
    // Deterministic worst case: a wide, non-wrapping child drives the track's
    // min-content. minmax(0,1fr) clamps the track to the container; bare 1fr
    // would balloon it to fit the child.
    const probe = document.createElement("div");
    probe.style.whiteSpace = "nowrap";
    probe.textContent = "X".repeat(160);
    el.appendChild(probe);
    el.getBoundingClientRect(); // force reflow
    const firstTrack = parseFloat(getComputedStyle(el).gridTemplateColumns.split(" ")[0]);
    probe.remove();
    return { containerWidth, firstTrack };
  });

  expect(result).not.toBeNull();
  // 2px tolerance for sub-pixel rounding. Bare 1fr would report ~1200px here.
  expect(result!.firstTrack).toBeLessThanOrEqual(result!.containerWidth + 2);
});
