import { expect, test } from "@playwright/test";

test("search to listing detail shows unlock gate", async ({ page }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: /fast, trustworthy home search/i })).toBeVisible();

  await page.getByRole("textbox", { name: /agentic search/i }).fill("2BHK in gurugram under 35k");
  await page.getByRole("button", { name: /search/i }).click();

  await page.waitForURL(/\/en\/search/);
  const viewDetails = page.getByRole("link", { name: /view details/i }).first();
  await expect(viewDetails).toBeVisible();
  await viewDetails.click();

  await page.waitForURL(/\/en\/listing\//);
  await expect(page.getByText(/unlock contact for 1 credit/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /unlock number/i })).toBeVisible();
});
