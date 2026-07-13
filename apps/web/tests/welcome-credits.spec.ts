// apps/web/tests/welcome-credits.spec.ts
// Exercises the full NextAuth signup path with a fresh random phone.
// Selectors verified against apps/web/app/[locale]/auth/login/page.tsx:
//   - phone input: id="phone", aria-label "Mobile number" (the only textbox
//     on screen at step 1 — header/footer render no <input> on this route)
//   - "Continue with OTP" button (step 1 -> step 2)
//   - OTP input: id="otp", aria-label "One-time password" (the only textbox
//     once step 2 renders — step 1's phone field unmounts)
//   - "Verify & Sign up" button (tab=signup)
//   - modal CTA text is "Start finding homes" (lib/i18n.ts welcomeRewardCta)
import { test, expect, type Page } from "@playwright/test";

// Retry the flake characterized in task-s2-9-report.md: a pre-existing
// NextAuth v5 MissingCSRF race where getSession() can lose to the cookie
// write right after signIn(), surfacing as "Something went wrong" on the
// login page before this spec's own assertions ever run.
test.describe.configure({ retries: 2 });

function randomPhone() {
  return `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

interface SessionSnapshot {
  accessToken?: string;
  signupReward?: {
    creditsGranted: number;
    expiresAt: string | null;
  };
  promotionalCredits?: {
    remaining: number;
    expiresAt: string | null;
  };
}

interface WalletSnapshot {
  balance_credits: number;
  free_credits_granted: number;
  promotional_credits_remaining: number;
  promotional_credits_expires_at: string | null;
}

function apiBaseUrl() {
  return (process.env.E2E_API_BASE_URL || "http://localhost:4000/v1").replace(/\/+$/, "");
}

function webBaseUrl() {
  return (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

function formatUtcDate(expiresAt: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(expiresAt));
}

async function completeSignup(page: Page) {
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
  const verificationStartedAt = Date.now();
  await page.getByRole("button", { name: /verify/i }).click();

  // Hard navigation to the destination page; modal fires there
  await expect(page.getByTestId("welcome-credit-count")).toBeVisible({ timeout: 20_000 });
  const verificationFinishedAt = Date.now();

  return { verificationStartedAt, verificationFinishedAt };
}

async function readSignupSnapshots(page: Page) {
  const sessionResponse = await page.context().request.get(`${webBaseUrl()}/api/auth/session`);
  expect(sessionResponse.ok()).toBeTruthy();
  const session = (await sessionResponse.json()) as SessionSnapshot;
  expect(session.accessToken).toBeTruthy();

  const walletResponse = await page.context().request.get(`${apiBaseUrl()}/wallet`, {
    headers: { Authorization: `Bearer ${session.accessToken}` }
  });
  expect(walletResponse.ok()).toBeTruthy();
  const walletPayload = (await walletResponse.json()) as { data: WalletSnapshot };

  return { session, wallet: walletPayload.data };
}

test("new signup receives 10 expiring credits and sees the celebration exactly once", async ({
  page
}) => {
  const { verificationStartedAt, verificationFinishedAt } = await completeSignup(page);
  const { session, wallet } = await readSignupSnapshots(page);

  await expect(page.getByTestId("welcome-credit-count")).toHaveText("10", { timeout: 5_000 });
  await expect(page.getByText("Free credits added")).toBeVisible();

  expect(session.signupReward).toMatchObject({ creditsGranted: 10 });
  expect(session.promotionalCredits).toMatchObject({ remaining: 10 });
  expect(wallet).toMatchObject({
    balance_credits: 10,
    free_credits_granted: 10,
    promotional_credits_remaining: 10
  });

  const signupExpiry = session.signupReward?.expiresAt;
  const walletExpiry = wallet.promotional_credits_expires_at;
  expect(signupExpiry).toBeTruthy();
  expect(walletExpiry).toBeTruthy();
  expect(Date.parse(walletExpiry!)).toBe(Date.parse(signupExpiry!));
  expect(Date.parse(session.promotionalCredits?.expiresAt ?? "")).toBe(Date.parse(walletExpiry!));

  const expiryTime = Date.parse(walletExpiry!);
  expect(expiryTime - verificationStartedAt).toBeGreaterThanOrEqual(NINETY_DAYS_MS);
  expect(expiryTime - verificationFinishedAt).toBeLessThanOrEqual(NINETY_DAYS_MS);

  await expect(page.getByText(`Use by ${formatUtcDate(walletExpiry!)}`)).toBeVisible();

  await page.getByRole("button", { name: "Start finding homes" }).click();

  // Reload and wait for the session to actually rehydrate — the modal renders
  // null while useSession() is loading, so asserting too early passes vacuously.
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/session")),
    page.reload()
  ]);
  // If the once-only guard regressed, the modal opens immediately after the
  // session resolves; give it a bounded window to (wrongly) appear.
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("welcome-credit-count")).toHaveCount(0);
});

test("reduced motion renders the final signup reward state immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await completeSignup(page);

  await expect(page.getByTestId("welcome-credit-count")).toHaveText("10");
  await expect(page.getByText("Free credits added")).toBeVisible();
  await expect(page.getByText(/^Use by /)).toBeVisible();
  await expect(page.getByTestId("welcome-reward-particles")).toHaveClass(
    /welcome-reward__particles--reduced/
  );
});
