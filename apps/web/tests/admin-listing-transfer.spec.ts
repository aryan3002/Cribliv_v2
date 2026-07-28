// apps/web/tests/admin-listing-transfer.spec.ts
//
// Admin listing-ownership transfer E2E: an admin opens a flat/house listing in
// Verified Homes, moves it to a brand-new owner by phone from the Owner tab,
// and the transferred-to account can immediately see it in their own
// dashboard after logging in.
//
// This proves the whole point of AdminListingTransferService in one pass:
// listings.owner_user_id AND contact_phone_encrypted move together, an
// existing lead moves with the listing (and is marked transferred_at so it
// doesn't consume the new owner's free-lead allowance), the workspace
// reflects the new owner without a page reload, and the transferred-to
// account already holds the `owner` role by the time it logs in (granted at
// transfer time, not deferred to first login).
//
// Note on what the UI assertions do and don't prove: the Owner tab's phone
// and the new owner's /en/owner/listings view both resolve through
// listings.owner_user_id (admin-homes.service.ts's detail query joins
// `users u ON u.id = l.owner_user_id`; owner.service.ts's listOwnerListings
// is scoped `WHERE l.owner_user_id = $1`) — neither one ever reads
// listings.contact_phone_encrypted. So they'd still pass even if a future
// change stopped moving that column while a tenant kept getting handed the
// old owner's number. The direct SQL assertion on contact_phone_encrypted
// below is what actually guards that invariant.
//
// Requires a live Postgres — the Postgres-only code path is what actually
// moves contact_phone_encrypted (the in-memory fallback has no such field —
// see the doc comment on AdminListingTransferService.transferInMemory), so
// this self-skips rather than asserting a weaker in-memory-only behaviour.
//
// SAFETY (2026-07-28 review, Finding 1 — read this before touching
// DATABASE_URL for a local run): this spec used to hand-code the transfer
// TARGET's phone as "+919956729103" and its header comment called that "the
// same fictitious example number" as the transfer modal's placeholder text.
// It was not fictitious — it is a real customer's number (Akash Rai), and
// production listing ad204234-4b39-4228-8b49-3b9e91113e16 was transferred to
// it on 2026-07-28 (see
// docs/superpowers/specs/2026-07-28-admin-listing-onbehalf-and-transfer-design.md,
// "Already done"). test.afterEach below unconditionally ran
// deleteUserAndDependents against that fixed number, autocommitted, gated
// only on `DATABASE_URL` being *set* — so pointing this suite at a
// production or prod-restored database would have deleted that real
// customer's sessions, wallet and full transaction ledger, even if the test
// failed on its very first line. Two independent fixes:
//   1. The transfer target's phone is now generated fresh per run
//      (randOwnerPhone() below) — nothing here is ever a real person's number.
//   2. All mutation (fixture creation in the test body, DELETEs in afterEach)
//      additionally requires dbMutationAllowed() below to return true: either
//      E2E_ALLOW_DB_MUTATION=1 is set, or DATABASE_URL's own database name
//      contains "test" or "local". A legitimate local run against, say,
//      "postgres://.../cribliv_test" needs no extra flag; anything else
//      (including a bare "postgres" or unrecognised name) is refused rather
//      than guessed at, and the test skips with an explanation instead of
//      running.
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { loginAsRole, loginWithOtp, setSessionOnPage } from "./utils/auth";

/**
 * A fresh, never-seeded number for the transfer TARGET owner, generated per
 * run — never a hard-coded literal (see the SAFETY note in the file header
 * for why). Not one of the seeded test accounts either (ROLE_PHONE in
 * utils/auth.ts only covers ...901-...904), so the transfer below must
 * create this account from scratch regardless.
 *
 * Uses a fixed "+9196" prefix, disjoint from randPhone()'s "+9197" (below) —
 * both are drawn in the same test run for different accounts (tenant vs.
 * transfer target), and giving them different prefixes makes a collision
 * between the two structurally impossible rather than merely unlikely.
 */
