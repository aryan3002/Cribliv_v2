import { test, expect } from "@playwright/test";

/**
 * End-to-end happy path for the rent-agreement v2 wizard (dev mode).
 *
 * Exercises: create draft → walk the wizard with pre-filled valid defaults →
 * mock checkout → backend auto-captures + renders the PDF → download it.
 *
 * SKIPPED: dev-auth is now off — the wizard requires a real OTP login. This
 * spec used the /_dev/bootstrap token shortcut. Re-enable once a Playwright
 * login fixture (or a test-only session cookie) is added.
 */

// Basic plan skips step 6 (signatures): advancing step 5 jumps straight to 7.
const NEXT_STEP: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7 };

test.skip("dev flow: create → wizard → checkout → PDF download", async ({ page }) => {
  // Generous budget — dev-mode route compilation + a full 7-step walk + poll.
  test.setTimeout(180_000);

  // 1. Create a Basic draft (wizard lives under the /en locale prefix).
  await page.goto("/en/rent-agreement/new");
  await page.getByRole("radio", { name: /basic/i }).check();
  await page.getByRole("button", { name: /create draft/i }).click();
  await page.waitForURL(/\/rent-agreement\/[0-9a-f-]+$/i);

  // 2. Enter the wizard at step 1.
  await page.getByRole("link", { name: /^Step 1$/ }).click();
  await page.waitForURL(/\/step\/1$/);

  // 3. Walk steps 1→5 — each form ships pre-filled, schema-valid defaults.
  for (const step of [1, 2, 3, 4, 5]) {
    await page.getByRole("button", { name: "Advance" }).click();
    await page.waitForURL(new RegExp(`/step/${NEXT_STEP[step]}$`));
  }

  // 4. Step 7 (review) — agree to the terms, then advance to checkout.
  await page.getByLabel(/agree to the terms/i).check();
  await page.getByRole("button", { name: "Advance" }).click();
  await page.waitForURL(/\/checkout$/);

  // 5. Mock-pay; the backend auto-captures the payment and renders the PDF.
  await page.getByRole("button", { name: /pay/i }).click();
  await expect(page.getByText(/ready to download/i)).toBeVisible({ timeout: 20_000 });

  // 6. Download the generated PDF. The button opens the PDF in a new tab via
  // window.open — unreliable to observe in headless Chromium — so assert the
  // real signal instead: the /download endpoint returns 200 with a SAS URL.
  const [downloadResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/download") && r.request().method() === "GET"),
    page.getByRole("button", { name: /open pdf/i }).click()
  ]);
  expect(downloadResp.status()).toBe(200);
  const body = await downloadResp.json();
  expect(body.data.sas_url).toMatch(/\/_dev\/pdf-bytes\//);
});
