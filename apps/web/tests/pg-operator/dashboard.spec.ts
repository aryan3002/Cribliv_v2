import { test, expect } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "../utils/auth";

test.describe("PG operator dashboard", () => {
  test("anonymous users can reach the PG operator become gate", async ({ page }) => {
    await page.goto("/en/pg-operator/become");

    await expect(
      page.getByRole("heading", { name: "Sign in to continue", level: 1 })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign In Now" })).toHaveAttribute(
      "href",
      "/en/auth/login?from=/en/pg-operator/become"
    );
  });

  test("anonymous users are redirected away from the PG dashboard", async ({ page }) => {
    await page.goto("/en/pg-operator/dashboard");

    await expect(page).toHaveURL(
      /\/en\/auth\/login\?from=(%2Fen%2Fpg-operator%2Fdashboard|\/en\/pg-operator\/dashboard)$/
    );
  });

  test("uses the main header and dashboard section anchors", async ({ page, request }) => {
    const session = await loginAsRole(request, "pg_operator");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/dashboard");

    await expect(page.getByRole("heading", { name: /your pg dashboard/i, level: 1 })).toBeVisible();
    await expect(page.getByRole("banner").getByLabel(/cribliv home/i)).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Operator" })).toHaveCount(0);

    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.getByRole("link", { name: "Dashboard" })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#overview-section"
    );
    await expect(primary.getByRole("link", { name: "Analytics" })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#analytics-section"
    );
    await expect(primary.getByRole("link", { name: "Listings" })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#listings-section"
    );
    await expect(primary.getByRole("link", { name: "Leads" })).toHaveAttribute(
      "href",
      "/en/pg-operator/dashboard#leads-section"
    );

    for (const id of [
      "overview-section",
      "analytics-section",
      "listings-section",
      "leads-section"
    ]) {
      await expect(page.locator(`#${id}`)).toBeAttached();
    }

    await primary.getByRole("link", { name: "Analytics" }).click();
    await expect(page).toHaveURL(/#analytics-section$/);
    await primary.getByRole("link", { name: "Leads" }).click();
    await expect(page).toHaveURL(/#leads-section$/);
  });

  test("non-pg_operator role is blocked from the PG dashboard", async ({ page, request }) => {
    const session = await loginAsRole(request, "owner");
    await setSessionOnPage(page, session);

    await page.goto("/en/pg-operator/dashboard");
    await expect(page).toHaveURL(/\/403$/);
  });

  test("PG operator pages do not create document overflow on mobile", async ({ page, request }) => {
    const session = await loginAsRole(request, "pg_operator");
    await setSessionOnPage(page, session);
    await page.setViewportSize({ width: 390, height: 820 });

    const paths = [
      "/en/pg-operator/dashboard",
      "/en/pg-operator/become",
      "/en/pg-operator/onboarding",
      "/en/pg-operator/onboarding/lead",
      "/en/pg-operator/listings/new"
    ];

    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator("body")).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${path} should not overflow horizontally`).toBeLessThanOrEqual(1);
    }

    await page.goto("/en/pg-operator/dashboard");
    const listingLink = page.locator('a[href^="/en/pg-operator/listings/"]').first();
    if ((await listingLink.count()) > 0) {
      await listingLink.click();
      await expect(page).toHaveURL(/\/en\/pg-operator\/listings\/[^/]+/);
      const detailOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(detailOverflow, "listing detail should not overflow horizontally").toBeLessThanOrEqual(
        1
      );
    }
  });
});
