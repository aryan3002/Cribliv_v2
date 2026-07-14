import { expect, test, type Page } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

async function goNext(page: Page) {
  await page.getByRole("button", { name: /^next$/i }).click();
}

test.describe("Owner listing wizard happy path", () => {
  test.beforeEach(async ({ page, request }) => {
    const session = await loginAsRole(request, "owner");
    await setSessionOnPage(page, session);
  });

  test("wizard navigates through all steps with validation", async ({ page }) => {
    await page.goto("/en/owner/listings/new");

    /* Step indicator is visible */
    await expect(page.getByRole("navigation", { name: /listing progress/i })).toBeVisible();

    /* Step 1: Basics - required fields prevent advancing */
    await expect(page.getByRole("spinbutton", { name: /monthly rent/i })).toBeVisible();

    await goNext(page);
    await expect(page.getByText(/rent is required/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /property basics/i })).toBeVisible();

    /* Fill required basics */
    await page.getByRole("spinbutton", { name: /monthly rent/i }).fill("18000");
    await page.getByRole("spinbutton", { name: /security deposit/i }).fill("36000");

    await goNext(page);

    /* Step 2: Location */
    await expect(page.getByRole("combobox", { name: /city/i })).toBeVisible();
    await page.getByRole("combobox", { name: /city/i }).selectOption("noida");
    await page.getByRole("textbox", { name: /locality/i }).fill("Sector 62");
    await page.getByRole("textbox", { name: /pincode/i }).fill("201301");
    await goNext(page);

    /* Step 3: Details */
    await expect(page.getByRole("spinbutton", { name: /bedrooms/i })).toBeVisible();
    await page.getByRole("spinbutton", { name: /bedrooms/i }).fill("2");
    await page.getByRole("spinbutton", { name: /bathrooms/i }).fill("1");
    await page.getByRole("spinbutton", { name: /carpet area/i }).fill("850");
    await goNext(page);

    /* Step 4: Title & description */
    await expect(page.getByRole("heading", { name: /title & description/i })).toBeVisible();
    await page.getByRole("textbox", { name: /^title$/i }).fill("Test 2BHK Sector 62");
    await page
      .getByRole("textbox", { name: /description/i })
      .fill("A bright two bedroom flat near the metro.");
    await goNext(page);

    /* Step 5: Photos */
    await expect(page.getByRole("heading", { name: /add photos/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /upload photos/i })).toBeVisible();
    await goNext(page);

    /* Step 6: Review */
    await expect(page.getByRole("heading", { name: /review your listing/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Test 2BHK Sector 62" })).toBeVisible();
    await expect(page.locator(".cz-review__rent")).toContainText("18,000");
    await expect(page.getByRole("button", { name: /submit for review/i })).toBeVisible();
  });

  test("PG segmentation shows correct banner", async ({ page }) => {
    await page.goto("/en/owner/listings/new");

    /* Select PG type */
    await page.getByRole("combobox", { name: /^property$/i }).selectOption("pg");
    await page.getByRole("spinbutton", { name: /monthly rent/i }).fill("8000");

    /* Fill step 1, navigate to step 2, then step 3 */
    await goNext(page);
    await page.getByRole("combobox", { name: /city/i }).selectOption("gurugram");
    await goNext(page);

    /* Step 3: PG details with <30 beds shows self-serve */
    await expect(page.getByRole("spinbutton", { name: /total beds/i })).toBeVisible();
    await page.getByRole("spinbutton", { name: /total beds/i }).fill("15");
    await expect(page.getByText(/with 15 beds.*manage this listing yourself/i)).toBeVisible();

    /* Change to >=30 beds shows sales-assist */
    await page.getByRole("spinbutton", { name: /total beds/i }).fill("50");
    await expect(page.getByText(/our team will reach out/i)).toBeVisible();
  });
});
