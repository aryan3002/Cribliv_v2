// apps/web/tests/admin-pg-transfer.spec.ts
//
// Admin PG-ownership transfer E2E: an admin opens a seeded PG in the PG
// Listings tab, hands the whole PG to a brand-new operator by phone from the
// Owner tab, and every table that binds a PG to a person moves in the same
// transaction.
//
// This is the PG sibling of admin-listing-transfer.spec.ts (flat/house). It
// exists because a PG binds to its operator through FOUR columns across three
// tables, not one:
//   - pg_listings.operator_user_id  — the aggregate head (edit/publish/status)
//   - pg_properties.operator_id     — the container (rooms, beds, tenants,
//                                     maintenance, and the live tenant ->
//                                     operator phone lookup)
//   - listings.owner_user_id        — the public read projection (1:1 on id)
//   - listings.contact_phone_encrypted — the number a paid unlock hands out
// Move one without the others and the PG is half-transferred: a new operator
// who cannot edit their own listing, or a dashboard that shows them while
// tenants still get the previous operator's number. The single SQL assertion
// below checks all four land on the same new user — it is the point of this
// spec, and the check that fails if a future refactor drops one table from
// AdminPgTransferService's transaction while leaving the others intact.
//
// What the UI assertion does and does NOT prove: the Owner tab's phone comes
// from `JOIN users u ON u.id = pl.operator_user_id`
// (pg-admin-properties.service.ts's getListing) — it reads the pg_listings
// head and nothing else. It would still pass if pg_properties.operator_id and
// the projection silently stopped moving. Only the SQL below covers those.
//
// Requires a live Postgres: AdminPgTransferService is DB-only by design (it
// throws db_disabled without one — AppStateService has no pg_listings model),
// so this self-skips rather than asserting a weaker in-memory behaviour.
//
// SAFETY: this spec seeds and deletes real rows (users, pg_properties,
// pg_listings, listings, leads). Every phone it touches is generated fresh
// per run — never a literal, so a stray DATABASE_URL can never make it delete
// a real person's account — and all mutation additionally requires
// dbMutationAllowed() below: either E2E_ALLOW_DB_MUTATION=1, or DATABASE_URL's
// own database name contains "test" or "local". Anything else is refused
// rather than guessed at. Same guard, same reasoning, as the SAFETY note at
// the top of admin-listing-transfer.spec.ts — read that one for the incident
// it came out of.
//
// The helpers below (loadPgFromApi / withPgClient / dbMutationAllowed /
// escapeRegExp / toTypedPhone / deleteUserAndDependents) are copied verbatim
// from admin-listing-transfer.spec.ts rather than re-invented. They are
// module-local there; extracting them into tests/utils/ would mean editing
// that passing spec, which is out of scope for this change.
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { loginAsRole, setSessionOnPage } from "./utils/auth";

/**
 * Fresh, never-seeded numbers, generated per run. Each role gets its own
 * prefix so a collision between the three is structurally impossible rather
 * than merely unlikely — and all three are disjoint from
 * admin-listing-transfer.spec.ts's "+9196"/"+9197" and from utils/auth.ts's
 * seeded "+91999999990X" accounts.
 *
 * The subscriber part must start 6-9 to survive normalizeIndianPhone
 * (phone.util.ts) — "93"/"94"/"95" all do.
 */
