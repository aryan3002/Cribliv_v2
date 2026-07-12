import { expect, test } from "@playwright/test";

// iOS Safari auto-zooms the viewport in whenever a focused form control has a
// computed font-size below 16px, and the zoom persists after the field blurs.
// On iPhone this reads as "I have to pinch-zoom back out after every search /
// filter tap." Guarantee every focusable control renders at >=16px on mobile
// so WebKit never triggers the zoom. Regression guard for the fix in
// apps/web/app/globals.css (@media max-width: 768px input font-size rule).

const IPHONE_VIEWPORT = { width: 390, height: 844 };

// Controls that never receive a text caret don't trigger the zoom.
const NON_ZOOMING_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "range",
  "file",
  "color"
]);

async function assertNoSubSixteenFields(page: import("@playwright/test").Page) {
  const offenders = await page.evaluate((skip) => {
    const fields = Array.from(
      document.querySelectorAll("input, select, textarea")
    ) as HTMLElement[];
    return fields
      .filter((el) => {
        const type = (el as HTMLInputElement).type;
        return !(type && skip.includes(type));
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type ?? "",
        cls: el.className?.toString?.() ?? "",
        fontSize: parseFloat(getComputedStyle(el).fontSize)
      }))
      .filter((f) => f.fontSize < 16);
  }, Array.from(NON_ZOOMING_TYPES));

  expect(
    offenders,
    `Form controls under 16px trigger iOS Safari auto-zoom: ${JSON.stringify(offenders, null, 2)}`
  ).toEqual([]);
}

test.use({ viewport: IPHONE_VIEWPORT });

test("homepage form controls are >=16px on mobile (no iOS auto-zoom)", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("textbox", { name: /agentic search/i })).toBeVisible();
  await assertNoSubSixteenFields(page);
});

test("search results form controls are >=16px on mobile (no iOS auto-zoom)", async ({ page }) => {
  await page.goto("/en/search?city=gurugram");
  // Search box + filter selects + rent inputs all render on this route.
  await expect(page.locator("input, select").first()).toBeVisible();
  await assertNoSubSixteenFields(page);
});
