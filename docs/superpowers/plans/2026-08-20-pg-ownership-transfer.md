# PG Listing Ownership Transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin transfer a whole PG — listing head, property container, public projection, leads, and operator-stamped ops rows — to a different phone number from the PG listing's Owner tab.

**Architecture:** A new `AdminPgTransferService` performs a single Postgres transaction that re-points three ownership columns plus three denormalized operator stamps. A new `POST /admin/pg/listings/:id/transfer` route sits beside the other PG admin endpoints. The existing flat/house `AdminListingTransferService` is not modified except for one stale error message.

**Tech Stack:** NestJS 10 (API), Next.js 14 App Router (web), Postgres, Vitest (unit), Playwright (e2e), pnpm workspaces + Turborepo.

**Spec:** `docs/superpowers/specs/2026-08-20-pg-ownership-transfer-design.md`

## Global Constraints

- **Branch:** `feat/admin-pg-transfer`. Never commit to `master`. Each task ends with a passing test run **and** a commit on this branch; the human reviews and merges the branch as a whole.
- **No new migration.** `transferred_at` and the `transfer_owner` enum value both already exist from `infra/migrations/0069_listing_owner_transfer.sql`. Do not add a migration file.
- **Do not edit the flat/house transfer path** (`admin-listing-transfer.service.ts`) beyond the two `pg_not_supported` message strings in Task 2. It is live and e2e-covered.
- **TypeScript strict mode.** No `any` in new code except the test-harness `database` mock, which the existing sibling test already casts (`admin-listing-transfer.service.test.ts:50`).
- **Phone validation is server-side only.** The modal must not re-implement `normalizeIndianPhone`; it posts raw input and renders the server's error. This is deliberate — see `TransferOwnerModal.tsx:32-38`.
- **Error codes, verbatim:** `invalid_phone`, `listing_not_found`, `cannot_transfer_to_admin`, `target_blocked`, `target_is_owner`, `db_disabled`.
- **`target_is_owner` message, verbatim:** `"That number belongs to a flat/house owner account. Change their role first, or use a different number."`

---

### Task 1: `AdminPgTransferService` — the transaction

**Files:**

- Create: `apps/api/src/modules/admin/admin-pg-transfer.service.ts`
- Test: `apps/api/src/modules/admin/__tests__/admin-pg-transfer.service.test.ts`

**Interfaces:**

- Consumes: `normalizeIndianPhone` from `./phone.util`; `DatabaseService` from `../../common/database.service`.
- Produces: `AdminPgTransferService.transferOperator(input: PgTransferInput): Promise<PgTransferResult>`, where
  `PgTransferInput = { listingId: string; phoneE164: string; fullName?: string; adminUserId: string }` and
  `PgTransferResult = { listing_id: string; operator_user_id: string; operator_phone: string; leads_moved: number; already_owned: boolean }`.
  Task 2 injects this service and calls exactly this method.

- [ ] **Step 1: Write the failing test file**

Create `apps/api/src/modules/admin/__tests__/admin-pg-transfer.service.test.ts`. The mock issues queries in the service's exact order; each test asserts one branch.