function randPhone(prefix: "93" | "94" | "95"): string {
  return `+91${prefix}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

/**
 * The digits a worker would type into the transfer modal's phone field for a
 * given E.164 number: no "+91", grouped 5+5 (matches the modal's own
 * placeholder style, e.g. "12345 67890").
 */
function toTypedPhone(e164: string): string {
  return `${e164.slice(3, 8)} ${e164.slice(8)}`;
}

// NOTE: no toDisplayPhone() here, unlike the flat/house spec. HomeOwnerTab
// runs the phone through formatPhone(); the PG OwnerSection renders
// detail.owner.phone (= users.phone_e164) verbatim, so the raw E.164 string
// is what lands in the DOM.

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
 * apps/web has no dependency on `pg`. Reuse @cribliv/api's install the same
 * way admin-listing-transfer.spec.ts and data/seeds/seed.ts do, instead of
 * adding a devDependency to apps/web just for fixture setup and assertions.
 */
function loadPgFromApi(): MinimalPgModule {
  const apiPackageJson = path.resolve(__dirname, "../../api/package.json");
  const requireFromApi = createRequire(apiPackageJson);
  return requireFromApi("pg") as MinimalPgModule;
}

/** Opens one direct Postgres connection for the duration of `fn`, then closes it. */
async function withPgClient<T>(fn: (client: MinimalPgClient) => Promise<T>): Promise<T> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "admin-pg-transfer.spec.ts needs DATABASE_URL set (the same Postgres the API " +
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
 * Whether this spec may run its mutating SQL against whatever DATABASE_URL
 * points to. True when E2E_ALLOW_DB_MUTATION=1 is set, or when DATABASE_URL's
 * own database name self-identifies as non-production ("test"/"local").
 * False otherwise, INCLUDING when DATABASE_URL fails to parse — an
 * unparseable connection string is not a green light.
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

interface SeededPg {
  listingId: string;
  propertyId: string;
  operatorUserId: string;
  tenantUserId: string;
}

/**
 * Seeds one whole PG aggregate by hand: an operator, a pg_properties
 * container, the pg_listings head, and the `listings` read projection that
 * shares the head's id (1:1 since migration 0032 — see
 * pg-listing.service.ts's projectToListings, which this mirrors).
 *
 * Direct SQL rather than an HTTP flow because there is no admin "create PG"
 * endpoint, and the operator-side wizard needs photos, room types and a
 * publish/review round trip to reach a listable state — none of which this
 * spec is testing.
 *
 * The row has to survive the PG Listings tab's DEFAULT filters to be
 * clickable: verification 'verified' (read from the projection —
 * PG_VERIFICATION_SQL coalesces listings.verification_status first, which is
 * why the head stays 'unverified' here, exactly as production rows look) and
 * pg_listings.status 'active'.
 *
 * listing_locations is deliberately NOT seeded: the admin list and detail read
 * locality/city through pg_properties, nothing under test touches the
 * projection's location, and every un-seeded row is one less thing for
 * teardown to get wrong.
 *
 * Records each id into `created` AS IT LANDS rather than only returning them
 * at the end: a throw partway through (a schema change, a constraint) would
 * otherwise leave teardown blind to the rows that did land, and the
 * projection's owner_user_id -> users edge is NO ACTION, so an unknown
 * listings row makes the users DELETE fail rather than just leaking.
 */
async function seedPgListing(
  title: string,
  operatorPhone: string,
  tenantPhone: string
): Promise<SeededPg> {
  return withPgClient(async (client) => {
    const city = await client.query(`SELECT id FROM cities WHERE slug = 'delhi' LIMIT 1`);
    const cityId = city.rows[0]?.id;
    if (cityId == null) {
      throw new Error("no 'delhi' city row — run `pnpm db:seed` against this database first");
    }

    const operator = await client.query(
      `INSERT INTO users (phone_e164, role, preferred_language, full_name)
       VALUES ($1, 'pg_operator', 'en', 'Seeded PG Operator')
       RETURNING id::text AS id`,
      [operatorPhone]
    );
    const operatorUserId = String(operator.rows[0].id);

    const property = await client.query(
      `INSERT INTO pg_properties (operator_id, display_name, city_id, is_primary)
       VALUES ($1::uuid, $2, $3, true)
       RETURNING id::text AS id`,
      [operatorUserId, `${title} Property`, cityId]
    );
    const propertyId = String(property.rows[0].id);
    created.propertyId = propertyId;

    const head = await client.query(
      // pg_listings.id carries no DEFAULT (the head is always created with an
      // id minted by the caller, so the projection can reuse it) — generate one.
      `INSERT INTO pg_listings
         (id, operator_user_id, pg_property_id, title, starting_rent_paise, status, verification_status)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3, 1200000, 'active', 'unverified')
       RETURNING id::text AS id`,
      [operatorUserId, propertyId, title]
    );
    const listingId = String(head.rows[0].id);
    created.listingId = listingId;

    // Same id as the head — the projection is 1:1 on id, and every read path
    // (search, maps, contact unlock) joins them on that assumption.
    // whatsapp_available seeded TRUE here (the OLD operator), deliberately
    // different from the new operator's default FALSE (users.whatsapp_opt_in
    // defaults false — infra/migrations/0001_init.sql:160, and the transfer
    // never sets it explicitly). If old and new both started false, a bug
    // that carried the previous operator's value over instead of sourcing the
    // target's own (admin-pg-transfer.service.ts:198) would be invisible: the
    // column would read false before and after either way.
    await client.query(
      `INSERT INTO listings
         (id, owner_user_id, listing_type, title_en, status, verification_status,
          monthly_rent, pg_property_id, contact_phone_encrypted, whatsapp_available)
       VALUES ($1::uuid, $2::uuid, 'pg', $3, 'active', 'verified', 12000, $4::uuid, $5, true)`,
      [listingId, operatorUserId, title, propertyId, operatorPhone]
    );

    const tenant = await client.query(
      `INSERT INTO users (phone_e164, role, preferred_language)
       VALUES ($1, 'tenant', 'en')
       RETURNING id::text AS id`,
      [tenantPhone]
    );
    const tenantUserId = String(tenant.rows[0].id);

    // One pre-existing lead, so the transfer has something to carry over and
    // leads_moved is not trivially 0.
    await client.query(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, status, access_state)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'new', 'free')`,
      [listingId, operatorUserId, tenantUserId]
    );

    return { listingId, propertyId, operatorUserId, tenantUserId };
  });
}

