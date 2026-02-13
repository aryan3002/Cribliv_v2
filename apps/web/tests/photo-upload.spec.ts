import { expect, test } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

test.describe("Photo upload flow", () => {
  test.beforeEach(async ({ page, request }) => {
    const session = await loginAsRole(request, "owner");
    await setSessionOnPage(page, session);
  });

  test("photo upload zone is accessible and interactive", async ({ page }) => {
    await page.goto("/en/owner/listings/new");
    await page.getByRole("button", { name: /fill manually/i }).click();

    /* Fill step 1 basics to get past validation */
    await page.getByLabel(/listing title/i).fill("Photo test listing");
    await page.getByLabel(/monthly rent/i).fill("12000");
    await page.getByRole("button", { name: /next/i }).click();

    /* Step 2: Location */
    await page.getByLabel(/city/i).selectOption("noida");
    await page.getByRole("button", { name: /next/i }).click();

    /* Step 3: Details – skip through */
    await page.getByRole("button", { name: /next/i }).click();

    /* Step 4: Photos */
    await expect(page.getByText(/click or drag photos here/i)).toBeVisible();

    /* Upload zone should be keyboard-accessible */
    const uploadZone = page.locator(".upload-zone");
    await expect(uploadZone).toHaveAttribute("role", "button");
    await expect(uploadZone).toHaveAttribute("tabindex", "0");

    /* File input should be hidden but present */
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await expect(fileInput).toBeAttached();
  });

  test("duplicate upload shows appropriate error message", async ({ page }) => {
    await page.goto("/en/owner/listings/new");
    await page.getByRole("button", { name: /fill manually/i }).click();

    /* Navigate to photos step */
    await page.getByLabel(/listing title/i).fill("Duplicate test");
    await page.getByLabel(/monthly rent/i).fill("10000");
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByLabel(/city/i).selectOption("delhi");
    await page.getByRole("button", { name: /next/i }).click();
    await page.getByRole("button", { name: /next/i }).click();

    await expect(page.getByText(/jpg, png up to 10 mb each/i)).toBeVisible();

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    const sampleFile = {
      name: "duplicate-photo.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("fake-image-content"),
      lastModified: 1700000000000
    };

    await fileInput.setInputFiles(sampleFile);
    await page.getByRole("button", { name: /upload all/i }).click();
    await expect(page.getByText(/uploaded/i).first()).toBeVisible();

    await fileInput.setInputFiles(sampleFile);
    await expect(page.getByText(/already uploaded/i)).toBeVisible();
  });
});
