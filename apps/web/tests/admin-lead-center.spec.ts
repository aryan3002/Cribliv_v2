// apps/web/tests/admin-lead-center.spec.ts
//
// Admin Lead Center E2E: the live board (KPI cards + table + row drawer) and
// the flag-off graceful-degradation path.
//
// The "flag on" describe block requires a DB-backed API (AdminLeadOpsService
// .getBoard returns an empty board when DATABASE_URL isn't set — see
// apps/api/src/modules/leads/admin-lead-ops.service.ts — so a real row for
// the drawer assertion needs Postgres) with:
//   FF_ADMIN_LEAD_CENTER=true
// and a migrated, seeded Postgres (pnpm db:seed provides the owner/admin test
// phones this spec logs in as). Self-skips otherwise, mirroring the
// FF_-gated skip pattern in lead-credit-purchase.spec.ts.
//
// The "flag off" describe block needs neither the flag nor a DB:
// ensureEnabled() checks the flag before any database access, so the board
// endpoint 403s with `feature_disabled` even in in-memory mode — this half
// runs under the default `pnpm test:e2e` invocation.
import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginAsRole, loginWithOtp, setSessionOnPage } from "./utils/auth";

function flagOn(name: string): boolean {
  const v = process.env[name];
  return v === "1" || v === "true";
}

const FLAG_ON = flagOn("FF_ADMIN_LEAD_CENTER");

function getApiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function randPhone(): string {
  return `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

/**
 * Creates an approved listing and a tenant callback request against it, so
 * the admin lead board has a fresh, uniquely-titled row to find regardless
 * of whatever else is already in the DB. (The board's default ordering is
 * soonest-refund-deadline-first, not newest-first, so a pre-existing lead
 * closer to expiry could otherwise push this one past page 1 — the test
 * sidesteps that entirely by searching for the unique title.)
 */
async function createLeadForAdminBoard(
  request: APIRequestContext,
  ownerToken: string,
  adminToken: string,
  title: string
): Promise<void> {
  const api = getApiBaseUrl();
  const create = await request.post(`${api}/owner/listings`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { title, listing_type: "flat_house", rent: 15000, location: { city: "delhi" } }
  });
  expect(create.ok(), `create listing failed: ${await create.text()}`).toBeTruthy();
  const listingId = (await create.json()).data.listing_id as string;

  const submit = await request.post(`${api}/owner/listings/${listingId}/submit`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { agree_terms: true }
  });
  expect(submit.ok(), `submit listing failed: ${await submit.text()}`).toBeTruthy();

  const decision = await request.post(`${api}/admin/review/listings/${listingId}/decision`, {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { decision: "approve" }
  });
  expect(decision.ok(), `admin approve failed: ${await decision.text()}`).toBeTruthy();

  const tenant = await loginWithOtp(request, randPhone());
  const callback = await request.post(`${api}/tenant/contact-unlocks`, {
    headers: {
      Authorization: `Bearer ${tenant.access_token}`,
      "Idempotency-Key": `admin-lc-${Date.now()}-${Math.random().toString(36).slice(2)}`
    },
    data: { listing_id: listingId }
  });
  expect(callback.ok(), `contact-unlock failed: ${await callback.text()}`).toBeTruthy();
  // Lead creation is fire-and-forget server-side (contacts.service.ts) — give
  // it a beat, mirroring lead-credit-purchase.spec.ts / lead-unlock.integration.test.ts.
  await new Promise((resolve) => setTimeout(resolve, 400));
}

test.describe("admin lead center (flag on)", () => {
  test.skip(!FLAG_ON, "FF_ADMIN_LEAD_CENTER not set for this run");

  test("board renders KPI cards + table, and a row opens the detail drawer", async ({
    page,
    request
  }) => {
    const title = `Lead Center E2E ${Date.now().toString()}`;
    const owner = await loginAsRole(request, "owner");
    const admin = await loginAsRole(request, "admin");
    await createLeadForAdminBoard(request, owner.access_token, admin.access_token, title);

    await setSessionOnPage(page, admin);
    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible();

    await page.getByRole("button", { name: "Lead Center" }).click();
    await expect(page.getByRole("heading", { name: "Lead Center" })).toBeVisible();

    // KPI strip.
    await expect(page.locator(".admin-stat-grid").getByText("In-flight")).toBeVisible();
    await expect(page.locator(".admin-stat-grid").getByText("Uncalled")).toBeVisible();

    // Scope the board down to our fresh row via the search box — sidesteps
    // both pagination and any pre-existing DB state from other spec runs.
    await page.getByRole("textbox", { name: "Search leads" }).fill(title);

    const row = page.locator("table.admin-table tbody tr", { hasText: title });
    await expect(row).toBeVisible();

    // Open the detail drawer by clicking the listing-title cell — the
    // seeker/actions cells have their own stopPropagation'd links/buttons,
    // but this cell is inert and safely bubbles to the row's onRowClick.
    await row.getByText(title).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText(title);
  });
});

test.describe("admin lead center (flag off guard)", () => {
  test.skip(FLAG_ON, "guard only applies to flag-off runs");

  test("flag off: Lead Center degrades to an empty state, not a crash", async ({
    page,
    request
  }) => {
    const admin = await loginAsRole(request, "admin");
    await setSessionOnPage(page, admin);

    await page.goto("/en/admin");
    await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible();

    await page.getByRole("button", { name: "Lead Center" }).click();
    await expect(page.getByRole("heading", { name: "Lead Center" })).toBeVisible();
    await expect(page.getByText("Lead Center is disabled")).toBeVisible();
  });
});
