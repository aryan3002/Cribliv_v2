// apps/web/tests/welcome-credits.spec.ts
// Exercises the full NextAuth signup path with a fresh random phone.
// Selectors verified against apps/web/app/[locale]/auth/login/page.tsx:
//   - phone input: id="phone", aria-label "Mobile number" (the only textbox
//     on screen at step 1 — header/footer render no <input> on this route)
//   - "Continue with OTP" button (step 1 -> step 2)
//   - OTP input: id="otp", aria-label "One-time password" (the only textbox
//     once step 2 renders — step 1's phone field unmounts)
//   - "Verify & Sign up" button (tab=signup)
//   - modal CTA text is "Start exploring" (lib/i18n.ts welcomeCta)
import { test, expect } from "@playwright/test";

function randomPhone() {
  return `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

test("new signup sees the welcome-credits celebration exactly once", async ({ page }) => {
  const phone = randomPhone();
  await page.goto("/en/auth/login?tab=signup");
  await expect(page.getByTestId("signup-benefits")).toBeVisible();

  await page.getByRole("textbox").first().fill(phone);
  const [sendRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/auth/otp/send")),
    page.getByRole("button", { name: /send otp|continue/i }).click()
  ]);
  const otp = (await sendRes.json())?.data?.dev_otp as string;
  expect(otp).toBeTruthy();

  await page.getByRole("textbox").last().fill(otp);
  await page.getByRole("button", { name: /verify/i }).click();

  // Hard navigation to the destination page; modal fires there
  await expect(page.getByTestId("welcome-credit-count")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("welcome-credit-count")).toContainText("2", { timeout: 5_000 });

  await page.getByRole("button", { name: /start exploring/i }).click();
  await page.reload();
  await expect(page.getByTestId("welcome-credit-count")).toHaveCount(0);
});
