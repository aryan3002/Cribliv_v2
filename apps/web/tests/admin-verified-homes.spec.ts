import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

test("admin can inspect a verified home and open its public page and leads", async ({
  page,
  request
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const admin = await loginAsRole(request, "admin");
  await setSessionOnPage(page, admin);

  await page.goto("/en/admin");
  const adminNav = page.getByRole("navigation", { name: /admin navigation/i });
  await expect(adminNav).toBeVisible();

  await adminNav.getByRole("button", { name: "Verified Homes" }).click();
  await expect(page.getByRole("heading", { name: "Verified Homes" })).toBeVisible();

  const screenshotDir = path.resolve(process.cwd(), "../../output/playwright/admin-verified-homes");
  await mkdir(screenshotDir, { recursive: true });
  const viewports = [
    { name: "desktop", width: 1440, height: 1000 },
    { name: "tablet", width: 900, height: 1100 },
    { name: "mobile", width: 390, height: 844 }
  ] as const;

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    if (viewport.name === "mobile") {
      await page.getByLabel("Admin section").selectOption("overview");
      await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
      await page.getByLabel("Admin section").selectOption("homes");
      await expect(page.getByRole("heading", { name: "Verified Homes" })).toBeVisible();
    }
    await expect(page.locator("[data-admin-home-row]").first()).toBeVisible();
    const documentFits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
    );
    expect(documentFits).toBeTruthy();
    await page.screenshot({
      path: path.join(screenshotDir, `${viewport.name}-inventory.png`),
      fullPage: true
    });

    await page
      .getByRole("button", { name: /open .* workspace/i })
      .first()
      .click();
    await expect(page.getByRole("button", { name: "Copy public URL" })).toBeVisible();
    await expect(page.locator(".admin-home-workspace__tab")).toHaveCount(6);

    const actionRects = await page
      .locator(".admin-home-workspace__header-actions")
      .evaluate((node) => {
        return Array.from(node.querySelectorAll("button")).map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height
          };
        });
      });
    for (const rect of actionRects) {
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width);
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThanOrEqual(viewport.width <= 760 ? 44 : 32);
    }

    await page.screenshot({
      path: path.join(screenshotDir, `${viewport.name}-workspace.png`),
      fullPage: true
    });
    await page.getByRole("button", { name: "Back to verified homes" }).click();
    await expect(page.getByRole("heading", { name: "Verified Homes" })).toBeVisible();
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("button", { name: /open .* workspace/i })
    .first()
    .click();
  await expect(page.getByRole("button", { name: "Copy public URL" })).toBeVisible();
  await page.getByRole("button", { name: "Copy public URL" }).click();
  await expect(page.getByRole("status")).toContainText("Public URL copied");

  const [publicPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Open public page" }).click()
  ]);
  await expect(publicPage).toHaveURL(/\/en\/listing\/[0-9a-f-]+$/);
  await publicPage.close();

  await page.getByRole("button", { name: "Verification", exact: true }).click();
  await expect(page.getByText("No verification attempts")).toBeVisible();

  await page.getByRole("button", { name: "Leads" }).click();
  await page.getByRole("button", { name: "Manage in Lead Center" }).click();
  await expect(page.getByRole("heading", { name: "Lead Center" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear listing filter" })).toBeVisible();
  const featureConsoleErrors = consoleErrors.filter(
    (message) => !message.includes("https://va.vercel-scripts.com/v1/script.debug.js")
  );
  expect(featureConsoleErrors).toEqual([]);
});