/**
 * Deletes every row this spec could have created for one phone number's
 * account (a NO-OP where that table has nothing for it). Copied from
 * admin-listing-transfer.spec.ts: sessions, idempotency_keys, wallets and
 * wallet_transactions all reference users with NO ACTION, so they must go
 * before the users row itself. Only ever matches by exact phone — never the
 * seeded owner/admin/operator fixtures.
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

/** What this test creates, tracked so teardown can remove it even after a mid-test failure. */
const created: {
  listingId?: string;
  propertyId?: string;
  operatorPhone?: string;
  newOperatorPhone?: string;
  tenantPhone?: string;
} = {};

test.afterAll(async () => {
  if (!process.env.DATABASE_URL) return; // matches the test's own skip guard — nothing was created.
  const { listingId, propertyId, operatorPhone, newOperatorPhone, tenantPhone } = created;
  // Nothing was seeded (the test skipped before its first insert), so there is
  // nothing to clean up and no reason to warn about the guard below.
  if (!listingId && !propertyId && !operatorPhone && !newOperatorPhone && !tenantPhone) return;
  if (!dbMutationAllowed()) {
    // Loud, not silent, and definitely not a delete: the test should already
    // have skipped, so reaching here means DATABASE_URL points somewhere this
    // spec refuses to guess about. Leave every row in place.
    // eslint-disable-next-line no-console
    console.error(
      "[admin-pg-transfer.spec.ts] afterAll: refusing to run cleanup DELETEs. " +
        "DATABASE_URL is set but neither E2E_ALLOW_DB_MUTATION=1 is set nor does its " +
        "database name contain 'test' or 'local'. Any rows this run created were left in place — " +
        "see the SAFETY note at the top of this file."
    );
    return;
  }
  await withPgClient(async (client) => {
    // Children before parents, verified against this schema's FK graph:
    //   leads.listing_id -> listings (CASCADE, but leads.owner_user_id /
    //     tenant_user_id -> users are NO ACTION, so the lead must go before
    //     either user row).
    //   admin_actions.target_id is a bare uuid (polymorphic target_type), no
    //     FK — safe anytime; admin_actions.admin_user_id points at the seeded
    //     admin, which this never deletes.
    //   listings.pg_property_id -> pg_properties is SET NULL and
    //     listings.owner_user_id -> users is NO ACTION, so the projection must
    //     go before both the property and the users.
    //   pg_listings.pg_property_id -> pg_properties is CASCADE; deleted
    //     explicitly anyway so the order is readable rather than implied.
    if (listingId) {
      await client.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
      await client.query(
        `DELETE FROM admin_actions WHERE target_id = $1::uuid AND target_type = 'listing'`,
        [listingId]
      );
      await client.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
      await client.query(`DELETE FROM pg_listings WHERE id = $1::uuid`, [listingId]);
    }
    if (propertyId) {
      await client.query(`DELETE FROM pg_properties WHERE id = $1::uuid`, [propertyId]);
    }
    for (const phone of [newOperatorPhone, operatorPhone, tenantPhone]) {
      if (phone) await deleteUserAndDependents(client, phone);
    }
  });
});

