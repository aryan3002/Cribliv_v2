import { test, expect } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "../utils/auth";

test.describe("PG operator dashboard", () => {
  test("renders heading + both widgets (or empty states)", async ({ page, request }) => {
    const session = await loginAsRole(request, "pg_operator");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/dashboard");

    await expect(page.getByRole("heading", { name: /your pg dashboard/i, level: 1 })).toBeVisible();

    // ListingHealthCard renders an <article> per row; if none exist, the section is still
    // present but empty. LeadsInbox always renders, either with leads or with "No leads yet".
    const grid = page.locator(".pg-dashboard-grid");
    await expect(grid).toBeAttached();

    const leadsInbox = page.locator(".pg-leads-inbox");
    await expect(leadsInbox).toBeVisible();
  });

  test("non-pg_operator role is redirected to /pg-operator/become", async ({ page, request }) => {
    const session = await loginAsRole(request, "tenant");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/dashboard");
    // Middleware (or RSC redirect) sends them to /pg-operator/become or /403
    await expect(page).not.toHaveURL(/\/pg-operator\/dashboard$/);
  });
});