```ts
import { describe, expect, it, vi } from "vitest";
import { AdminPgTransferService } from "../admin-pg-transfer.service";

const LISTING = "ad204234-4b39-4228-8b49-3b9e91113e16";
const PROPERTY = "9d1c0f22-7a4e-4c2b-9f31-0b8d4e6a1c55";
const NEW_OP = "f5b7e19c-cfaa-4926-ad3a-10be52b7c876";
const OLD_OP = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

/**
 * DB-mode uses a mocked client so these run in CI without Postgres. The service
 * issues client.query() in this order:
 *   1. BEGIN
 *   2. SELECT ... FROM pg_listings ... FOR UPDATE   (guard + current operator)
 *   3. SELECT ... FROM pg_properties ... FOR UPDATE (skipped when orphaned)
 *   4. INSERT INTO users ... ON CONFLICT            (resolve/upsert operator)
 *   5. UPDATE pg_listings SET operator_user_id
 *   6. UPDATE pg_properties SET operator_id         (skipped when orphaned)
 *   7. UPDATE listings SET owner_user_id, contact_phone_encrypted, whatsapp_available
 *   8. UPDATE leads SET owner_user_id, transferred_at
 *   9. DELETE FROM pg_analytics_overrides           (then UPDATE — order matters)
 *  10. UPDATE pg_analytics_overrides SET operator_id
 *  11. UPDATE pg_manage_requests SET operator_user_id
 *  12. INSERT INTO admin_actions
 *  13. COMMIT
 */
function makeService(overrides: {
  headRow?: Record<string, unknown> | null;
  userRow?: Record<string, unknown>;
  leadsMoved?: number;
  dbEnabled?: boolean;
}) {
  const headRow =
    overrides.headRow === undefined
      ? {
          id: LISTING,
          operator_user_id: OLD_OP,
          pg_property_id: PROPERTY,
          status: "active"
        }
      : overrides.headRow;
  const userRow = overrides.userRow ?? {
    id: NEW_OP,
    phone_e164: "+919956729103",
    role: "pg_operator",
    is_blocked: false
  };

  const query = vi.fn(async (sql: string) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/FROM pg_listings/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return { rows: headRow ? [headRow] : [], rowCount: headRow ? 1 : 0 };
    }
    if (/FROM pg_properties/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return { rows: [{ id: PROPERTY }], rowCount: 1 };
    }
    if (/INSERT INTO users/i.test(sql)) return { rows: [userRow], rowCount: 1 };
    if (/UPDATE leads/i.test(sql)) return { rows: [], rowCount: overrides.leadsMoved ?? 0 };
    return { rows: [], rowCount: 1 };
  });

  const client = { query, release: vi.fn() };
  const database = {
    isEnabled: () => overrides.dbEnabled ?? true,
    getClient: vi.fn(async () => client)
  } as unknown as ConstructorParameters<typeof AdminPgTransferService>[0];

  return { service: new AdminPgTransferService(database), query, client };
}

/** All SQL the service issued, whitespace-collapsed, in order. */
const sqlLog = (query: ReturnType<typeof vi.fn>) =>
  query.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim());

describe("AdminPgTransferService.transferOperator", () => {
  it("moves the listing head, the property, and the projection in one transaction", async () => {
    const { service, query } = makeService({});

    const result = await service.transferOperator({
      listingId: LISTING,
      phoneE164: "99567 29103",
      adminUserId: ADMIN
    });

    expect(result).toEqual({
      listing_id: LISTING,
      operator_user_id: NEW_OP,
      operator_phone: "+919956729103",
      leads_moved: 0,
      already_owned: false
    });

    const log = sqlLog(query);
    expect(log[0]).toMatch(/^BEGIN/i);
    expect(log.at(-1)).toMatch(/^COMMIT/i);
    expect(log.some((s) => /UPDATE pg_listings SET operator_user_id/i.test(s))).toBe(true);
    expect(log.some((s) => /UPDATE pg_properties SET operator_id/i.test(s))).toBe(true);
    // The load-bearing one: all three projection columns move together.
    const projection = log.find((s) => /^UPDATE listings/i.test(s));
    expect(projection).toBeDefined();
    expect(projection).toMatch(/owner_user_id/);
    expect(projection).toMatch(/contact_phone_encrypted/);
    expect(projection).toMatch(/whatsapp_available/);
  });

  it("sources whatsapp_available from the target, never the previous operator", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    const projection = sqlLog(query).find((s) => /^UPDATE listings/i.test(s))!;
    expect(projection).toMatch(
      /whatsapp_available = \(SELECT whatsapp_opt_in FROM users WHERE id = \$2::uuid\)/i
    );
  });

  it("stamps transferred_at on inherited leads so they skip the free allowance", async () => {
    const { service, query } = makeService({ leadsMoved: 3 });
    const result = await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    expect(result.leads_moved).toBe(3);
    const leads = sqlLog(query).find((s) => /^UPDATE leads/i.test(s))!;
    expect(leads).toMatch(/transferred_at = now\(\)/i);
    expect(leads).toMatch(/owner_user_id <> \$2::uuid/i);
  });

  it("deletes a colliding override row BEFORE re-pointing (uq_pg_override_listing)", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    const log = sqlLog(query);
    const del = log.findIndex((s) => /DELETE FROM pg_analytics_overrides/i.test(s));
    const upd = log.findIndex((s) => /UPDATE pg_analytics_overrides/i.test(s));
    expect(del).toBeGreaterThan(-1);
    expect(upd).toBeGreaterThan(del);
  });

  it("re-points pg_manage_requests so the admin queue names the new operator", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });
    expect(
      sqlLog(query).some((s) => /UPDATE pg_manage_requests SET operator_user_id/i.test(s))
    ).toBe(true);
  });

  it("leaves operator-global overrides with the previous operator", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    // Both override statements must be scoped by listing_id; a statement that
    // touched listing_id IS NULL rows would drag the operator-global cut along.
    for (const s of sqlLog(query).filter((x) => /pg_analytics_overrides/i.test(x))) {
      expect(s).toMatch(/listing_id = \$1::uuid/i);
    }
  });

  it("transfers a legacy orphan (pg_property_id IS NULL) and skips the property update", async () => {
    const { service, query } = makeService({
      headRow: { id: LISTING, operator_user_id: OLD_OP, pg_property_id: null, status: "draft" }
    });

    const result = await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    expect(result.already_owned).toBe(false);
    const log = sqlLog(query);
    expect(log.some((s) => /UPDATE pg_listings SET operator_user_id/i.test(s))).toBe(true);
    expect(log.some((s) => /pg_properties/i.test(s))).toBe(false);
  });

  it("returns already_owned without writing when the number already owns it", async () => {
    const { service, query } = makeService({
      userRow: { id: OLD_OP, phone_e164: "+919956729103", role: "pg_operator", is_blocked: false }
    });

    const result = await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      adminUserId: ADMIN
    });

    expect(result.already_owned).toBe(true);
    expect(result.leads_moved).toBe(0);
    expect(sqlLog(query).some((s) => /^UPDATE /i.test(s))).toBe(false);
  });

  it("promotes a tenant to pg_operator and never downgrades anyone else", async () => {
    const { service, query } = makeService({});
    await service.transferOperator({
      listingId: LISTING,
      phoneE164: "9956729103",
      fullName: "Ravi",
      adminUserId: ADMIN
    });

    const upsert = sqlLog(query).find((s) => /INSERT INTO users/i.test(s))!;
    expect(upsert).toMatch(
      /role = CASE WHEN users\.role = 'tenant' THEN 'pg_operator'::user_role ELSE users\.role END/i
    );
    expect(upsert).toMatch(
      /full_name = COALESCE\(NULLIF\(users\.full_name, ''\), EXCLUDED\.full_name\)/i
    );
  });

  it("rejects an unparseable phone before opening a transaction", async () => {
    const { service, client } = makeService({});
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "12345", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "invalid_phone" } });
    expect(client.query).not.toHaveBeenCalled();
  });

  it("404s when the PG listing does not exist", async () => {
    const { service } = makeService({ headRow: null });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "listing_not_found" } });
  });

  it("refuses an admin account", async () => {
    const { service } = makeService({
      userRow: { id: NEW_OP, phone_e164: "+919956729103", role: "admin", is_blocked: false }
    });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "cannot_transfer_to_admin" } });
  });

  it("refuses an existing flat/house owner — roles are exclusive in middleware", async () => {
    const { service } = makeService({
      userRow: { id: NEW_OP, phone_e164: "+919956729103", role: "owner", is_blocked: false }
    });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "target_is_owner" } });
  });

  it("refuses a blocked account", async () => {
    const { service } = makeService({
      userRow: { id: NEW_OP, phone_e164: "+919956729103", role: "pg_operator", is_blocked: true }
    });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "target_blocked" } });
  });

  it("rolls back when a write fails mid-transaction", async () => {
    const { service, query, client } = makeService({});
    query.mockImplementation(async (sql: string) => {
      if (/^\s*(BEGIN|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM pg_listings/i.test(sql)) {
        return {
          rows: [
            { id: LISTING, operator_user_id: OLD_OP, pg_property_id: PROPERTY, status: "active" }
          ],
          rowCount: 1
        };
      }
      if (/FROM pg_properties/i.test(sql)) return { rows: [{ id: PROPERTY }], rowCount: 1 };
      if (/INSERT INTO users/i.test(sql)) {
        return {
          rows: [
            { id: NEW_OP, phone_e164: "+919956729103", role: "pg_operator", is_blocked: false }
          ],
          rowCount: 1
        };
      }
      if (/UPDATE pg_listings/i.test(sql)) throw new Error("boom");
      return { rows: [], rowCount: 1 };
    });

    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toThrow("boom");
    expect(sqlLog(query).some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it("refuses to run without a database", async () => {
    const { service } = makeService({ dbEnabled: false });
    await expect(
      service.transferOperator({ listingId: LISTING, phoneE164: "9956729103", adminUserId: ADMIN })
    ).rejects.toMatchObject({ response: { code: "db_disabled" } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm --filter @cribliv/api test -- admin-pg-transfer.service
```

