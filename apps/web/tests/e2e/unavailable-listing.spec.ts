// apps/web/tests/e2e/unavailable-listing.spec.ts
//
// Documents the "mark a rental unavailable" happy path end to end (Task 17):
//   1. Owner marks a flat unavailable via the real owner-listings toggle.
//   2. The listing detail page swaps in "Notify when available".
//   3. A guest (fresh browser context — no session) completes OTP and joins
//      the notify-when-available waitlist, seeing the success state.
//   4. Search sinks the listing under the "Currently unavailable" divider.
//   5. Admin's Verified Homes workspace shows the waitlist lead with the
//      guest's phone number.
//
// Per-surface flag-off behavior (owner card, search card/page, detail panel,
// admin workspace) is already covered by component/unit tests — see e.g.
// apps/web/components/owner/__tests__/listing-availability-toggle.test.tsx,
// apps/web/components/__tests__/listing-card-availability.test.tsx,
// apps/web/components/__tests__/unlock-panel-availability.test.tsx,
// apps/web/components/admin/homes/__tests__/AdminHomeWorkspace.test.tsx.
// This file only exercises the flag-ON happy path.
//
// Requires the whole stack running with the flag ON:
//   FF_UNAVAILABLE_LISTINGS=true (api)
//   NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS=true (web)
// Self-skips otherwise (same convention as callback-leads.spec.ts /
// guest-gating.spec.ts). Run with e.g.:
//
//   FF_UNAVAILABLE_LISTINGS=true NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS=true \
//     PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 \
//     pnpm --filter @cribliv/web test:e2e -- unavailable-listing
//
// Uses the in-memory API's seeded owner (+919999999901). Its eligible
// (flat_house, status=active) listing is looked up dynamically via the owner
// API rather than hardcoded by title, so this also works against a
// Postgres-backed run with different seed data, as long as that owner has
// at least one such listing.
import { expect, test } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "../utils/auth";

const FLAG_ON =
  process.env.NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS === "1" ||
  process.env.NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS === "true";

function apiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

// Distinct prefix from welcome-credits.spec.ts's `+9196…` scheme purely so
// the two suites can never coincidentally mint the same phone number.
function uniqueGuestPhone() {
  const seed = Date.now() % 100_000_000;
  return `+9197${String(seed).padStart(8, "0")}`;
}

interface OwnerListingItem {
  id: string;
  title: string;
  listingType: "flat_house" | "pg";
  status: string;
  city?: string;
  is_available?: boolean;
}

interface OwnerListingsResponse {
  data: { items: OwnerListingItem[]; total: number };
}