function randOwnerPhone(): string {
  return `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

/**
 * The digits a worker would type into the transfer modal's phone field for a
 * given E.164 number: no "+91", grouped 5+5 (matches the modal's own
 * placeholder style, e.g. "12345 67890").
 */
function toTypedPhone(e164: string): string {
  return `${e164.slice(3, 8)} ${e164.slice(8)}`;
}

/**
 * HomeOwnerTab displays the phone through formatPhone() (lib/admin/format.ts),
 * which reformats a 13-char "+91XXXXXXXXXX" into "+91 XXXXX XXXXX" for
 * display. Assert against that rendered form — the raw E.164 string is never
 * in the DOM verbatim once formatted.
 */
function toDisplayPhone(e164: string): string {
  return `+91 ${e164.slice(3, 8)} ${e164.slice(8)}`;
}

function getApiBaseUrl() {
  const raw = process.env.E2E_API_BASE_URL || "http://localhost:4000/v1";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A fresh, never-seeded tenant number for the pre-transfer lead. */
function randPhone(): string {
  return `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

/** The one sliver of the `pg` API this file uses. */
interface MinimalPgClient {
  connect(): Promise<void>;
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

interface MinimalPgModule {
  Client: new (config: { connectionString: string }) => MinimalPgClient;
}

/**
 * apps/web has no dependency on `pg` (this is the only spec in the suite that
 * needs a direct DB connection rather than going through the HTTP API — see
 * withPgClient below for why). Reuse @cribliv/api's install the same way
 * data/seeds/seed.ts does, instead of adding a new devDependency to apps/web
 * just for these fixture-setup/assertion/cleanup queries. Typed against a
 * minimal local shape rather than `typeof import("pg")` — apps/web's
 * tsconfig can't resolve pg's own type declarations since pg isn't its
 * dependency either.
 */
function loadPgFromApi(): MinimalPgModule {
  const apiPackageJson = path.resolve(__dirname, "../../api/package.json");
  const requireFromApi = createRequire(apiPackageJson);
  return requireFromApi("pg") as MinimalPgModule;
}

/**
 * Opens one direct Postgres connection for the duration of `fn`, then closes
 * it. Used for the three things the HTTP API has no endpoint for: marking the
 * fixture listing verified, asserting contact_phone_encrypted/leads/
 * admin_actions directly (the UI-facing assertions below all resolve through
 * owner_user_id and would still pass if those columns silently stopped
 * moving — see the file header), and cleaning up afterward.
 */
async function withPgClient<T>(fn: (client: MinimalPgClient) => Promise<T>): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "admin-listing-transfer.spec.ts needs DATABASE_URL set (the same Postgres the API " +
        "server under test is using)."
    );
  }
  const { Client } = loadPgFromApi();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
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
  await withPgClient((client) =>
    client.query(`UPDATE listings SET verification_status = 'verified' WHERE id = $1::uuid`, [
      listingId
    ])
  );
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

/**
 * Creates one real lead on the listing (via a tenant contact-unlock, exactly
 * how leads are created in production — mirrors
 * admin-lead-center.spec.ts's createLeadForAdminBoard), so the transfer has
 * an existing lead to carry over. Without this, "leads_moved" is always 0 and
 * the leads.owner_user_id / transferred_at side of transferOwner
 * (admin-listing-transfer.service.ts:152-160) is never exercised.
 */
async function createLeadOnListing(
  request: APIRequestContext,
  listingId: string
): Promise<{ tenantPhone: string }> {
  const api = getApiBaseUrl();
  const tenantPhone = randPhone();
  const tenant = await loginWithOtp(request, tenantPhone);
  const unlock = await request.post(`${api}/tenant/contact-unlocks`, {
    headers: {
      Authorization: `Bearer ${tenant.access_token}`,
      "Idempotency-Key": `transfer-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`
    },
    data: { listing_id: listingId }
  });
  expect(unlock.ok(), `contact-unlock failed: ${await unlock.text()}`).toBeTruthy();
  // Lead creation is fire-and-forget server-side (contacts.service.ts) — give
  // it a beat, mirroring admin-lead-center.spec.ts / lead-unlock.integration.test.ts.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { tenantPhone };
}

/** What this test creates, tracked so afterEach can remove it even after a mid-test failure. */
const created: { listingId?: string; tenantPhone?: string; newOwnerPhone?: string } = {};

/**
 * Whether this spec may run its mutating SQL — fixture creation in the test
 * body, DELETEs in afterEach — against whatever DATABASE_URL points to.
 *
 * True when either:
 *   - E2E_ALLOW_DB_MUTATION=1 is set (explicit, no guessing), or
 *   - DATABASE_URL's own database name self-identifies as non-production
 *     (contains "test" or "local", e.g. "cribliv_test", "cribliv_local").
 *
 * False otherwise — INCLUDING when DATABASE_URL fails to parse as a URL.
 * An unparseable connection string is not treated as a green light.
 *
 * This is deliberately independent of, and in addition to, randOwnerPhone()
 * no longer using a real person's number (see the file header's SAFETY
 * note): that fix means this spec's DELETEs can no longer land on a specific
 * known real customer, but without this guard too, a stray production
 * DATABASE_URL would still have this suite silently creating and deleting
 * rows — users, listings, leads, contact_unlocks — against a live database
 * nobody meant to point a test at.
 */