Expected: FAIL — `Failed to resolve import "../admin-pg-transfer.service"`.

- [ ] **Step 3: Write the service**

Create `apps/api/src/modules/admin/admin-pg-transfer.service.ts`:

```ts
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { normalizeIndianPhone } from "./phone.util";

export interface PgTransferResult {
  listing_id: string;
  operator_user_id: string;
  operator_phone: string;
  leads_moved: number;
  already_owned: boolean;
}

export interface PgTransferInput {
  listingId: string;
  phoneE164: string;
  fullName?: string;
  adminUserId: string;
}

/**
 * The single place a PG ever changes hands.
 *
 * A flat/house listing binds to a person through ONE column; a PG binds through
 * three, and each gates something different:
 *   - `pg_listings.operator_user_id` — the PG aggregate head: listing edit,
 *     publish, status (pg-listing.service.ts:536, :589, :640).
 *   - `pg_properties.operator_id` — the property container: maintenance
 *     (pg-maintenance.service.ts:564), occupancy (pg-occupancy.service.ts:131),
 *     bed assignment, layout, AND the live tenant -> operator phone lookup
 *     (pg-residence.service.ts:146).
 *   - the `listings` projection (same id, 1:1) — `owner_user_id`,
 *     `contact_phone_encrypted` (the number a tenant receives on unlock,
 *     contacts.service.ts:305) and `whatsapp_available`.
 * Move one without the others and the PG is half-transferred: the new operator
 * sees a listing they cannot edit, or the dashboard shows them while paid
 * unlocks still hand out the previous operator's number.
 *
 * Three further tables carry a DENORMALIZED operator stamp that would otherwise
 * go stale — leads, listing-scoped pg_analytics_overrides, and
 * pg_manage_requests. They move too; see the inline notes at each write.
 *
 * Audited to `admin_actions` (action='transfer_owner', enum value added by
 * migration 0069 — this service needs no migration of its own).
 *
 * DB-only by design: AppStateService has no pg_listings model (only a loose
 * pgProperties map at app-state.service.ts:903), and the sibling admin PG
 * service already throws db_disabled without a database
 * (pg-admin-properties.service.ts:247). A deliberate, documented departure from
 * the CLAUDE.md dual-mode rule, consistent with every other PG admin service.
 */
@Injectable()
export class AdminPgTransferService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async transferOperator(input: PgTransferInput): Promise<PgTransferResult> {
    const phone = normalizeIndianPhone(input.phoneE164);
    if (!phone) {
      throw new BadRequestException({
        code: "invalid_phone",
        message: "Enter a valid Indian mobile number"
      });
    }

    const fullName = input.fullName?.trim() || null;

    if (!this.database.isEnabled()) {
      throw new NotFoundException({
        code: "db_disabled",
        message: "PG transfer requires a database"
      });
    }

    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      // FOR UPDATE so two admins transferring the same PG serialise rather than
      // racing to a lost update. Lock order is always head-then-property.
      const head = await client.query<{
        id: string;
        operator_user_id: string;
        pg_property_id: string | null;
        status: string;
      }>(
        `SELECT id::text, operator_user_id::text, pg_property_id::text, status::text
           FROM pg_listings
          WHERE id = $1::uuid
          FOR UPDATE`,
        [input.listingId]
      );

      if (!head.rowCount || !head.rows[0]) {
        throw new NotFoundException({
          code: "listing_not_found",
          message: "PG listing not found"
        });
      }

      const current = head.rows[0];

      // Migration 0033:20 relaxed pg_property_id to nullable for legacy orphans.
      // Those listings still transfer — there is simply no container to move.
      if (current.pg_property_id) {
        await client.query(`SELECT id FROM pg_properties WHERE id = $1::uuid FOR UPDATE`, [
          current.pg_property_id
        ]);
      }

      // Upsert the operator by phone. Promote tenant -> pg_operator; never
      // downgrade an existing owner/pg_operator/admin (those survive unchanged
      // and are rejected below); never overwrite a name the user set themselves.
      const operator = await client.query<{
        id: string;
        phone_e164: string;
        role: string;
        is_blocked: boolean;
      }>(
        `INSERT INTO users (phone_e164, role, preferred_language, full_name)
         VALUES ($1, 'pg_operator', 'en', $2)
         ON CONFLICT (phone_e164) DO UPDATE
           SET role = CASE WHEN users.role = 'tenant' THEN 'pg_operator'::user_role ELSE users.role END,
               full_name = COALESCE(NULLIF(users.full_name, ''), EXCLUDED.full_name),
               updated_at = now()
         RETURNING id::text, phone_e164, role::text, is_blocked`,
        [phone, fullName]
      );

      const target = operator.rows[0];

      // An admin is blocked from /pg-operator/* by middleware.ts:29, so it could
      // never manage the PG it was handed.
      if (target.role === "admin") {
        throw new BadRequestException({
          code: "cannot_transfer_to_admin",
          message: "That number belongs to an admin account"
        });
      }
      // Roles are mutually exclusive on the web: middleware.ts:27-34 admits only
      // `owner` to /owner/* and only `pg_operator` to /pg-operator/*. Promoting
      // an owner would silently lock them out of their own flat dashboard, so
      // this is a refusal, not a promotion — matching auth.service.ts:782's
      // "contact admin to change" stance on self-service role switches.
      if (target.role === "owner") {
        throw new BadRequestException({
          code: "target_is_owner",
          message:
            "That number belongs to a flat/house owner account. Change their role first, or use a different number."
        });
      }
      if (target.is_blocked) {
        throw new BadRequestException({
          code: "target_blocked",
          message: "That account is blocked"
        });
      }

      if (target.id === current.operator_user_id) {
        await client.query("COMMIT");
        return {
          listing_id: current.id,
          operator_user_id: target.id,
          operator_phone: target.phone_e164,
          leads_moved: 0,
          already_owned: true
        };
      }

      // 1/6 — the PG aggregate head.
      await client.query(
        `UPDATE pg_listings
            SET operator_user_id = $2::uuid,
                updated_at = now()
          WHERE id = $1::uuid`,
        [current.id, target.id]
      );

      // 2/6 — the property container. 1 listing : 1 property since migration
      // 0041, so this never steals a property from another live listing.
      if (current.pg_property_id) {
        await client.query(
          `UPDATE pg_properties
              SET operator_id = $2::uuid,
                  updated_at = now()
            WHERE id = $1::uuid`,
          [current.pg_property_id, target.id]
        );
      }

      // 3/6 — the public read projection. whatsapp_available is sourced from the
      // TARGET's own opt-in, never carried over: it drives the WhatsApp CTA a
      // tenant sees after paying, so inheriting the previous operator's value
      // would promise WhatsApp for someone who never opted in. Mirrors
      // admin-listing-transfer.service.ts:158 and pg-listing.service.ts:349.
      await client.query(
        `UPDATE listings
            SET owner_user_id = $2::uuid,
                contact_phone_encrypted = $3,
                whatsapp_available = (SELECT whatsapp_opt_in FROM users WHERE id = $2::uuid),
                updated_at = now()
          WHERE id = $1::uuid`,
        [current.id, target.id, target.phone_e164]
      );

      // 4/6 — leads carry a denormalised owner_user_id stamped at creation, so
      // they do not follow the listing on their own. transferred_at marks them
      // inherited so they do not consume the new operator's free-lead allowance
      // (leads.service.ts:115).
      const leads = await client.query(
        `UPDATE leads
            SET owner_user_id = $2::uuid,
                transferred_at = now(),
                updated_at = now()
          WHERE listing_id = $1::uuid
            AND owner_user_id <> $2::uuid`,
        [current.id, target.id]
      );

      // 5/6 — listing-scoped analytics cuts follow the listing they were aimed
      // at; operator-GLOBAL rows (listing_id IS NULL) deliberately stay with the
      // previous operator, being a judgement about the person.
      //
      // DELETE first: uq_pg_override_listing is UNIQUE(operator_id, listing_id)
      // (migration 0038:22), so a blind UPDATE raises 23505 when the target
      // already holds a row for this listing — reachable by transferring a PG
      // away and later back.
      await client.query(
        `DELETE FROM pg_analytics_overrides
           WHERE listing_id = $1::uuid AND operator_id = $2::uuid`,
        [current.id, target.id]
      );
      await client.query(
        `UPDATE pg_analytics_overrides
            SET operator_id = $2::uuid,
                updated_at = now()
          WHERE listing_id = $1::uuid`,
        [current.id, target.id]
      );

      // 6/6 — the operator's own managed-ops view already resolves live through
      // pg_listings (pg-manage-request.service.ts:144); this is so the admin
      // queue's JOIN on r.operator_user_id (:173) stops naming the previous
      // operator. Its unique indexes key on listing_id alone (0060:29, :31), so
      // this cannot collide.
      await client.query(
        `UPDATE pg_manage_requests
            SET operator_user_id = $2::uuid,
                updated_at = now()
          WHERE listing_id = $1::uuid`,
        [current.id, target.id]
      );

      await client.query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, before_state, after_state)
         VALUES ($1::uuid, 'listing', $2::uuid, 'transfer_owner', $3::jsonb, $4::jsonb)`,
        [
          input.adminUserId,
          current.id,
          JSON.stringify({
            from_user_id: current.operator_user_id,
            status: current.status,
            pg_property_id: current.pg_property_id
          }),
          JSON.stringify({
            to_user_id: target.id,
            to_phone: target.phone_e164,
            leads_moved: leads.rowCount ?? 0,
            listing_type: "pg"
          })
        ]
      );

      await client.query("COMMIT");

      return {
        listing_id: current.id,
        operator_user_id: target.id,
        operator_phone: target.phone_e164,
        leads_moved: leads.rowCount ?? 0,
        already_owned: false
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm --filter @cribliv/api test -- admin-pg-transfer.service
```

Expected: PASS, 16 tests.

---

### Task 2: Endpoint, module wiring, and the stale flat/house message

**Files:**

- Modify: `apps/api/src/modules/admin/admin.controller.ts` (imports, constructor, new route after the `pg/listings/:id/full` route)
- Modify: `apps/api/src/modules/admin/admin.module.ts` (register the provider)
- Modify: `apps/api/src/modules/admin/admin-listing-transfer.service.ts:94` and `:228` (message only)
- Test: `apps/api/src/modules/admin/__tests__/admin-pg-transfer.controller.test.ts`

**Interfaces:**

- Consumes: `AdminPgTransferService.transferOperator` from Task 1.
- Produces: `POST /admin/pg/listings/:id/transfer`, body `{ phone_e164: string; full_name?: string }`, responding `ok({ listing_id, operator_user_id, operator_phone, leads_moved, already_owned })`. Task 3's web client calls exactly this path and reads exactly these keys.

- [ ] **Step 1: Write the failing controller test**

Create `apps/api/src/modules/admin/__tests__/admin-pg-transfer.controller.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { AdminController } from "../admin.controller";

const LISTING = "ad204234-4b39-4228-8b49-3b9e91113e16";

/**
 * AdminController has a long constructor; this test only exercises the PG
 * transfer route, so every other dependency is an empty stub. Positional
 * arguments must match the constructor order — pgTransfer is appended LAST.
 */
function makeController(transferOperator: ReturnType<typeof vi.fn>) {
  const stubs = new Array(17).fill({}) as never[];
  return new AdminController(...stubs, { transferOperator } as never);
}

describe("AdminController — POST admin/pg/listings/:id/transfer", () => {
  it("passes the body through and returns the service result", async () => {
    const transferOperator = vi.fn(async () => ({
      listing_id: LISTING,
      operator_user_id: "f5b7e19c-cfaa-4926-ad3a-10be52b7c876",
      operator_phone: "+919956729103",
      leads_moved: 2,
      already_owned: false
    }));

    const controller = makeController(transferOperator);
    const result = await controller.pgListingTransfer({ user: { id: "admin-1" } }, LISTING, {
      phone_e164: "99567 29103",
      full_name: "Ravi"
    });

    expect(transferOperator).toHaveBeenCalledWith({
      listingId: LISTING,
      phoneE164: "99567 29103",
      fullName: "Ravi",
      adminUserId: "admin-1"
    });
    expect(result).toMatchObject({ data: { leads_moved: 2, already_owned: false } });
  });

  it("forwards an omitted name as undefined rather than an empty string", async () => {
    const transferOperator = vi.fn(async () => ({
      listing_id: LISTING,
      operator_user_id: "f5b7e19c-cfaa-4926-ad3a-10be52b7c876",
      operator_phone: "+919956729103",
      leads_moved: 0,
      already_owned: true
    }));

    const controller = makeController(transferOperator);
    await controller.pgListingTransfer({ user: { id: "admin-1" } }, LISTING, {
      phone_e164: "9956729103"
    });

    expect(transferOperator).toHaveBeenCalledWith(expect.objectContaining({ fullName: undefined }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @cribliv/api test -- admin-pg-transfer.controller
```

Expected: FAIL — `controller.pgListingTransfer is not a function`.

- [ ] **Step 3: Register the provider**

In `apps/api/src/modules/admin/admin.module.ts`, add the import beside the sibling PG services:

```ts
import { AdminPgTransferService } from "./admin-pg-transfer.service";
```

and add to the `providers` array, immediately after `AdminListingTransferService`:

```ts
(AdminListingTransferService,
  // PG ownership transfer. DatabaseService-only — same local-provider
  // rationale as the other PG admin services above.
  AdminPgTransferService);
```

- [ ] **Step 4: Add the constructor injection and the route**

In `apps/api/src/modules/admin/admin.controller.ts`, add the import next to the other PG service imports:

```ts
import { AdminPgTransferService } from "./admin-pg-transfer.service";
```

Append to the constructor, **after** `@Inject(AdminReviewService) private readonly review: AdminReviewService` (append last so the positional stubs in the test stay valid):

```ts
    @Inject(AdminReviewService) private readonly review: AdminReviewService,
    @Inject(AdminPgTransferService) private readonly pgTransfer: AdminPgTransferService
  ) {}
```

Add the route immediately after the `pg/listings/:id/full` handler:

```ts
  /**
   * Hand a whole PG to its real operator, identified by phone. Creates the
   * account if the number is new. Moves the PG aggregate head, the property
   * container and the public projection together — see AdminPgTransferService
   * for why all three must move at once.
   */
  @Post("pg/listings/:id/transfer")
  async pgListingTransfer(
    @Req() req: { user: { id: string } },
    @Param("id") id: string,
    @Body() body: { phone_e164: string; full_name?: string }
  ) {
    return ok(
      await this.pgTransfer.transferOperator({
        listingId: id,
        phoneE164: body.phone_e164,
        fullName: body.full_name,
        adminUserId: req.user.id
      })
    );
  }
```

- [ ] **Step 5: Correct the now-stale flat/house message**

Migration 0041 removed the constraint that made PG transfer unsafe, and this plan adds the endpoint — so "cannot be transferred yet" is no longer true. In `apps/api/src/modules/admin/admin-listing-transfer.service.ts`, change **both** occurrences (line ~94 in the DB path and ~228 in the in-memory path) from:

```ts
message: "PG listings cannot be transferred yet";
```

to:

```ts
message: "Use POST /admin/pg/listings/:id/transfer for PG listings";
```

Leave the `pg_not_supported` code and every other line of that file untouched — it is still the correct answer for this endpoint.

- [ ] **Step 6: Run the controller test and the untouched flat/house suite**

```bash
pnpm --filter @cribliv/api test -- admin-pg-transfer.controller admin-listing-transfer
```

Expected: PASS. The flat/house suite must stay green — it asserts the `pg_not_supported` **code**, not the message.

- [ ] **Step 7: Typecheck the API**

```bash
pnpm --filter @cribliv/api typecheck
```

Expected: no errors.

---

### Task 3: Web — API client, modal, and the Owner tab button

**Files:**

- Modify: `apps/web/lib/admin-api.ts` (add `transferPgOperator` after `transferHomeOwner`)
- Create: `apps/web/components/admin/pg-properties/PgTransferOwnerModal.tsx`
- Modify: `apps/web/components/admin/pg-properties/tabs/OwnerSection.tsx`
- Modify: `apps/web/components/admin/pg-properties/useAdminPgListing.ts` (add `refetchDetail`)
- Modify: `apps/web/components/admin/pg-properties/PgListingDetail.tsx:396` (pass the new props)
- Test: `apps/web/components/admin/pg-properties/__tests__/PgTransferOwnerModal.test.tsx`

**Interfaces:**

- Consumes: `POST /admin/pg/listings/:id/transfer` from Task 2.
- Produces: `transferPgOperator(accessToken, listingId, phoneE164, fullName?) => Promise<{ operatorUserId: string; operatorPhone: string; leadsMoved: number; alreadyOwned: boolean }>`.

- [ ] **Step 1: Write the failing modal test**

Create `apps/web/components/admin/pg-properties/__tests__/PgTransferOwnerModal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PgTransferOwnerModal } from "../PgTransferOwnerModal";

const baseProps = {
  listingId: "ad204234-4b39-4228-8b49-3b9e91113e16",
  currentOwnerName: "Old Operator",
  currentOwnerPhone: "+919999999901",
  onClose: vi.fn(),
  onTransferred: vi.fn()
};

describe("PgTransferOwnerModal", () => {
  it("refuses to submit an empty phone without calling the server", async () => {
    const onTransfer = vi.fn();
    render(<PgTransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter the operator's phone number");
    expect(onTransfer).not.toHaveBeenCalled();
  });

  it("posts the raw typed phone — validation is the server's job", async () => {
    const onTransfer = vi.fn(async () => ({
      operatorUserId: "f5b7e19c-cfaa-4926-ad3a-10be52b7c876",
      operatorPhone: "+919956729103",
      leadsMoved: 0,
      alreadyOwned: false
    }));
    const onTransferred = vi.fn();
    render(
      <PgTransferOwnerModal {...baseProps} onTransfer={onTransfer} onTransferred={onTransferred} />
    );

    await userEvent.type(screen.getByLabelText(/operator's phone/i), "99567 29103");
    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    expect(onTransfer).toHaveBeenCalledWith(baseProps.listingId, "99567 29103", undefined);
    expect(onTransferred).toHaveBeenCalledWith({
      operatorPhone: "+919956729103",
      leadsMoved: 0
    });
  });

  it("renders the server's rejection instead of guessing at validity", async () => {
    const onTransfer = vi.fn(async () => {
      throw new Error(
        "That number belongs to a flat/house owner account. Change their role first, or use a different number."
      );
    });
    render(<PgTransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    await userEvent.type(screen.getByLabelText(/operator's phone/i), "9956729103");
    await userEvent.click(screen.getByRole("button", { name: "Transfer ownership" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/flat\/house owner account/i);
  });

  it("warns that tenants and ops data move with the PG", () => {
    render(<PgTransferOwnerModal {...baseProps} onTransfer={vi.fn()} />);
    expect(screen.getByText(/rooms, beds, tenants and maintenance/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm --filter @cribliv/web test -- PgTransferOwnerModal
```

Expected: FAIL — cannot resolve `../PgTransferOwnerModal`.

- [ ] **Step 3: Add the API client**

In `apps/web/lib/admin-api.ts`, immediately after the `transferHomeOwner` function:

```ts
/**
 * Hand a whole PG to its real operator, identified by phone. Unlike the
 * flat/house transfer this also moves the property container and everything
 * hanging off it (rooms, beds, tenant assignments, maintenance), because PG
 * ownership spans pg_listings, pg_properties and the listings projection.
 */
export async function transferPgOperator(
  accessToken: string,
  listingId: string,
  phoneE164: string,
  fullName?: string
): Promise<{
  operatorUserId: string;
  operatorPhone: string;
  leadsMoved: number;
  alreadyOwned: boolean;
}> {
  const response = await fetchApi<{
    operator_user_id: string;
    operator_phone: string;
    leads_moved: number;
    already_owned: boolean;
  }>(`/admin/pg/listings/${listingId}/transfer`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ phone_e164: phoneE164, full_name: fullName })
  });

  return {
    operatorUserId: response.operator_user_id,
    operatorPhone: response.operator_phone,
    leadsMoved: response.leads_moved,
    alreadyOwned: response.already_owned
  };
}
```

- [ ] **Step 4: Write the modal**

Create `apps/web/components/admin/pg-properties/PgTransferOwnerModal.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

export interface PgTransferOwnerModalProps {
  listingId: string;
  currentOwnerName: string | null;
  currentOwnerPhone: string | null;
  onClose: () => void;
  onTransferred: (result: { operatorPhone: string; leadsMoved: number }) => void;
  onTransfer: (
    listingId: string,
    phoneE164: string,
    fullName?: string
  ) => Promise<{
    operatorUserId: string;
    operatorPhone: string;
    leadsMoved: number;
    alreadyOwned: boolean;
  }>;
}

const LABEL_STYLE: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#6B7280",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.05em"
};

// The API is the single authority on what a valid phone is — this modal
// deliberately does not re-implement `normalizeIndianPhone` (phone.util.ts on
// the API side), matching TransferOwnerModal's reasoning: one round-trip on a
// typo is cheaper than two validators drifting apart. Only the empty-field case
// is caught here, since that needs no server to know it's wrong.
export function PgTransferOwnerModal({
  listingId,
  currentOwnerName,
  currentOwnerPhone,
  onClose,
  onTransferred,
  onTransfer
}: PgTransferOwnerModalProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!phone.trim()) {
      setError("Enter the operator's phone number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onTransfer(listingId, phone.trim(), name.trim() || undefined);
      onTransferred({ operatorPhone: result.operatorPhone, leadsMoved: result.leadsMoved });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transfer ownership"
        className="admin-drawer"
        style={{
          width: "min(440px, 94vw)",
          top: "50%",
          right: "50%",
          transform: "translate(50%, -50%)",
          bottom: "auto",
          borderRadius: 14
        }}
      >
        <header className="admin-drawer__head">
          <div>
            <div className="admin-drawer__title">Transfer ownership</div>
            <div className="admin-drawer__sub">
              Currently operated by {currentOwnerName ?? "an unnamed account"} (
              {currentOwnerPhone ?? "-"})
            </div>
          </div>
        </header>

        <div className="admin-drawer__body" style={{ display: "grid", gap: 12 }}>
          <div>
            <label htmlFor="pg-transfer-phone" style={LABEL_STYLE}>
              Operator&apos;s phone
            </label>
            <input
              id="pg-transfer-phone"
              className="admin-input"
              style={{ width: "100%" }}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="98765 43210"
              inputMode="tel"
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor="pg-transfer-name" style={LABEL_STYLE}>
              Operator&apos;s name (optional)
            </label>
            <input
              id="pg-transfer-name"
              className="admin-input"
              style={{ width: "100%" }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </div>

          <p style={{ fontSize: 12, color: "#6B7280", margin: 0, lineHeight: 1.6 }}>
            The whole PG moves, not just the listing: the property and everything on it — rooms,
            beds, tenants and maintenance — goes to this number, along with existing leads. Anyone
            currently living there will see the new number as their operator contact straight away.
            The new operator sees the PG after logging in with this number.
          </p>

          {error ? (
            <p
              role="alert"
              style={{
                fontSize: 12,
                color: "#B91C1C",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 6,
                padding: "6px 10px",
                margin: 0
              }}
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="admin-drawer__footer">
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "Transferring…" : "Transfer ownership"}
          </button>
        </footer>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run the modal test to verify it passes**

```bash
pnpm --filter @cribliv/web test -- PgTransferOwnerModal
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Add `refetchDetail` to the data hook**

In `apps/web/components/admin/pg-properties/useAdminPgListing.ts`, add this callback after the existing `refetchFull` definition:

```ts
// Re-read the thin detail after a mutation that changes it (ownership
// transfer). Deliberately does NOT re-fetch analytics or `full` — the Owner
// tab is the only consumer and a full reload would reset the open tab.
const refetchDetail = useCallback(async () => {
  const d = await fetchAdminPgListing(accessToken, listingId);
  setDetail(d);
}, [accessToken, listingId]);
```

and add `refetchDetail` to the returned object, after `refetchFull`:

```ts
(ensureFull, refetchFull, refetchDetail, patchFull);
```

- [ ] **Step 7: Add the button to the Owner tab**

Rewrite `apps/web/components/admin/pg-properties/tabs/OwnerSection.tsx` — keep the existing rows exactly as they are and add the button plus modal state:

```tsx
"use client";

import { useState } from "react";
import type { PgAdminListingDetail } from "@cribliv/shared-types";
import { SectionCard } from "../../primitives/SectionCard";
import { formatDate } from "../../../../lib/admin/format";
import { transferPgOperator } from "../../../../lib/admin-api";
import { PgTransferOwnerModal } from "../PgTransferOwnerModal";

export function OwnerSection({
  detail,
  accessToken,
  onTransferred
}: {
  detail: PgAdminListingDetail;
  accessToken: string;
  onTransferred: () => void;
}) {
  const o = detail.owner;
  const [transferOpen, setTransferOpen] = useState(false);
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Name", value: o.name },
    { label: "Phone", value: o.phone },
    { label: "Email", value: o.email },
    { label: "Total properties", value: String(o.property_count) },
    { label: "Verification", value: o.verification_status },
    { label: "Member since", value: formatDate(o.created_at) }
  ];
  return (
    <SectionCard
      title="Owner"
      subtitle="The operator who owns this listing and its shared property."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 460 }}>
        {rows.map(({ label, value }) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              alignItems: "baseline"
            }}
          >
            <span style={{ fontSize: 12, color: "var(--ad-text-3)" }}>{label}</span>
            <span
              style={{
                fontSize: 13,
                color: value ? "var(--ad-text)" : "var(--ad-text-3)",
                textAlign: "right",
                fontVariantNumeric: "tabular-nums"
              }}
            >
              {value ?? "-"}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="admin-btn admin-btn--ghost"
        style={{ marginTop: 16 }}
        onClick={() => setTransferOpen(true)}
      >
        Transfer ownership
      </button>

      {transferOpen ? (
        <PgTransferOwnerModal
          listingId={detail.listing.id}
          currentOwnerName={o.name}
          currentOwnerPhone={o.phone}
          onClose={() => setTransferOpen(false)}
          onTransferred={onTransferred}
          onTransfer={(listingId, phone, fullName) =>
            transferPgOperator(accessToken, listingId, phone, fullName)
          }
        />
      ) : null}
    </SectionCard>
  );
}
```

- [ ] **Step 8: Pass the new props at the render site**

In `apps/web/components/admin/pg-properties/PgListingDetail.tsx`, pull `refetchDetail` out of the hook destructure (add it next to `refetchFull`), then replace line 396:

```tsx
{
  tab === "owner" && <OwnerSection detail={detail} />;
}
```

with:

```tsx
{
  tab === "owner" && (
    <OwnerSection
      detail={detail}
      accessToken={accessToken}
      onTransferred={() => {
        void refetchDetail();
        onToast?.("Ownership transferred", "success");
      }}
    />
  );
}
```

- [ ] **Step 9: Typecheck and run the web suite**

```bash
pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web test -- PgTransferOwnerModal
```

Expected: no type errors; 4 tests pass.

---

### Task 4: End-to-end proof against a real database

**Files:**

- Create: `apps/web/tests/admin-pg-transfer.spec.ts`

**Interfaces:**

- Consumes: everything from Tasks 1–3, plus the existing helpers in `apps/web/tests/` used by `admin-listing-transfer.spec.ts` (`loginAsRole`, `setSessionOnPage`, `withPgClient`, `escapeRegExp`, `toTypedPhone`, `toDisplayPhone`). Read that file first and reuse its helpers verbatim rather than writing new ones.

- [ ] **Step 1: Read the flat/house spec to reuse its harness**

```bash
sed -n '1,120p' apps/web/tests/admin-listing-transfer.spec.ts
```

Note which helpers it imports and how it seeds a listing; the PG spec mirrors that structure, substituting a seeded PG listing (create it directly with `withPgClient` inserts into `pg_properties` + `pg_listings` + `listings`, since there is no admin PG create flow).

- [ ] **Step 2: Write the spec**

Create `apps/web/tests/admin-pg-transfer.spec.ts`. The test must:

1. Seed a PG: a `pg_properties` row, a `pg_listings` row with the same id as a `listings` row (`listing_type = 'pg'`), owned by a seeded operator.
2. Log in as admin, `setSessionOnPage`, navigate to `/en/admin`, open **PG Listings**, search for the seeded title, open it.
3. Click the **Owner** tab, then **Transfer ownership**.
4. Fill the phone with a fresh unused number, submit.
5. Assert the Owner tab re-renders showing the new number.
6. Assert directly in SQL — this is the load-bearing part:

```ts
const rows = await withPgClient((client) =>
  client.query(
    `SELECT pl.operator_user_id::text AS head_operator,
            pp.operator_id::text      AS property_operator,
            l.contact_phone_encrypted AS projection_phone,
            l.owner_user_id::text     AS projection_owner
       FROM pg_listings pl
       JOIN listings l ON l.id = pl.id
       LEFT JOIN pg_properties pp ON pp.id = pl.pg_property_id
      WHERE pl.id = $1::uuid`,
    [listingId]
  )
);
const row = rows.rows[0];
// All three ownership columns must land on the same new user. This is the
// assertion that fails if a future refactor drops one table from the
// transaction while leaving the others intact.
expect(row.head_operator).toBe(newOperatorUserId);
expect(row.property_operator).toBe(newOperatorUserId);
expect(row.projection_owner).toBe(newOperatorUserId);
expect(row.projection_phone).toBe(newOperatorPhone);
```

7. Assert the seeded lead moved and carries `transferred_at IS NOT NULL`.
8. Clean up every seeded row in an `afterAll`, following the flat/house spec's teardown order (children before parents, so FKs do not block deletion).

- [ ] **Step 3: Run the spec**

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test:e2e -- admin-pg-transfer
```

Expected: PASS. Requires the local Postgres from `infra/docker-compose.yml` and both dev servers running.

- [ ] **Step 4: Full verification sweep**

```bash
pnpm lint && pnpm typecheck && pnpm --filter @cribliv/api test
```

Expected: lint and typecheck clean. The API suite has 13 known pre-existing failures unrelated to this work (rent-agreement FK, notification_log teardown, destructive migration-0034 test, stale 0031 assertion) — confirm the count has not grown and that none of the failures name a PG transfer file.

---

## Handoff notes

- All work lands as commits on `feat/admin-pg-transfer`. Nothing touches `master`; the branch is
  reviewed and merged as a whole.
- No migration is added. If `pnpm db:migrate` is run, nothing new should apply.
- The admin **Add Listing** wizard still hides the PG option (`BasicsStep.tsx:12`). That is intentional and out of scope — see the spec's Non-goals.
