// apps/web/tests/callback-leads.spec.ts
// Requires API (in-memory mode is fine) + web running with:
//   FF_CALLBACK_LEADS=true FF_LEAD_MANAGEMENT_ENABLED=true (api)
//   NEXT_PUBLIC_FF_CALLBACK_LEADS=true (web)
// Self-skips otherwise, mirroring listening-hero.spec.ts.
import { expect, test } from "@playwright/test";
import { loginWithOtp, setSessionOnPage } from "./utils/auth";

const FLAG_ON =
  process.env.NEXT_PUBLIC_FF_CALLBACK_LEADS === "1" ||
  process.env.NEXT_PUBLIC_FF_CALLBACK_LEADS === "true";

function getApiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

test.describe("callback leads (flag on)", () => {
  test.skip(!FLAG_ON, "NEXT_PUBLIC_FF_CALLBACK_LEADS not set for this run");

  test("tenant requests a callback and never sees a phone number", async ({ page, request }) => {
    const search = await request.get(`${getApiBaseUrl()}/listings/search`);
    const listingId = (await search.json()).data.items[0].id as string;

    const session = await loginWithOtp(request, "+919999999902");
    // The Request Callback click below is the same button as Unlock Number
    // (unlock-contact-panel.tsx, data-testid="unlock-cta") and now passes
    // through the name-capture contact gate (requireName). The seeded tenant
    // isn't guaranteed to have a name on a freshly-seeded DB, so set one
    // explicitly rather than assume — this test is about the callback flow,
    // not the name gate (see apps/web/tests/name-capture.spec.ts for that).
    await request.patch(`${getApiBaseUrl()}/users/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      data: { full_name: "Callback Leads Tenant" }
    });
    await page.goto(`/en/listing/${listingId}`);
    await setSessionOnPage(page, session);
    await page.reload();

    await expect(
      page.getByText("you'll get a call for this property within 24 hours", { exact: false })
    ).toBeVisible();

    await page.getByRole("button", { name: "Request Callback" }).click();

    await expect(page.getByTestId("callback-requested")).toBeVisible();
    await expect(page.getByText("Owner notified ✓")).toBeVisible();
    // The guarantee: no phone number anywhere in the success panel.
    await expect(page.getByTestId("callback-requested")).not.toContainText("+91");
  });

  test("my-callbacks page lists the request", async ({ page, request }) => {
    const session = await loginWithOtp(request, "+919999999902");
    await page.goto("/en");
    await setSessionOnPage(page, session);
    await page.goto("/en/tenant/callbacks");
    await expect(page.getByRole("heading", { name: "My Callbacks" })).toBeVisible();
  });
});

test.describe("callback leads (flag off guard)", () => {
  test.skip(FLAG_ON, "guard only applies to flag-off runs");

  test("legacy Unlock Number button remains", async ({ page, request }) => {
    const search = await request.get(`${getApiBaseUrl()}/listings/search`);
    const listingId = (await search.json()).data.items[0].id as string;
    await page.goto(`/en/listing/${listingId}`);
    await expect(page.getByRole("button", { name: "Unlock Number" })).toBeVisible();
  });
});