function dbMutationAllowed(): boolean {
  if (process.env.E2E_ALLOW_DB_MUTATION === "1") return true;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return false;
  try {
    const dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
    return /test|local/i.test(dbName);
  } catch {
    return false;
  }
}

/**
 * Deletes every row this test could have created for one phone number's
 * account (a NO-OP if that table has nothing for it — safe to call
 * unconditionally). Order matches the FK graph queried directly off this
 * schema (information_schema, all NO ACTION edges into users): sessions and
 * wallet_transactions/wallets/idempotency_keys all reference users with NO
 * ACTION, so they must go before the users row itself. Verified against a
 * live run: a tenant contact-unlock leaves exactly one sessions row, one
 * wallets row, and two wallet_transactions rows (signup-credit grant +
 * unlock debit) — idempotency_keys stayed empty for this flow but is
 * included anyway since deleting from an empty match is free.
 */
async function deleteUserAndDependents(client: MinimalPgClient, phone: string): Promise<void> {
  await client.query(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = $1)`,
    [phone]
  );
  await client.query(
    `DELETE FROM idempotency_keys WHERE actor_user_id IN (SELECT id FROM users WHERE phone_e164 = $1)`,
    [phone]
  );
  await client.query(
    `DELETE FROM wallet_transactions WHERE wallet_user_id IN (SELECT id FROM users WHERE phone_e164 = $1)`,
    [phone]
  );
  await client.query(
    `DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = $1)`,
    [phone]
  );
  await client.query(`DELETE FROM users WHERE phone_e164 = $1`, [phone]);
}

test.afterEach(async () => {
  if (!process.env.DATABASE_URL) return; // matches the test's own skip guard — nothing was created.
  if (!dbMutationAllowed()) {
    // Loud, not silent, and definitely not a delete. Reaching this line at
    // all means DATABASE_URL was set but dbMutationAllowed() said no — the
    // test itself should already have skipped via the second test.skip
    // below, so this is a second, independent line of defense: refuse to
    // guess, leave whatever rows exist in place.
    // eslint-disable-next-line no-console
    console.error(
      "[admin-listing-transfer.spec.ts] afterEach: refusing to run cleanup DELETEs. " +
        "DATABASE_URL is set but neither E2E_ALLOW_DB_MUTATION=1 is set nor does its " +
        "database name contain 'test' or 'local'. Any rows this run created were left in place — " +
        "see the SAFETY note at the top of this file."
    );
    return;
  }
  const { listingId, tenantPhone, newOwnerPhone } = created;
  await withPgClient(async (client) => {
    // Deletion order respects the FK graph (queried directly off this
    // schema, not assumed): listing_locations/photos/leads/fraud_flags/etc.
    // all cascade off listings, but contact_unlocks.listing_id and
    // contact_events.contact_unlock_id do not — and leads.contact_unlock_id
    // references contact_unlocks, so leads must be deleted before
    // contact_unlocks even though the listings->leads edge alone would have
    // cascaded them. admin_actions.target_id is a bare uuid (polymorphic
    // target_type), no FK, safe anytime. Users go last, after
    // deleteUserAndDependents clears their own referencing rows — only ever
    // by exact phone match, never the seeded owner/admin fixtures.
    if (listingId) {
      await client.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
      await client.query(
        `DELETE FROM contact_events WHERE contact_unlock_id IN
           (SELECT id FROM contact_unlocks WHERE listing_id = $1::uuid)`,
        [listingId]
      );
      await client.query(`DELETE FROM contact_unlocks WHERE listing_id = $1::uuid`, [listingId]);
      await client.query(
        `DELETE FROM admin_actions WHERE target_id = $1::uuid AND target_type = 'listing'`,
        [listingId]
      );
      await client.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    }
    if (newOwnerPhone) {
      await deleteUserAndDependents(client, newOwnerPhone);
    }
    if (tenantPhone) {
      await deleteUserAndDependents(client, tenantPhone);
    }
  });
});

test("admin transfers a listing and the new owner can see it", async ({ page, request }) => {
  test.skip(
    !process.env.DATABASE_URL,
    "requires a live Postgres — set DATABASE_URL to the same database the API server under " +
      "test is using (mirrors the DB-backed describe block in admin-lead-center.spec.ts)"
  );
  test.skip(
    !dbMutationAllowed(),
    "refusing to run: this spec creates and deletes real rows (users, listings, leads, " +
      "wallets, contact_unlocks). Point DATABASE_URL at a database whose name contains " +
      "'test' or 'local', or set E2E_ALLOW_DB_MUTATION=1 to confirm the current one is safe " +
      "to mutate — see the SAFETY note at the top of this file."
  );

  // Generated first, and recorded for afterEach immediately — before any
  // `await` that could throw — so a mid-test failure still leaves afterEach
  // knowing which (fake, freshly-minted) number to clean up.
  const newOwnerPhone = randOwnerPhone();
  created.newOwnerPhone = newOwnerPhone;

  const title = `Transfer E2E ${Date.now()}`;
  const owner = await loginAsRole(request, "owner");
  const admin = await loginAsRole(request, "admin");
  const listingId = await createVerifiedHome(
    request,
    owner.access_token,
    admin.access_token,
    title
  );
  created.listingId = listingId;

  const { tenantPhone } = await createLeadOnListing(request, listingId);
  created.tenantPhone = tenantPhone;

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
  await dialog.getByLabel(/owner's phone/i).fill(toTypedPhone(newOwnerPhone));
  await dialog.getByLabel(/owner's name/i).fill("Test Owner");
  await dialog.getByRole("button", { name: "Transfer ownership", exact: true }).click();

  // The workspace refetches in place (HomeOwnerTab's onOwnerChanged bumps
  // AdminHomeWorkspace's reloadKey — see 0a3005d — so the tab is not reset),
  // so the Owner tab now shows the new owner without navigating away. NOTE:
  // both of these resolve through owner_user_id (see file header) — they do
  // NOT exercise contact_phone_encrypted. That's asserted directly below.
  await expect(page.getByText(toDisplayPhone(newOwnerPhone))).toBeVisible();
  await expect(page.getByText("Test Owner")).toBeVisible();

  // The load-bearing assertion: contact_phone_encrypted is the column a
  // tenant's paid contact-unlock actually hands out (contacts.service.ts:305)
  // — it must equal the new owner's number, not just owner_user_id pointing
  // at a user whose own phone_e164 happens to match. Strict equality, not a
  // not-null or regex: this is the one check that fails if a future refactor
  // drops the column from the UPDATE while leaving owner_user_id intact.
  const listingRow = await withPgClient((client) =>
    client.query(`SELECT contact_phone_encrypted FROM listings WHERE id = $1::uuid`, [listingId])
  );
  expect(listingRow.rows[0]?.contact_phone_encrypted).toBe(newOwnerPhone);

  // The pre-existing lead moved with the listing and is marked transferred_at
  // (admin-listing-transfer.service.ts:152-160), so it won't consume the new
  // owner's free-lead allowance (leads.service.ts / migration 0069's comment).
  const leadRow = await withPgClient((client) =>
    client.query(
      `SELECT owner_user_id::text, transferred_at FROM leads WHERE listing_id = $1::uuid`,
      [listingId]
    )
  );
  expect(leadRow.rows).toHaveLength(1);
  expect(leadRow.rows[0]?.owner_user_id).not.toBe(owner.user.id);
  expect(leadRow.rows[0]?.transferred_at).not.toBeNull();

  // The transfer is audited, and the audit row's own leads_moved count
  // matches the one lead this fixture seeded.
  const auditRow = await withPgClient((client) =>
    client.query(
      `SELECT action, after_state FROM admin_actions WHERE target_id = $1::uuid AND action = 'transfer_owner'`,
      [listingId]
    )
  );
  expect(auditRow.rows).toHaveLength(1);
  const afterState = auditRow.rows[0]?.after_state as { leads_moved?: number } | undefined;
  expect(afterState?.leads_moved).toBe(1);

  // The transferred-to account was created by the transfer and already holds
  // the owner role (admin-listing-transfer.service.ts inserts it directly),
  // so an OTP login for that number lands in the owner dashboard holding the
  // listing.
  const newOwner = await loginWithOtp(request, newOwnerPhone);
  await setSessionOnPage(page, newOwner);
  await page.goto("/en/owner/listings");
  await expect(page.getByText(title)).toBeVisible();
});
