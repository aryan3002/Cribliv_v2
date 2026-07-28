// apps/web/tests/admin-listing-transfer.spec.ts
//
// Admin listing-ownership transfer E2E: an admin opens a flat/house listing in
// Verified Homes, moves it to a brand-new owner by phone from the Owner tab,
// and the transferred-to account can immediately see it in their own
// dashboard after logging in.
//
// This proves the whole point of AdminListingTransferService in one pass:
// listings.owner_user_id AND contact_phone_encrypted move together, the
// workspace reflects the new owner without a page reload, and the
// transferred-to account already holds the `owner` role by the time it logs
// in (granted at transfer time, not deferred to first login).
//
// Requires a live Postgres — the Postgres-only code path is what actually
// moves contact_phone_encrypted (the in-memory fallback has no such field —
// see the doc comment on AdminListingTransferService.transferInMemory), so
// this self-skips rather than asserting a weaker in-memory-only behaviour.
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginAsRole, loginWithOtp, setSessionOnPage } from "./utils/auth";

/**
 * Not one of the seeded test accounts (ROLE_PHONE in utils/auth.ts only
 * covers ...901-...904), so the transfer below must create this account from
 * scratch. Matches the modal's own placeholder text ("99567 29103") — both
 * are the same fictitious example number, not a coincidence.
 */
const NEW_OWNER_PHONE = "+919956729103";

/**
 * HomeOwnerTab displays the phone through formatPhone() (lib/admin/format.ts),
 * which reformats a 13-char "+91XXXXXXXXXX" into "+91 XXXXX XXXXX" for
 * display. Assert against that rendered form — the raw E.164 string is never
 * in the DOM verbatim once formatted.
 */
const NEW_OWNER_PHONE_DISPLAY = `+91 ${NEW_OWNER_PHONE.slice(3, 8)} ${NEW_OWNER_PHONE.slice(8)}`;

function getApiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The one sliver of the `pg` API markListingVerified actually uses. */
interface MinimalPgClient {
  connect(): Promise<void>;
  query(text: string, params?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

interface MinimalPgModule {
  Client: new (config: { connectionString: string }) => MinimalPgClient;
}

/**
 * apps/web has no dependency on `pg` (this is the only spec in the suite that
 * needs a direct DB connection rather than going through the HTTP API — see
 * markListingVerified below for why). Reuse @cribliv/api's install the same
 * way data/seeds/seed.ts does, instead of adding a new devDependency to
 * apps/web just for this one fixture-setup query. Typed against a minimal
 * local shape rather than `typeof import("pg")` — apps/web's tsconfig can't
 * resolve pg's own type declarations since pg isn't its dependency either.
 */
function loadPgFromApi(): MinimalPgModule {
  const apiPackageJson = path.resolve(__dirname, "../../api/package.json");
  const requireFromApi = createRequire(apiPackageJson);
  return requireFromApi("pg") as MinimalPgModule;
}

/**
 * Flips a listing's verification_status straight to 'verified'.
 *
 * There is no HTTP endpoint that does this for a plain flat/house listing
 * without first running it through the real liveness/electricity-bill
 * verification pipeline: owner.service.ts's INSERT hard-codes new listings to
 * 'unverified', and the only code paths that ever write 'verified' are (a)
 * POST /admin/review/verifications/:attempt_id/decision, which requires an
 * existing verification_attempts row created by uploading a real artifact
 * (admin.controller.ts:479-486), or (b) the pg-only branch of the listing
 * review decision (same file, ~line 249, gated `AND listing_type = 'pg'` —
 * does not touch flat_house rows at all). Both are orthogonal to what this
 * spec is testing (ownership transfer, not identity verification), so this
 * sets the precondition directly — the same shortcut the v1 migration
 * (write-flat.ts) takes for already-vetted inventory, since a listing that
 * reaches this state can only ever have gotten there by hand or through that
 * migration today.
 */
async function markListingVerified(listingId: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "admin-listing-transfer.spec.ts needs DATABASE_URL set (the same Postgres the API " +
        "server under test is using) to mark its fixture listing verified — see the comment " +
        "on markListingVerified for why a raw UPDATE is necessary here."
    );
  }
  const { Client } = loadPgFromApi();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`UPDATE listings SET verification_status = 'verified' WHERE id = $1::uuid`, [
      listingId
    ]);
  } finally {
    await client.end();
  }
}

