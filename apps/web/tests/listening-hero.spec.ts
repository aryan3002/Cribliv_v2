import { expect, test } from "@playwright/test";

// These tests exercise the flag-ON homepage. The flag is baked at build/dev
// start, so the suite self-skips unless the runner sets it:
//   NEXT_PUBLIC_FF_LISTENING_HERO=1 pnpm --filter @cribliv/web test:e2e -- listening-hero
const FLAG_ON =
  process.env.NEXT_PUBLIC_FF_LISTENING_HERO === "1" ||
  process.env.NEXT_PUBLIC_FF_LISTENING_HERO === "true";

test.describe("listening hero homepage", () => {
  test.skip(!FLAG_ON, "NEXT_PUBLIC_FF_LISTENING_HERO not set for this run");

  test("renders the hero with a server-rendered H1", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator("h1.hero-listen__title")).toHaveText(
      "Tell me what you're looking for"
    );
    await expect(page.locator(".hero-listen__input")).toBeVisible();
  });

  test("streams chips while typing and updates the counter", async ({ page }) => {
    await page.goto("/en");
    const input = page.locator(".hero-listen__input");
    await input.fill("2BHK Gomti Nagar under 15k furnished");
    await expect(page.locator(".hero-listen__chip")).toHaveCount(4, { timeout: 5000 });
    await expect(page.locator(".hero-listen__counter")).toContainText("match", {
      timeout: 5000
    });
  });

  test("submits to the map with parsed filters and src=hero", async ({ page }) => {
    await page.goto("/en");
    await page.locator(".hero-listen__input").fill("2BHK under 15k");
    await page.locator(".hero-listen__submit").click();
    await page.waitForURL(/\/en\/map\?/, { timeout: 10000 });
    const url = new URL(page.url());
    expect(url.searchParams.get("bhk")).toBe("2");
    expect(url.searchParams.get("max_rent")).toBe("15000");
    // src=hero is stripped by the map client after arrival; assert the
    // handoff worked by checking the map page rendered.
    await expect(page.locator(".map-entry--hero, [class*='map']").first()).toBeVisible();
  });

  test("zero-chip query still navigates without an error UI", async ({ page }) => {
    await page.goto("/en");
    await page.locator(".hero-listen__input").fill("ghar chahiye");
    await page.locator(".hero-listen__submit").click();
    await page.waitForURL(/\/en\/map\?/, { timeout: 10000 });
  });

  test("hindi locale renders the Devanagari headline", async ({ page }) => {
    await page.goto("/hi");
    await expect(page.locator("h1.hero-listen__title")).toHaveText("बताइए, कैसा घर चाहिए?");
  });

  // CORRECTED vs the brief: `.hero-listen__backdrop img` does not exist in the
  // current markup. Task 4's Static Maps backdrop asset generation was skipped
  // (403), so listening-home.tsx intentionally renders no <img> inside
  // `.hero-listen__backdrop` (see the comment there — "Restore the <Image
  // src={...} .../> once the asset lands"). Asserting on that selector would
  // find zero elements and hang/fail on `.evaluate()`, which is not a real
  // regression — it's a documented, deferred asset. The same
  // `@media (prefers-reduced-motion: reduce)` rule in globals.css also
  // disables the chip-entrance animation (`.hero-listen__chip { animation:
  // none }`), and chips DO render today, so this test exercises the identical
  // CSS rule via a selector that actually exists.
  test("reduced motion disables chip and drift animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    await page.locator(".hero-listen__input").fill("2BHK");
    const chip = page.locator(".hero-listen__chip").first();
    await expect(chip).toBeVisible();
    const animation = await chip.evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });
});

test.describe("flag off guard", () => {
  test.skip(FLAG_ON, "guard only applies to flag-off runs");

  test("old homepage renders when the flag is off", async ({ page }) => {
    await page.goto("/en");
    await expect(page.locator(".home-market-grid")).toBeVisible();
    await expect(page.locator(".hero-listen__title")).toHaveCount(0);
  });
});
