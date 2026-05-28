import { expect, test } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

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

test("insufficient credits shows buy credits path", async ({ page, request }) => {
  const session = await loginAsRole(request, "tenant");
  await setSessionOnPage(page, session);

  const apiBase = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  const searchResponse = await request.get(`${apiBase}/listings/search`);
  expect(searchResponse.ok()).toBeTruthy();
  const searchPayload = await searchResponse.json();
  const listingId = searchPayload?.data?.items?.[0]?.id as string;
  expect(listingId).toBeTruthy();

  const walletResponse = await request.get(`${apiBase}/wallet`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  });
  expect(walletResponse.ok()).toBeTruthy();
  const walletPayload = await walletResponse.json();
  const currentCredits = Number(walletPayload?.data?.balance_credits ?? 0);

  for (let i = 0; i < currentCredits; i += 1) {
    const drainResponse = await request.post(`${apiBase}/tenant/contact-unlocks`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Idempotency-Key": `drain-owner-credit-${i + 1}`
      },
      data: { listing_id: listingId }
    });
    expect(drainResponse.ok()).toBeTruthy();
  }

  await page.goto(`/en/listing/${listingId}`);
  await page.getByRole("button", { name: /unlock number/i }).click();

  await expect(page.getByTestId("buy-credits-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: /buy credits/i })).toBeVisible();
});