/**
 * Creates, submits, admin-approves, and marks-verified a fresh flat/house
 * listing so this spec has exactly one row it can unambiguously find in
 * Verified Homes regardless of whatever else is already in the database —
 * mirrors createLeadForAdminBoard in admin-lead-center.spec.ts. `pnpm db:seed`
 * does not create any listings (only cities/localities/metro stations/dev
 * users), so there is no pre-existing row to rely on either way.
 *
 * Verified Homes requires BOTH listing_type = 'flat_house' AND status IN
 * ('active','paused','archived') AND verification_status = 'verified'
 * (admin-homes.service.ts's baseCte) — approval alone only satisfies the
 * first two.
 */
async function createVerifiedHome(
  request: APIRequestContext,
  ownerToken: string,
  adminToken: string,
  title: string
): Promise<string> {
  const api = getApiBaseUrl();
  const create = await request.post(`${api}/owner/listings`, {
    headers: { Authorization: `Bearer ${ownerToken}` },
    data: { title, listing_type: "flat_house", rent: 18000, location: { city: "delhi" } }
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

  await markListingVerified(listingId);

  return listingId;
}

test("admin transfers a listing and the new owner can see it", async ({ page, request }) => {
  test.skip(
    !process.env.DATABASE_URL,
    "requires a live Postgres — set DATABASE_URL to the same database the API server under " +
      "test is using (mirrors the DB-backed describe block in admin-lead-center.spec.ts)"
  );

  const title = `Transfer E2E ${Date.now()}`;
  const owner = await loginAsRole(request, "owner");
  const admin = await loginAsRole(request, "admin");
  await createVerifiedHome(request, owner.access_token, admin.access_token, title);

  await setSessionOnPage(page, admin);

  await page.goto("/en/admin");
  const adminNav = page.getByRole("navigation", { name: /admin navigation/i });
  await adminNav.getByRole("button", { name: "Verified Homes" }).click();
  await expect(page.getByRole("heading", { name: "Verified Homes" })).toBeVisible();

  // Narrow to the listing this test just created — sidesteps pagination and
  // default sort ordering against whatever else is already in the database.
  await page.getByLabel("Search verified homes").fill(title);
  await page
    .getByRole("button", { name: new RegExp(`open ${escapeRegExp(title)} workspace`, "i") })
    .click();
  await expect(page.getByRole("button", { name: "Copy public URL" })).toBeVisible();

  const workspaceTabs = page.getByRole("navigation", { name: "Verified home sections" });
  await workspaceTabs.getByRole("button", { name: "Owner", exact: true }).click();

  await page.getByRole("button", { name: "Transfer ownership", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /transfer ownership/i });
  await dialog.getByLabel(/owner's phone/i).fill("99567 29103");
  await dialog.getByLabel(/owner's name/i).fill("Akash Rai");
  await dialog.getByRole("button", { name: "Transfer ownership", exact: true }).click();

  // The workspace refetches in place (HomeOwnerTab's onOwnerChanged bumps
  // AdminHomeWorkspace's reloadKey — see 0a3005d — so the tab is not reset),
  // so the Owner tab now shows the new owner without navigating away.
  await expect(page.getByText(NEW_OWNER_PHONE_DISPLAY)).toBeVisible();
  await expect(page.getByText("Akash Rai")).toBeVisible();

  // The transferred-to account was created by the transfer and already holds
  // the owner role (admin-listing-transfer.service.ts inserts it directly),
  // so an OTP login for that number lands in the owner dashboard holding the
  // listing.
  const newOwner = await loginWithOtp(request, NEW_OWNER_PHONE);
  await setSessionOnPage(page, newOwner);
  await page.goto("/en/owner/listings");
  await expect(page.getByText(title)).toBeVisible();
});
