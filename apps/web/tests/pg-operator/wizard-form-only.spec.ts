import { test, expect } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "../utils/auth";

test.describe("PG listing wizard — form-only happy path (no voice)", () => {
  test("6-step wizard publishes a listing", async ({ page, request }) => {
    const session = await loginAsRole(request, "pg_operator");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/listings/new");

    // Step 1 — Property & Identity
    await page.getByLabel(/property name/i).fill("Acme PG");
    await page.getByLabel(/^city$/i).fill("bangalore");
    await page.getByLabel(/total beds/i).fill("12");
    await page.getByRole("button", { name: /^boys$/i }).click();
    await page.getByRole("button", { name: /^students$/i }).click();
    await page.getByRole("button", { name: /^double$/i }).click();
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 2 — Rooms & Pricing matrix (one row of double non-AC)
    await page.getByLabel(/rent double non-ac/i).fill("8500"); // ₹8,500 → 850,000 paise
    await page.getByLabel(/vacancy double non-ac/i).fill("4");
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 3 — Payment (minimum: 1 field then advance)
    await page.getByLabel(/notice period/i).fill("30");
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 4 — Rules (toggle smoking off-by-default check; no required fields)
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 5 — Amenities & Food (toggle wifi)
    await page.getByLabel(/^wifi$/i).check();
    await page.getByRole("button", { name: /^next$/i }).click();

    // Step 6 — Publish
    const publish = page.getByRole("button", { name: /publish/i });
    await expect(publish).toBeEnabled();
    await publish.click();
    await expect(page).toHaveURL(/\/en\/pg-operator\/dashboard(\?createdListingId=.*)?$/, {
      timeout: 10_000
    });
  });
});