test("admin transfers a PG and every ownership column moves together", async ({
  page,
  request
}) => {
  test.skip(
    !process.env.DATABASE_URL,
    "requires a live Postgres — AdminPgTransferService is DB-only (it throws db_disabled " +
      "without one). Set DATABASE_URL to the same database the API server under test is using."
  );
  test.skip(
    !dbMutationAllowed(),
    "refusing to run: this spec creates and deletes real rows (users, pg_properties, " +
      "pg_listings, listings, leads). Point DATABASE_URL at a database whose name contains " +
      "'test' or 'local', or set E2E_ALLOW_DB_MUTATION=1 to confirm the current one is safe " +
      "to mutate — see the SAFETY note at the top of this file."
  );

  // Generated first and recorded before any `await` that could throw, so
  // teardown knows which (fake, freshly-minted) numbers to clean up even if
  // the seed itself fails halfway.
  const operatorPhone = randPhone("94");
  const tenantPhone = randPhone("93");
  const newOperatorPhone = randPhone("95");
  created.operatorPhone = operatorPhone;
  created.tenantPhone = tenantPhone;
  created.newOperatorPhone = newOperatorPhone;

  const title = `PG Transfer E2E ${Date.now()}`;
  // seedPgListing records the listing and property ids into `created` itself,
  // row by row, so a partial seed is still fully cleaned up.
  const seeded = await seedPgListing(title, operatorPhone, tenantPhone);

  const admin = await loginAsRole(request, "admin");
  await setSessionOnPage(page, admin);

  await page.goto("/en/admin");
  const adminNav = page.getByRole("navigation", { name: /admin navigation/i });
  await adminNav.getByRole("button", { name: "PG Listings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "PG Listings" })).toBeVisible();

  // Narrow to the PG this test just seeded — sidesteps pagination and default
  // sort ordering against whatever else is already in the database.
  await page.getByLabel("Search PG listings").fill(title);
  const row = page.getByRole("row", { name: new RegExp(escapeRegExp(title)) });
  await expect(row).toBeVisible();
  // Click the title cell, not the row's centre: the row carries icon-only
  // buttons (copy public URL / open public page) that would swallow the click.
  await row.getByText(title, { exact: true }).click();

  await page.getByRole("button", { name: "Owner", exact: true }).click();
  await expect(page.getByText(operatorPhone)).toBeVisible();

  await page.getByRole("button", { name: "Transfer ownership", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /transfer ownership/i });
  await dialog.getByLabel(/operator's phone/i).fill(toTypedPhone(newOperatorPhone));
  await dialog.getByLabel(/operator's name/i).fill("New PG Operator");
  await dialog.getByRole("button", { name: "Transfer ownership", exact: true }).click();

  // The Owner tab refetches in place (PgListingDetail's onTransferred calls
  // refetchDetail, so the tab is not reset). NOTE: this resolves through
  // pg_listings.operator_user_id only — the other three columns are asserted
  // directly below.
  await expect(dialog).toBeHidden();
  await expect(page.getByText(newOperatorPhone)).toBeVisible();
  await expect(page.getByText("New PG Operator")).toBeVisible();

  const newOperator = await withPgClient((client) =>
    client.query(`SELECT id::text AS id FROM users WHERE phone_e164 = $1`, [newOperatorPhone])
  );
  expect(newOperator.rows).toHaveLength(1);
  const newOperatorUserId = String(newOperator.rows[0].id);
  expect(newOperatorUserId).not.toBe(seeded.operatorUserId);

  // THE load-bearing assertion. All four ownership columns must land on the
  // same new user: this is what fails if a future refactor drops one table
  // from AdminPgTransferService's transaction while leaving the others intact.
  const rows = await withPgClient((client) =>
    client.query(
      `SELECT pl.operator_user_id::text AS head_operator,
              pp.operator_id::text      AS property_operator,
              l.contact_phone_encrypted AS projection_phone,
              l.owner_user_id::text     AS projection_owner,
              l.whatsapp_available      AS projection_whatsapp
         FROM pg_listings pl
         JOIN listings l ON l.id = pl.id
         LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
        WHERE pl.id = $1::uuid`,
      [seeded.listingId]
    )
  );
  expect(rows.rows).toHaveLength(1);
  const row0 = rows.rows[0];
  expect(row0.head_operator).toBe(newOperatorUserId);
  expect(row0.property_operator).toBe(newOperatorUserId);
  expect(row0.projection_owner).toBe(newOperatorUserId);
  expect(row0.projection_phone).toBe(newOperatorPhone);
  // Seeded true on the OLD operator (above); must now read false, sourced
  // from the NEW operator's own whatsapp_opt_in (defaults false), never
  // carried over from the operator being replaced.
  expect(row0.projection_whatsapp).toBe(false);

  // The pre-existing lead moved with the PG and is stamped transferred_at, so
  // it does not consume the new operator's free-lead allowance
  // (admin-pg-transfer.service.ts step 4/6, leads.service.ts).
  const leadRow = await withPgClient((client) =>
    client.query(
      `SELECT owner_user_id::text AS owner_user_id, transferred_at
         FROM leads WHERE listing_id = $1::uuid`,
      [seeded.listingId]
    )
  );
  expect(leadRow.rows).toHaveLength(1);
  expect(leadRow.rows[0].owner_user_id).toBe(newOperatorUserId);
  expect(leadRow.rows[0].transferred_at).not.toBeNull();

  // The transfer is audited, and the audit row's own leads_moved count matches
  // the one lead this fixture seeded.
  const auditRow = await withPgClient((client) =>
    client.query(
      `SELECT after_state FROM admin_actions
        WHERE target_id = $1::uuid AND action = 'transfer_owner'`,
      [seeded.listingId]
    )
  );
  expect(auditRow.rows).toHaveLength(1);
  const afterState = auditRow.rows[0].after_state as
    | { leads_moved?: number; listing_type?: string }
    | undefined;
  expect(afterState?.leads_moved).toBe(1);
  expect(afterState?.listing_type).toBe("pg");
});