test.describe("unavailable listing — notify waitlist happy path (flag on)", () => {
  test.skip(!FLAG_ON, "NEXT_PUBLIC_FF_UNAVAILABLE_LISTINGS not set for this run");

  test("owner marks a flat unavailable; guest joins the waitlist; search + admin reflect it", async ({
    request,
    browser
  }) => {
    test.setTimeout(180_000);

    // ──────────────────────────────────────────────────────────────────
    // 1. Owner: find the eligible (flat_house, active) listing, then mark
    //    it unavailable via the *real* toggle in /owner/listings.
    // ──────────────────────────────────────────────────────────────────
    const owner = await loginAsRole(request, "owner");

    const ownerListingsRes = await request.get(`${apiBaseUrl()}/owner/listings`, {
      headers: { Authorization: `Bearer ${owner.access_token}` }
    });
    expect(ownerListingsRes.ok()).toBeTruthy();
    const ownerListingsJson = (await ownerListingsRes.json()) as OwnerListingsResponse;
    const eligible = ownerListingsJson.data.items.find(
      (item) => item.listingType === "flat_house" && item.status === "active"
    );
    test.skip(!eligible, "seed data has no eligible (flat_house, active) owner listing to toggle");
    const listingId = eligible!.id;
    const listingTitle = eligible!.title;
    const listingCity = eligible!.city;

    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await setSessionOnPage(ownerPage, owner);
    await ownerPage.goto("/en/owner/listings");

    const card = ownerPage.locator("article.lcl", { hasText: listingTitle });
    await expect(card).toBeVisible();
    const availabilitySwitch = card.getByRole("switch", { name: "Availability" });
    await expect(availabilitySwitch).toBeVisible();

    // Idempotency: if a previous run against a persisted in-memory server
    // left this listing unavailable, normalize back to available first so
    // the "mark unavailable" step below is a genuine state transition.
    if (!(await availabilitySwitch.isChecked())) {
      await availabilitySwitch.click();
      await expect(availabilitySwitch).toBeChecked({ timeout: 10_000 });
    }

    // The step under test.
    await availabilitySwitch.click();
    await expect(availabilitySwitch).not.toBeChecked({ timeout: 10_000 });

    // Confirm the click actually persisted server-side, not just optimistic
    // local state.
    const refreshedRes = await request.get(`${apiBaseUrl()}/owner/listings`, {
      headers: { Authorization: `Bearer ${owner.access_token}` }
    });
    const refreshedJson = (await refreshedRes.json()) as OwnerListingsResponse;
    const refreshedItem = refreshedJson.data.items.find((item) => item.id === listingId);
    expect(refreshedItem?.is_available).toBe(false);

    await ownerContext.close();

    // ──────────────────────────────────────────────────────────────────
    // 2 & 3. Guest (fresh, anonymous context — must NOT inherit the
    //    owner's injected session): detail page offers "Notify when
    //    available"; complete OTP -> join waitlist -> success state.
    // ──────────────────────────────────────────────────────────────────
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();

    await guestPage.goto(`/en/listing/${listingId}`);
    await expect(guestPage.locator("h1")).toHaveText(listingTitle);

    const panel = guestPage.locator("#unlock-panel");
    await expect(panel.getByText("Not available right now")).toBeVisible();

    const notifyButton = panel.getByRole("button", { name: "Notify when available" });
    await expect(notifyButton).toBeEnabled({ timeout: 10_000 });
    await notifyButton.click();

    const guestPhone = uniqueGuestPhone();
    const phoneInput = panel.locator("#unlock-phone");
    await expect(phoneInput).toBeVisible();
    await phoneInput.fill(guestPhone);

    const [sendResponse] = await Promise.all([
      guestPage.waitForResponse(
        (res) => res.url().includes("/auth/otp/send") && res.request().method() === "POST"
      ),
      panel.getByRole("button", { name: "Send OTP" }).click()
    ]);
    const otp = (await sendResponse.json())?.data?.dev_otp as string | undefined;
    expect(
      otp,
      "OTP_PROVIDER=mock must be set for this run so /auth/otp/send returns dev_otp"
    ).toBeTruthy();

    await panel.locator("#unlock-otp").fill(otp!);
    await panel.getByRole("button", { name: "Verify & notify me" }).click();

    const successState = panel.getByTestId("availability-joined");
    await expect(successState).toBeVisible({ timeout: 10_000 });
    // Fresh phone every run ⇒ always the "just joined" copy, never
    // "already on the waitlist".
    await expect(successState).toContainText("You're on the list");

    // ──────────────────────────────────────────────────────────────────
    // 4. Search sinks the listing under the "currently unavailable"
    //    divider (still the guest's anonymous context/page).
    // ──────────────────────────────────────────────────────────────────
    await guestPage.goto(`/en/search${listingCity ? `?city=${listingCity}` : ""}`);
    const divider = guestPage.locator(".tenant-results-unavailable-divider");
    await expect(divider).toBeVisible();
    await expect(
      guestPage
        .locator(".tenant-results-unavailable-divider ~ .listing-grid")
        .getByText(listingTitle)
    ).toBeVisible();

    await guestContext.close();

    // ──────────────────────────────────────────────────────────────────
    // 5. Admin: Verified Homes workspace shows the waitlist lead with the
    //    guest's phone number.
    // ──────────────────────────────────────────────────────────────────
    const admin = await loginAsRole(request, "admin");
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await setSessionOnPage(adminPage, admin);
    await adminPage.goto("/en/admin");

    const adminNav = adminPage.getByRole("navigation", { name: /admin navigation/i });
    await expect(adminNav).toBeVisible();
    await adminNav.getByRole("button", { name: "Verified Homes" }).click();
    await expect(adminPage.getByRole("heading", { name: "Verified Homes" })).toBeVisible();

    await adminPage.getByPlaceholder("Search title, owner, phone, locality, ID").fill(listingTitle);
    await adminPage.getByRole("button", { name: `Open ${listingTitle} workspace` }).click();

    await expect(adminPage.getByText("Waitlist leads", { exact: false })).toBeVisible();
    // The panel previews only 5 rows by default — expand if a prior run
    // against a persisted server left more than that.
    const viewAllButton = adminPage.getByRole("button", { name: /view all/i });
    if (await viewAllButton.isVisible().catch(() => false)) {
      await viewAllButton.click();
    }
    await expect(adminPage.getByText(guestPhone)).toBeVisible();

    await adminContext.close();
  });
});
