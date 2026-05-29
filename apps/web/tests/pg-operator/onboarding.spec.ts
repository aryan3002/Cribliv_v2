import { test, expect } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "../utils/auth";

test.describe("PG operator onboarding routing", () => {
  test("self_serve (≤29 beds) → wizard", async ({ page, request }) => {
    const session = await loginAsRole(request, "pg_operator");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/onboarding");
    await page.getByLabel(/total beds/i).fill("12");
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page).toHaveURL(/\/en\/pg-operator\/listings\/new(\?.*)?$/);
  });

  test("sales_assist (≥30 beds) → /onboarding/lead", async ({ page, request }) => {
    const session = await loginAsRole(request, "pg_operator");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/onboarding");
    await page.getByLabel(/total beds/i).fill("45");
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page).toHaveURL(/\/en\/pg-operator\/onboarding\/lead(\?.*)?$/);
  });

  test("rejects out-of-range bed counts inline", async ({ page, request }) => {
    const session = await loginAsRole(request, "pg_operator");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/onboarding");
    await page.getByLabel(/total beds/i).fill("0");
    await page.getByRole("button", { name: /continue/i }).click();
    await expect(page.getByRole("alert")).toContainText(/1.*500/);
  });
});
