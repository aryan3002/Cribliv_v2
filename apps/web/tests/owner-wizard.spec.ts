import { expect, test } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

test.describe("Owner listing wizard happy path", () => {
  test.beforeEach(async ({ page, request }) => {
    const session = await loginAsRole(request, "owner");
    await setSessionOnPage(page, session);
  });

  test("wizard navigates through all steps with validation", async ({ page }) => {
    await page.goto("/en/owner/listings/new");
    await page.getByRole("button", { name: /fill manually/i }).click();

    /* Step indicator is visible */
    await expect(page.getByRole("navigation", { name: /wizard progress/i })).toBeVisible();

    /* Step 1: Basics – required fields prevent advancing */
    await expect(page.getByLabel(/listing title/i)).toBeVisible();
    await expect(page.getByLabel(/monthly rent/i)).toBeVisible();

    /* Next should be disabled without required fields */
    const nextBtn = page.getByRole("button", { name: /next/i });
    await expect(nextBtn).toBeDisabled();

    /* Fill required basics */
    await page.getByLabel(/listing title/i).fill("Test 2BHK Sector 62");
    await page.getByLabel(/monthly rent/i).fill("18000");

    /* Next should now be enabled */
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    /* Step 2: Location */
    await expect(page.getByLabel(/city/i)).toBeVisible();
    await page.getByLabel(/city/i).selectOption("noida");
    await page.getByRole("button", { name: /next/i }).click();

    /* Step 3: Details */
    await expect(page.getByLabel(/bedrooms/i)).toBeVisible();
    await page.getByLabel(/bedrooms/i).fill("2");
    await page.getByLabel(/bathrooms/i).fill("1");
    await page.getByRole("button", { name: /next/i }).click();

    /* Step 4: Photos */
    await expect(page.getByText(/add photos of your property/i)).toBeVisible();
    await expect(page.getByText(/click or drag photos here/i)).toBeVisible();
    await page.getByRole("button", { name: /next/i }).click();

    /* Step 5: Review */
    await expect(page.getByText(/review your listing details/i)).toBeVisible();
    await expect(page.getByText("Test 2BHK Sector 62")).toBeVisible();
    await expect(page.getByText(/18,000/)).toBeVisible();
    await expect(page.getByRole("button", { name: /submit for review/i })).toBeVisible();
  });

  test("PG segmentation shows correct banner", async ({ page }) => {
    await page.goto("/en/owner/listings/new");
    await page.getByRole("button", { name: /fill manually/i }).click();

    /* Select PG type */
    await page.getByLabel(/listing title/i).fill("PG in Gurugram");
    await page.getByLabel(/property type/i).selectOption("pg");
    await page.getByLabel(/monthly rent/i).fill("8000");

    /* Fill step 1, navigate to step 2, then step 3 */
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByLabel(/city/i).selectOption("gurugram");
    await page.getByRole("button", { name: /next/i }).click();

    /* Step 3: PG details with <30 beds shows self-serve */
    await expect(page.getByLabel(/total beds/i)).toBeVisible();
    await page.getByLabel(/total beds/i).fill("15");
    await expect(page.getByText(/you can manage your listing yourself/i)).toBeVisible();

    /* Change to >=30 beds shows sales-assist */
    await page.getByLabel(/total beds/i).fill("50");
    await expect(page.getByText(/our team will help you/i)).toBeVisible();
  });
});
