// apps/web/tests/name-capture.spec.ts
//
// E2E coverage for the signup name-capture feature: the login-page name step
// (Moment 1, with a check that Moment 3's ambient prompt doesn't immediately
// re-fire on the landing page) and the unskippable contact gate (Moment 4) on
// a listing page. Uses the shared helpers in ./utils/auth.ts — loginWithOtp
// for a raw API session, setSessionOnPage to establish both the NextAuth
// cookie and the legacy localStorage session the unlock panel reads.
//
// Requires the API + web dev servers (see CLAUDE.md's E2E setup), with
// OTP_PROVIDER=mock so /auth/otp/send returns dev_otp for auto-fill — exactly
// what playwright.config.ts's webServer entries already set.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginWithOtp, setSessionOnPage } from "./utils/auth";

function apiBase() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

// Distinct per run (not just per call) so re-running this file against a
// long-lived dev server — in-memory or DB-backed — doesn't collide with
// accounts a previous run already gave a name to. Offsets keep the four
// numbers used below distinct from each other within the same run.
const RUN_ID = Date.now();

/** A phone nobody has used, so the account is created fresh and nameless. */
function freshPhone(offset: number) {
  const unique = (RUN_ID + offset) % 100_000_000;
  return `+9198${String(unique).padStart(8, "0")}`;
}

async function setName(request: APIRequestContext, token: string, fullName: string) {
  const res = await request.patch(`${apiBase()}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { full_name: fullName }
  });
  expect(res.ok()).toBeTruthy();
}

/**
 * lead-credit-purchase.spec.ts and callback-leads.spec.ts both resolve a
 * listing to exercise the same way — search with no filters, take the first
 * result — rather than hardcoding an id that could drift as seed data
 * changes. Mirrored here instead of a hardcoded LISTING_PATH.
 */
async function firstListingPath(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${apiBase()}/listings/search`);
  expect(res.ok()).toBeTruthy();
  const payload = await res.json();
  const listingId = payload?.data?.items?.[0]?.id as string | undefined;
  expect(listingId).toBeTruthy();
  return `/en/listing/${listingId}`;
}

test.describe("name capture at login", () => {
  test("a nameless user is asked for a name before landing", async ({ page }) => {
    const phone = freshPhone(1);

    await page.goto("/en/auth/login");
    // apps/[locale]/auth/login/page.tsx labels the field "Mobile number", not
    // "Phone" — confirmed by reading the component rather than guessing.
    await page.getByLabel(/mobile number/i).fill(phone);
    await page.getByRole("button", { name: /continue with otp/i }).click();

    // OTP_PROVIDER=mock auto-fills the OTP box via dev_otp (handleSendOtp),
    // so the verify button is already enabled — no need to type a code.
    await page.getByRole("button", { name: /verify/i }).click();

    await expect(page.getByTestId("name-capture-input")).toBeVisible();
    // Crucially: still on the login route, i.e. the auto-redirect guard
    // (status === "authenticated" -> replace()) stood down for step 3.
    expect(new URL(page.url()).pathname).toContain("/auth/login");

    await page.getByTestId("name-capture-input").fill("Asha Devi");
    await page.getByTestId("name-capture-submit").click();

    await expect(page).not.toHaveURL(/\/auth\/login/);
    // Login step 3 renders NameCaptureForm directly, not NameCaptureModal
    // (see login/page.tsx) — this really asserts the ambient (moment 3)
    // prompt doesn't immediately reopen on the landing page for a name that
    // was just saved.
    await expect(page.getByTestId("name-capture-modal")).toHaveCount(0);
  });

  test("skipping does not immediately re-prompt on the landing page", async ({ page }) => {
    const phone = freshPhone(2);

    await page.goto("/en/auth/login");
    await page.getByLabel(/mobile number/i).fill(phone);
    await page.getByRole("button", { name: /continue with otp/i }).click();
    await page.getByRole("button", { name: /verify/i }).click();

    await expect(page.getByTestId("name-capture-input")).toBeVisible();
    await page.getByTestId("name-capture-skip").click();

    await expect(page).not.toHaveURL(/\/auth\/login/);
    // Being asked twice back-to-back reads as a broken form — onSkip marks
    // the prompt dismissed in sessionStorage before navigating, which is
    // what this asserts held.
    await expect(page.getByTestId("name-capture-modal")).toHaveCount(0);
  });
});

test.describe("name capture at contact", () => {
  test("a nameless user cannot unlock contact without giving a name", async ({ page, request }) => {
    const phone = freshPhone(3);
    const session = await loginWithOtp(request, phone);
    await setSessionOnPage(page, session);

    const listingPath = await firstListingPath(request);

    // The ambient (moment 3) prompt can legitimately race the contact gate
    // on this page: same nameless tenant, same non-suppressed path. It reads
    // session.user.name from NextAuth, which only resolves once the browser's
    // own /api/auth/session fetch completes — wait for that fetch so the
    // check below isn't a coin flip on which async chain wins.
    const sessionSynced = page
      .waitForResponse((res) => res.url().includes("/api/auth/session"), { timeout: 10_000 })
      .catch(() => null);
    await page.goto(listingPath);
    await sessionSynced;

    // If the ambient prompt won that race, it's skippable — dismiss it so it
    // isn't sitting on top of the unlock button. The assertions below are
    // about the *required* modal the click opens, not this one.
    const ambientModal = page.getByTestId("name-capture-modal");
    if (await ambientModal.isVisible().catch(() => false)) {
      await page.getByTestId("name-capture-skip").click();
      await expect(ambientModal).toHaveCount(0);
    }

    // requireName() resolves the name server-side via GET /auth/me (not the
    // NextAuth session — this panel's users may hold a localStorage-only
    // session) before deciding whether to open the required modal.
    const nameChecked = page.waitForResponse((res) => res.url().includes("/auth/me"));
    await page.getByTestId("unlock-cta").click();
    await nameChecked;

    const modal = page.getByTestId("name-capture-modal");
    await expect(modal).toBeVisible();
    // Unskippable: no skip control, no close control, Esc does nothing.
    await expect(page.getByTestId("name-capture-skip")).toHaveCount(0);
    await expect(page.getByTestId("name-capture-close")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(modal).toBeVisible();

    await page.getByTestId("name-capture-input").fill("Asha Devi");
    await page.getByTestId("name-capture-submit").click();
    await expect(modal).toHaveCount(0);
  });

  test("a user who already has a name is never interrupted", async ({ page, request }) => {
    const phone = freshPhone(4);
    const session = await loginWithOtp(request, phone);
    await setName(request, session.access_token, "Asha Devi");
    await setSessionOnPage(page, session);

    const listingPath = await firstListingPath(request);
    await page.goto(listingPath);

    const nameChecked = page.waitForResponse((res) => res.url().includes("/auth/me"));
    await page.getByTestId("unlock-cta").click();
    // Wait for requireName()'s own server round-trip before asserting the
    // modal never showed — otherwise this could pass simply because it ran
    // before that async check had a chance to open anything.
    await nameChecked;

    await expect(page.getByTestId("name-capture-modal")).toHaveCount(0);
  });
});
