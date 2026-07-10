// apps/web/tests/guest-gating.spec.ts
// Run with: NEXT_PUBLIC_FF_GUEST_GATING=true (web) — self-skips otherwise.
import { test, expect } from "@playwright/test";
import { loginWithOtp, setSessionOnPage } from "./utils/auth";

const FLAG_ON =
  process.env.NEXT_PUBLIC_FF_GUEST_GATING === "1" ||
  process.env.NEXT_PUBLIC_FF_GUEST_GATING === "true";

test.describe("guest gating (flag on)", () => {
  test.skip(!FLAG_ON, "NEXT_PUBLIC_FF_GUEST_GATING not set for this run");

  test("guest sees first 6 cards clean, later cards gated with signup CTA", async ({ page }) => {
    await page.goto("/en/search");
    const cards = page.locator(".listing-grid > *");
    const total = await cards.count();
    test.skip(total <= 6, "seed data has too few listings to exercise the gate");
    const gates = page.getByTestId("guest-gate");
    await expect(gates.first()).toBeVisible();
    expect(await gates.count()).toBe(total - 6);
    await expect(gates.first().getByRole("link", { name: "Create free account" })).toBeVisible();
    // SEO: gated card content is still in the served HTML
    const html = await page.content();
    expect(html).toContain("guest-gate");
  });

  test("logged-in tenant sees no gates", async ({ page, request }) => {
    const session = await loginWithOtp(request, "+919999999902");
    await page.goto("/en");
    await setSessionOnPage(page, session);
    await page.goto("/en/search");
    await expect(page.getByTestId("guest-gate")).toHaveCount(0);
  });
});

test.describe("guest gating (flag off guard)", () => {
  test.skip(FLAG_ON, "guard only applies to flag-off runs");
  test("no gates render", async ({ page }) => {
    await page.goto("/en/search");
    await expect(page.getByTestId("guest-gate")).toHaveCount(0);
  });
});
