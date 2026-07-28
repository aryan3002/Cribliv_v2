# Admin listing create-on-behalf and ownership transfer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin-role field worker create a flat/house listing through the existing wizard and publish it directly into the real owner's account, and separately transfer any existing mis-assigned listing to its real owner from the admin UI.

**Architecture:** One transfer primitive (`AdminListingTransferService`) owns every ownership change. It moves `listings.owner_user_id` and `listings.contact_phone_encrypted` together — never apart — upserts the owner by phone, reassigns leads, and writes an `admin_actions` audit row. A standalone admin endpoint calls it to fix existing listings; a `publish-on-behalf` endpoint calls it plus the status flip, atomically, at the end of the wizard. The wizard itself is reused, not rebuilt: its orchestrator is extracted into a shared component mounted in both the owner app and a new admin tab.

**Tech Stack:** NestJS (API, `apps/api`), Next.js 14 App Router (web, `apps/web`), Postgres with raw SQL migrations (`infra/migrations`), Vitest (API + web unit), Playwright (E2E).

## Global Constraints

- **Flat/house only.** Every listing-touching query filters `listing_type = 'flat_house'`. PG is explicitly out of scope (see spec Non-goals).
- **Both phone columns move together (Postgres path).** No Postgres code path may write `owner_user_id` without also writing `contact_phone_encrypted`. This is the entire bug class the feature exists to prevent. The in-memory `AppStateService` fallback is exempt because its `ListingRecord` has no contact-phone field at all — that mode is a DB-less local-boot convenience where no real tenant ever unlocks a contact, so the bug cannot occur there.
- **Dual-mode services.** Per `CLAUDE.md`, every service checks `DatabaseService.isEnabled()` and implements both the Postgres path and the `AppStateService` in-memory fallback.
- **Audit via `admin_actions`, not `audit_logs`.** `admin_actions` is the established mechanism (8+ call sites; read back by the admin Activity tab at `admin-homes.service.ts:972`). `audit_logs` exists in the schema but is dead code. This supersedes the spec's Part 1 step 5.
- **Phone format** is E.164 `+91XXXXXXXXXX`, matching the existing check at `admin.controller.ts:873`.
- **Next migration number is 0069** (`0068_session_rotation_grace.sql` is the current head). Every migration ships with a matching `.rollback.sql`.
- **Do not run the full API test suite against a live database** — migration 0045's rollback drops `keyword_rankings` and `seo_indexing_queue`. Run targeted test files only.

## File Structure

**API — created**

- `apps/api/src/modules/admin/phone.util.ts` — phone normalisation, pure function, no deps
- `apps/api/src/modules/admin/admin-listing-transfer.service.ts` — the transfer primitive
- `apps/api/src/modules/admin/__tests__/phone.util.test.ts`
- `apps/api/src/modules/admin/__tests__/admin-listing-transfer.service.test.ts`

**API — modified**

- `infra/migrations/0069_listing_owner_transfer.sql` + `.rollback.sql` (created)
- `apps/api/src/modules/leads/leads.service.ts:110` — free-lead exemption
- `apps/api/src/modules/admin/admin-homes.controller.ts` — two new endpoints
- `apps/api/src/modules/admin/admin.module.ts` — register the new service
- `apps/api/src/modules/owner/owner.controller.ts` — widen eight `@Roles` to include `admin`

**Web — created**

- `apps/web/components/listing-wizard/ListingWizard.tsx` — extracted orchestrator
- `apps/web/components/admin/homes/TransferOwnerModal.tsx`
- `apps/web/components/admin/tabs/AddListingTab.tsx`

**Web — modified**

- `apps/web/app/[locale]/owner/listings/new/page.tsx` — becomes a thin wrapper
- `apps/web/components/admin/homes/HomeOwnerTab.tsx` — transfer action
- `apps/web/components/admin/shell/AdminSidebar.tsx` — new tab
- `apps/web/components/admin/shell/AdminShell.tsx` — render the new tab
- `apps/web/lib/admin-api.ts` — two client functions

---

### Task 1: Migration 0069 and the free-lead exemption

Inherited leads must not consume the new owner's first-two-free allowance. `leads.service.ts:110` counts leads per owner for lifetime; adding `transferred_at` and excluding non-null rows is the whole fix.

**Files:**

- Create: `infra/migrations/0069_listing_owner_transfer.sql`
- Create: `infra/migrations/0069_listing_owner_transfer.rollback.sql`
- Modify: `apps/api/src/modules/leads/leads.service.ts:110`
- Test: `apps/api/src/modules/leads/__tests__/leads-free-allowance.test.ts` (create)

**Interfaces:**

- Consumes: nothing
- Produces: `leads.transferred_at timestamptz` column and the `transfer_owner` value on the `admin_action_type` enum, both relied on by Task 3.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/leads/__tests__/leads-free-allowance.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { LeadsService } from "../leads.service";

/**
 * The first two leads per owner (lifetime) arrive un-blurred. Leads inherited
 * through an ownership transfer must NOT count toward that allowance, or a new
 * owner who inherits two leads has their first real lead arrive locked.
 */
describe("LeadsService.createLead — free-lead allowance", () => {
  function makeService(leadCount: number) {
    const query = vi.fn(async (sql: string) => {
      if (/SELECT id::text FROM leads/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/count\(\*\)::int AS n FROM leads/i.test(sql)) {
        return { rows: [{ n: leadCount }], rowCount: 1 };
      }
      if (/INSERT INTO leads/i.test(sql)) {
        return { rows: [{ id: "lead-1" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const database = { isEnabled: () => true, query } as any;
    return { service: new LeadsService(database), query };
  }

  it("excludes transferred leads from the lifetime allowance count", async () => {
    const { service, query } = makeService(0);

    await service.createLead({
      listing_id: "11111111-1111-4111-8111-111111111111",
      owner_user_id: "22222222-2222-4222-8222-222222222222",
      tenant_user_id: "33333333-3333-4333-8333-333333333333"
    });

    const countCall = query.mock.calls.find(([sql]: [string]) =>
      /count\(\*\)::int AS n FROM leads/i.test(sql)
    );
    expect(countCall).toBeDefined();
    expect(countCall![0]).toContain("transferred_at IS NULL");
  });

  it("grants 'free' when the owner has no organic leads yet", async () => {
    const { service, query } = makeService(0);

    await service.createLead({
      listing_id: "11111111-1111-4111-8111-111111111111",
      owner_user_id: "22222222-2222-4222-8222-222222222222",
      tenant_user_id: "33333333-3333-4333-8333-333333333333"
    });

    const insertCall = query.mock.calls.find(([sql]: [string]) => /INSERT INTO leads/i.test(sql));
    expect(insertCall![1]).toContain("free");
  });

  it("grants 'locked' once two organic leads exist", async () => {
    const { service, query } = makeService(2);

    await service.createLead({
      listing_id: "11111111-1111-4111-8111-111111111111",
      owner_user_id: "22222222-2222-4222-8222-222222222222",
      tenant_user_id: "33333333-3333-4333-8333-333333333333"
    });

    const insertCall = query.mock.calls.find(([sql]: [string]) => /INSERT INTO leads/i.test(sql));
    expect(insertCall![1]).toContain("locked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/leads/__tests__/leads-free-allowance.test.ts`
Expected: FAIL — the first test fails because the count SQL does not contain `transferred_at IS NULL`.

- [ ] **Step 3: Write the migration**

Create `infra/migrations/0069_listing_owner_transfer.sql`:

```sql
-- 0069: Listing ownership transfer (flat/house).
--
-- `transferred_at` marks a lead that changed hands with its listing rather than
-- arriving organically. leads.service.ts excludes these from the per-owner
-- lifetime count that grants the first two leads free, so inheriting a listing
-- with history never costs the new owner their allowance.
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS transferred_at timestamptz;

-- New admin audit action. run-migrations.js wraps each file in its own
-- BEGIN/COMMIT, and ALTER TYPE ... ADD VALUE works inside that transaction on
-- PG12+ so long as the new value is not USED in the same transaction (it is not
-- -- nothing in this file inserts 'transfer_owner').
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'transfer_owner';
```

Create `infra/migrations/0069_listing_owner_transfer.rollback.sql`:

```sql
ALTER TABLE leads
  DROP COLUMN IF EXISTS transferred_at;
-- Note: Postgres cannot remove an enum value; 'transfer_owner' remains on
-- admin_action_type (harmless).
```

- [ ] **Step 4: Apply the exemption in leads.service.ts**

In `apps/api/src/modules/leads/leads.service.ts`, replace the count query (around line 110):

```typescript
// First 2 leads per owner (lifetime) arrive free/un-blurred — the owner's
// taste of lead quality. Racing concurrent leads can occasionally grant a
// 3rd freebie; acceptable at current scale.
//
// `transferred_at IS NULL` excludes leads inherited through an ownership
// transfer (migration 0069): a new owner who inherits a listing with
// history keeps their own two free leads.
const ownerLeadCount = await this.database.query<{ n: number }>(
  `SELECT count(*)::int AS n FROM leads
          WHERE owner_user_id = $1::uuid AND transferred_at IS NULL`,
  [params.owner_user_id]
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/leads/__tests__/leads-free-allowance.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Apply the migration locally and verify**

```bash
pnpm db:migrate
```

Then confirm the column landed:

```bash
psql "$DATABASE_URL" -c "\d leads" | grep transferred_at
```

Expected: a `transferred_at | timestamp with time zone` row.

- [ ] **Step 7: Commit**

```bash
git add infra/migrations/0069_listing_owner_transfer.sql infra/migrations/0069_listing_owner_transfer.rollback.sql apps/api/src/modules/leads/leads.service.ts apps/api/src/modules/leads/__tests__/leads-free-allowance.test.ts
git commit -m "feat(leads): exempt transferred leads from the free-lead allowance"
```

---

### Task 2: Phone normalisation

Workers type on phones. They will enter `99567 29103`, `099567…`, `+91 99567 29103`. Without normalisation the feature rejects its most common real inputs.

**Files:**

- Create: `apps/api/src/modules/admin/phone.util.ts`
- Test: `apps/api/src/modules/admin/__tests__/phone.util.test.ts`

**Interfaces:**

- Consumes: nothing
- Produces: `normalizeIndianPhone(input: string): string | null` — returns E.164 `+91XXXXXXXXXX` or `null` when the input cannot be read as an Indian mobile number. Used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/admin/__tests__/phone.util.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeIndianPhone } from "../phone.util";

describe("normalizeIndianPhone", () => {
  it("accepts an already-normalised number unchanged", () => {
    expect(normalizeIndianPhone("+919956729103")).toBe("+919956729103");
  });

  it("strips spaces and hyphens", () => {
    expect(normalizeIndianPhone("+91 99567 29103")).toBe("+919956729103");
    expect(normalizeIndianPhone("99567-29103")).toBe("+919956729103");
  });

  it("adds +91 to a bare ten-digit number", () => {
    expect(normalizeIndianPhone("9956729103")).toBe("+919956729103");
  });

  it("drops a leading zero", () => {
    expect(normalizeIndianPhone("09956729103")).toBe("+919956729103");
  });

  it("handles a 91 prefix without the plus", () => {
    expect(normalizeIndianPhone("919956729103")).toBe("+919956729103");
  });

  it("rejects too few or too many digits", () => {
    expect(normalizeIndianPhone("995672910")).toBeNull();
    expect(normalizeIndianPhone("99567291035")).toBeNull();
  });

  it("rejects a 10-digit number that does not start 6-9", () => {
    // No Indian mobile subscriber number starts 0-5. Returning a well-formed
    // +91XXXXXXXXXX for these would be worse than rejecting them: callers treat
    // non-null as validated, so a listing could be handed to a number nobody holds.
    expect(normalizeIndianPhone("1234567890")).toBeNull();
    expect(normalizeIndianPhone("5000000000")).toBeNull();
    expect(normalizeIndianPhone("+911234567890")).toBeNull();
    expect(normalizeIndianPhone("910123456789")).toBeNull();
  });

  it("accepts each valid leading digit", () => {
    for (const lead of ["6", "7", "8", "9"]) {
      expect(normalizeIndianPhone(`${lead}956729103`)).toBe(`+91${lead}956729103`);
    }
  });

  it("rejects non-numeric junk and empty input", () => {
    expect(normalizeIndianPhone("not a phone")).toBeNull();
    expect(normalizeIndianPhone("")).toBeNull();
  });

  it("rejects a non-Indian country code", () => {
    expect(normalizeIndianPhone("+14155552671")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/phone.util.test.ts`
Expected: FAIL — "Failed to resolve import ../phone.util".

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/admin/phone.util.ts`:

```typescript
/**
 * Normalise the shapes a human actually types into the E.164 form the `users`
 * table stores (`+91XXXXXXXXXX`, matching the check at admin.controller.ts:873).
 *
 * Admin-entered phone numbers arrive from field workers typing on mobile
 * keyboards, so `99567 29103`, `099567...` and `+91 99567 29103` are all normal
 * input. Returns null when the value cannot be read as an Indian mobile number —
 * callers surface that as `invalid_phone` rather than guessing.
 */
export function normalizeIndianPhone(input: string): string | null {
  let s = String(input ?? "").replace(/[\s\-()]/g, "");
  if (s === "") return null;

  if (s.startsWith("+")) {
    // An explicit country code that is not India is an error, not something to
    // coerce — silently rewriting it would send OTPs to the wrong number.
    if (!s.startsWith("+91")) return null;
    s = s.slice(3);
  } else if (s.length === 12 && s.startsWith("91")) {
    s = s.slice(2);
  } else if (s.startsWith("0")) {
    s = s.replace(/^0+/, "");
  }

  // Indian mobile subscriber numbers start 6-9. Matches the existing normaliser
  // at apps/api/src/migration/v1/phone.ts:11 and the PHONE_REGEX in
  // rent-agreement/validators/india-rules.validator.ts:5. Note the admin
  // controller's own check (admin.controller.ts:873) is only /^\+91\d{10}$/, so
  // it would NOT catch an impossible number — this is the gate that does.
  if (!/^[6-9]\d{9}$/.test(s)) return null;
  return `+91${s}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/phone.util.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/admin/phone.util.ts apps/api/src/modules/admin/__tests__/phone.util.test.ts
git commit -m "feat(admin): add Indian phone normalisation helper"
```

---

### Task 3: The transfer service

The one place ownership ever changes. Everything else calls this.

**Files:**

- Create: `apps/api/src/modules/admin/admin-listing-transfer.service.ts`
- Test: `apps/api/src/modules/admin/__tests__/admin-listing-transfer.service.test.ts`

**Interfaces:**

- Consumes: `normalizeIndianPhone` (Task 2); `leads.transferred_at` and the `transfer_owner` enum value (Task 1).
- Produces:

  ```typescript
  interface TransferResult {
    listing_id: string;
    owner_user_id: string;
    owner_phone: string;
    leads_moved: number;
    already_owned: boolean;
  }
  class AdminListingTransferService {
    transferOwner(input: {
      listingId: string;
      phoneE164: string;
      fullName?: string;
      adminUserId: string;
      alsoSubmit?: boolean;
    }): Promise<TransferResult>;
  }
  ```

  `alsoSubmit: true` additionally flips `status` to `'pending_review'` inside the same transaction — used by Task 9's publish-on-behalf. Task 4 and Task 9 both call `transferOwner`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/admin/__tests__/admin-listing-transfer.service.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { AppStateService } from "../../../common/app-state.service";
import { AdminListingTransferService } from "../admin-listing-transfer.service";

const LISTING = "ad204234-4b39-4228-8b49-3b9e91113e16";
const NEW_OWNER = "f5b7e19c-cfaa-4926-ad3a-10be52b7c876";
const OLD_OWNER = "11111111-1111-4111-8111-111111111111";

/**
 * DB-mode uses a mocked client so these run in CI without Postgres. The service
 * issues client.query() in this order:
 *   1. BEGIN
 *   2. SELECT ... FROM listings ... FOR UPDATE      (guard + current owner)
 *   3. INSERT INTO users ... ON CONFLICT             (resolve/upsert owner)
 *   4. UPDATE listings SET owner_user_id, contact_phone_encrypted
 *   5. UPDATE leads SET owner_user_id, transferred_at
 *   6. INSERT INTO admin_actions
 *   7. COMMIT
 */
function makeDbService(overrides: {
  listingRow?: Record<string, unknown> | null;
  userRow?: Record<string, unknown>;
  leadsMoved?: number;
}) {
  const listingRow =
    overrides.listingRow === undefined
      ? { id: LISTING, owner_user_id: OLD_OWNER, listing_type: "flat_house", status: "active" }
      : overrides.listingRow;
  const userRow = overrides.userRow ?? {
    id: NEW_OWNER,
    phone_e164: "+919956729103",
    role: "owner",
    is_blocked: false
  };

  const query = vi.fn(async (sql: string) => {
    if (/^\s*BEGIN/i.test(sql) || /^\s*COMMIT/i.test(sql) || /^\s*ROLLBACK/i.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    if (/FROM listings/i.test(sql) && /FOR UPDATE/i.test(sql)) {
      return { rows: listingRow ? [listingRow] : [], rowCount: listingRow ? 1 : 0 };
    }
    if (/INSERT INTO users/i.test(sql)) return { rows: [userRow], rowCount: 1 };
    if (/UPDATE listings/i.test(sql)) return { rows: [{ id: LISTING }], rowCount: 1 };
    if (/UPDATE leads/i.test(sql)) return { rows: [], rowCount: overrides.leadsMoved ?? 0 };
    if (/INSERT INTO admin_actions/i.test(sql)) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });

  const client = { query, release: vi.fn() };
  const database = { isEnabled: () => true, getClient: vi.fn(async () => client) } as any;
  const service = new AdminListingTransferService(database, new AppStateService());
  return { service, query, client };
}

describe("AdminListingTransferService.transferOwner — DB mode", () => {
  it("moves owner_user_id and contact_phone_encrypted in the same UPDATE", async () => {
    const { service, query } = makeDbService({});

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "99567 29103",
      fullName: "Akash Rai",
      adminUserId: "admin-1"
    });

    const updateCall = query.mock.calls.find(([sql]: [string]) => /UPDATE listings/i.test(sql));
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toContain("owner_user_id");
    expect(updateCall![0]).toContain("contact_phone_encrypted");

    expect(result.owner_user_id).toBe(NEW_OWNER);
    expect(result.owner_phone).toBe("+919956729103");
    expect(result.already_owned).toBe(false);
  });

  it("leaves verification_status untouched — the badge describes the property, not the person", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    const updateCall = query.mock.calls.find(([sql]: [string]) => /UPDATE listings/i.test(sql));
    expect(updateCall![0]).not.toContain("verification_status");
  });

  it("normalises the entered phone before touching the database", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "099567 29103",
      adminUserId: "admin-1"
    });

    const userCall = query.mock.calls.find(([sql]: [string]) => /INSERT INTO users/i.test(sql));
    expect(userCall![1]).toContain("+919956729103");
  });

  it("stamps transferred_at on the leads it moves and reports the count", async () => {
    const { service, query } = makeDbService({ leadsMoved: 3 });

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    const leadsCall = query.mock.calls.find(([sql]: [string]) => /UPDATE leads/i.test(sql));
    expect(leadsCall![0]).toContain("transferred_at");
    expect(result.leads_moved).toBe(3);
  });

  it("writes a transfer_owner admin_actions row carrying both user ids", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    const auditCall = query.mock.calls.find(([sql]: [string]) =>
      /INSERT INTO admin_actions/i.test(sql)
    );
    expect(auditCall![0]).toContain("'transfer_owner'");
    const after = JSON.parse(auditCall![1][3] as string);
    expect(after.to_user_id).toBe(NEW_OWNER);
    const before = JSON.parse(auditCall![1][2] as string);
    expect(before.from_user_id).toBe(OLD_OWNER);
  });

  it("commits the whole transfer as one transaction", async () => {
    const { service, query, client } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    const statements = query.mock.calls.map(([sql]: [string]) => String(sql).trim());
    expect(statements[0]).toMatch(/^BEGIN/i);
    expect(statements[statements.length - 1]).toMatch(/^COMMIT/i);
    expect(client.release).toHaveBeenCalled();
  });

  it("is a no-op when the listing is already owned by the target", async () => {
    const { service, query } = makeDbService({
      listingRow: {
        id: LISTING,
        owner_user_id: NEW_OWNER,
        listing_type: "flat_house",
        status: "active"
      }
    });

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    expect(result.already_owned).toBe(true);
    expect(query.mock.calls.some(([sql]: [string]) => /UPDATE listings/i.test(sql))).toBe(false);
  });

  it("refuses a PG listing", async () => {
    const { service } = makeDbService({
      listingRow: { id: LISTING, owner_user_id: OLD_OWNER, listing_type: "pg", status: "active" }
    });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toMatchObject({ response: { code: "pg_not_supported" } });
  });

  it("refuses when the listing does not exist", async () => {
    const { service } = makeDbService({ listingRow: null });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toMatchObject({ response: { code: "listing_not_found" } });
  });

  it("refuses an unparseable phone before opening a transaction", async () => {
    const { service, database } = {
      ...makeDbService({}),
      database: undefined as never
    };

    await expect(
      service.transferOwner({ listingId: LISTING, phoneE164: "12345", adminUserId: "admin-1" })
    ).rejects.toMatchObject({ response: { code: "invalid_phone" } });
  });

  it("refuses transferring to an admin account", async () => {
    const { service } = makeDbService({
      userRow: { id: NEW_OWNER, phone_e164: "+919956729103", role: "admin", is_blocked: false }
    });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toMatchObject({ response: { code: "cannot_transfer_to_admin" } });
  });

  it("refuses transferring to a blocked account", async () => {
    const { service } = makeDbService({
      userRow: { id: NEW_OWNER, phone_e164: "+919956729103", role: "owner", is_blocked: true }
    });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toMatchObject({ response: { code: "target_blocked" } });
  });

  it("rolls back when a statement fails mid-transfer", async () => {
    const { service, query, client } = makeDbService({});
    query.mockImplementation(async (sql: string) => {
      if (/^\s*BEGIN/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/FROM listings/i.test(sql) && /FOR UPDATE/i.test(sql)) {
        return {
          rows: [
            { id: LISTING, owner_user_id: OLD_OWNER, listing_type: "flat_house", status: "active" }
          ],
          rowCount: 1
        };
      }
      if (/INSERT INTO users/i.test(sql)) throw new Error("boom");
      return { rows: [], rowCount: 0 };
    });

    await expect(
      service.transferOwner({
        listingId: LISTING,
        phoneE164: "+919956729103",
        adminUserId: "admin-1"
      })
    ).rejects.toThrow("boom");

    const statements = query.mock.calls.map(([sql]: [string]) => String(sql).trim());
    expect(statements.some((s) => /^ROLLBACK/i.test(s))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it("also flips status to pending_review when alsoSubmit is set", async () => {
    const { service, query } = makeDbService({});

    await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1",
      alsoSubmit: true
    });

    const updateCall = query.mock.calls.find(([sql]: [string]) => /UPDATE listings/i.test(sql));
    expect(updateCall![0]).toContain("pending_review");
  });
});

describe("AdminListingTransferService.transferOwner — in-memory mode", () => {
  function makeMemoryService() {
    const appState = new AppStateService();
    (appState as any).users = new Map([
      [
        OLD_OWNER,
        { id: OLD_OWNER, phone: "+918800826659", role: "owner", preferred_language: "en" }
      ]
    ]);
    (appState as any).listings = new Map([
      [
        LISTING,
        {
          id: LISTING,
          ownerUserId: OLD_OWNER,
          listingType: "flat_house",
          title: "3RK Vrindavan Yojana",
          city: "lucknow",
          monthlyRent: 13000,
          verificationStatus: "verified",
          status: "active",
          createdAt: 1
        }
      ]
    ]);
    const database = { isEnabled: () => false, getClient: vi.fn() } as any;
    return { service: new AdminListingTransferService(database, appState), appState };
  }

  it("repoints the listing at a newly created owner", async () => {
    const { service, appState } = makeMemoryService();

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      fullName: "Akash Rai",
      adminUserId: "admin-1"
    });

    const listing = (appState as any).listings.get(LISTING);
    expect(listing.ownerUserId).toBe(result.owner_user_id);
    expect(listing.ownerUserId).not.toBe(OLD_OWNER);

    const created = (appState as any).users.get(result.owner_user_id);
    expect(created.phone).toBe("+919956729103");
    expect(created.role).toBe("owner");
    expect(created.full_name).toBe("Akash Rai");
  });

  it("reuses an existing user with the same phone", async () => {
    const { service, appState } = makeMemoryService();
    (appState as any).users.set("existing", {
      id: "existing",
      phone: "+919956729103",
      role: "tenant",
      preferred_language: "en"
    });

    const result = await service.transferOwner({
      listingId: LISTING,
      phoneE164: "+919956729103",
      adminUserId: "admin-1"
    });

    expect(result.owner_user_id).toBe("existing");
    expect((appState as any).users.get("existing").role).toBe("owner");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-listing-transfer.service.test.ts`
Expected: FAIL — "Failed to resolve import ../admin-listing-transfer.service".

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/admin/admin-listing-transfer.service.ts`:

```typescript
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { AppStateService } from "../../common/app-state.service";
import { DatabaseService } from "../../common/database.service";
import { normalizeIndianPhone } from "./phone.util";

export interface TransferResult {
  listing_id: string;
  owner_user_id: string;
  owner_phone: string;
  leads_moved: number;
  already_owned: boolean;
}

export interface TransferInput {
  listingId: string;
  phoneE164: string;
  fullName?: string;
  adminUserId: string;
  /** Also flip status to 'pending_review' in the same transaction (publish-on-behalf). */
  alsoSubmit?: boolean;
}

/**
 * The single place a flat/house listing ever changes hands.
 *
 * Two columns bind a listing to a person and they must always move together:
 * `owner_user_id` (dashboard, edit rights, new-lead routing, public "Listed by")
 * and `contact_phone_encrypted` (the number a tenant receives after spending a
 * credit — see contacts.service.ts:305). Moving only the first produces a
 * listing whose masked preview shows the new owner while paid unlocks still
 * hand out the old one, so a tenant pays and calls the wrong person.
 *
 * Every change is audited to `admin_actions` (action='transfer_owner'), which
 * the admin home workspace's Activity tab reads back.
 */
@Injectable()
export class AdminListingTransferService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AppStateService) private readonly appState: AppStateService
  ) {}

  async transferOwner(input: TransferInput): Promise<TransferResult> {
    const phone = normalizeIndianPhone(input.phoneE164);
    if (!phone) {
      throw new BadRequestException({
        code: "invalid_phone",
        message: "Enter a valid Indian mobile number"
      });
    }

    const fullName = input.fullName?.trim() || null;

    if (!this.database.isEnabled()) {
      return this.transferInMemory(input, phone, fullName);
    }

    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      // FOR UPDATE so two admins transferring the same listing serialise rather
      // than racing to a lost update.
      const listing = await client.query<{
        id: string;
        owner_user_id: string;
        listing_type: string;
        status: string;
      }>(
        `SELECT id::text, owner_user_id::text, listing_type::text, status::text
           FROM listings
          WHERE id = $1::uuid
          FOR UPDATE`,
        [input.listingId]
      );

      if (!listing.rowCount || !listing.rows[0]) {
        throw new NotFoundException({
          code: "listing_not_found",
          message: "Listing not found"
        });
      }

      const current = listing.rows[0];
      if (current.listing_type !== "flat_house") {
        throw new BadRequestException({
          code: "pg_not_supported",
          message: "PG listings cannot be transferred yet"
        });
      }

      // Upsert the owner by phone. Promote tenant -> owner; never downgrade an
      // existing owner/pg_operator; never overwrite a name the owner set.
      const owner = await client.query<{
        id: string;
        phone_e164: string;
        role: string;
        is_blocked: boolean;
      }>(
        `INSERT INTO users (phone_e164, role, preferred_language, full_name)
         VALUES ($1, 'owner', 'en', $2)
         ON CONFLICT (phone_e164) DO UPDATE
           SET role = CASE WHEN users.role = 'tenant' THEN 'owner'::user_role ELSE users.role END,
               full_name = COALESCE(NULLIF(users.full_name, ''), EXCLUDED.full_name),
               updated_at = now()
         RETURNING id::text, phone_e164, role::text, is_blocked`,
        [phone, fullName]
      );

      const target = owner.rows[0];

      // An admin account is blocked from /owner/* by middleware, so it would
      // never be able to see or manage the listing it was handed.
      if (target.role === "admin") {
        throw new BadRequestException({
          code: "cannot_transfer_to_admin",
          message: "That number belongs to an admin account"
        });
      }
      if (target.is_blocked) {
        throw new BadRequestException({
          code: "target_blocked",
          message: "That account is blocked"
        });
      }

      if (target.id === current.owner_user_id && !input.alsoSubmit) {
        await client.query("COMMIT");
        return {
          listing_id: current.id,
          owner_user_id: target.id,
          owner_phone: target.phone_e164,
          leads_moved: 0,
          already_owned: true
        };
      }

      await client.query(
        `UPDATE listings
            SET owner_user_id = $2::uuid,
                contact_phone_encrypted = $3,
                ${input.alsoSubmit ? "status = 'pending_review'," : ""}
                updated_at = now()
          WHERE id = $1::uuid`,
        [current.id, target.id, target.phone_e164]
      );

      // Leads carry a denormalised owner_user_id stamped at creation, so they do
      // not follow the listing on their own. transferred_at marks them inherited
      // so they do not consume the new owner's free-lead allowance.
      const leads = await client.query(
        `UPDATE leads
            SET owner_user_id = $2::uuid,
                transferred_at = now(),
                updated_at = now()
          WHERE listing_id = $1::uuid
            AND owner_user_id <> $2::uuid`,
        [current.id, target.id]
      );

      await client.query(
        `INSERT INTO admin_actions(admin_user_id, target_type, target_id, action, before_state, after_state)
         VALUES ($1::uuid, 'listing', $2::uuid, 'transfer_owner', $3::jsonb, $4::jsonb)`,
        [
          input.adminUserId,
          current.id,
          JSON.stringify({ from_user_id: current.owner_user_id, status: current.status }),
          JSON.stringify({
            to_user_id: target.id,
            to_phone: target.phone_e164,
            leads_moved: leads.rowCount ?? 0,
            submitted: Boolean(input.alsoSubmit)
          })
        ]
      );

      await client.query("COMMIT");

      return {
        listing_id: current.id,
        owner_user_id: target.id,
        owner_phone: target.phone_e164,
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

  /**
   * In-memory fallback for DB-less local boot (CLAUDE.md dual-mode rule). The
   * in-memory ListingRecord has no contact-phone field, so only the owner
   * binding moves here.
   */
  private transferInMemory(
    input: TransferInput,
    phone: string,
    fullName: string | null
  ): TransferResult {
    const listing = this.appState.listings.get(input.listingId);
    if (!listing) {
      throw new NotFoundException({ code: "listing_not_found", message: "Listing not found" });
    }
    if (listing.listingType !== "flat_house") {
      throw new BadRequestException({
        code: "pg_not_supported",
        message: "PG listings cannot be transferred yet"
      });
    }

    let target = [...this.appState.users.values()].find((u) => u.phone === phone);
    if (!target) {
      target = {
        id: randomUUID(),
        phone,
        role: "owner",
        preferred_language: "en",
        ...(fullName ? { full_name: fullName } : {})
      };
      this.appState.users.set(target.id, target);
    } else {
      if (target.role === "admin") {
        throw new BadRequestException({
          code: "cannot_transfer_to_admin",
          message: "That number belongs to an admin account"
        });
      }
      if (target.role === "tenant") target.role = "owner";
      if (!target.full_name && fullName) target.full_name = fullName;
    }

    if (listing.ownerUserId === target.id && !input.alsoSubmit) {
      return {
        listing_id: listing.id,
        owner_user_id: target.id,
        owner_phone: phone,
        leads_moved: 0,
        already_owned: true
      };
    }

    const previousOwner = listing.ownerUserId;
    listing.ownerUserId = target.id;
    if (input.alsoSubmit) listing.status = "pending_review";

    let leadsMoved = 0;
    for (const lead of this.appState.leads.values()) {
      if (lead.listingId === listing.id && lead.ownerUserId === previousOwner) {
        lead.ownerUserId = target.id;
        lead.transferredAt = Date.now();
        leadsMoved += 1;
      }
    }

    return {
      listing_id: listing.id,
      owner_user_id: target.id,
      owner_phone: phone,
      leads_moved: leadsMoved,
      already_owned: false
    };
  }
}
```

- [ ] **Step 3b: Give the in-memory path the same free-lead exemption**

Task 1 added `transferred_at` to the `leads` table and excluded those rows from the Postgres
free-allowance count. This step closes the matching gap in the in-memory path, which only becomes
reachable now that `transferInMemory` above moves leads.

In `apps/api/src/common/app-state.service.ts`, add the field to `LeadRecord` (near
`createdAt`, around line 110-127):

```typescript
  /** Set when the lead changed hands with its listing; excluded from the free-lead allowance. */
  transferredAt?: number;
```

Then in `createOwnerLead` (around line 552), exclude inherited leads from the count exactly as the
DB path does:

```typescript
const ownerLeadCount = [...this.leads.values()].filter(
  (lead) => lead.ownerUserId === input.ownerUserId && lead.transferredAt == null
).length;
```

Match the surrounding code — read the existing count expression before editing and preserve how its
result is used.

Add this test to the in-memory describe block:

```typescript
it("stamps moved leads as transferred so they do not consume the new owner's free allowance", async () => {
  const { service, appState } = makeMemoryService();
  (appState as any).leads = new Map([
    [
      "lead-1",
      {
        id: "lead-1",
        listingId: LISTING,
        ownerUserId: OLD_OWNER,
        tenantUserId: "t-1",
        status: "new",
        accessState: "free",
        createdAt: 1,
        statusChangedAt: 1
      }
    ]
  ]);

  const result = await service.transferOwner({
    listingId: LISTING,
    phoneE164: "+919956729103",
    adminUserId: "admin-1"
  });

  expect(result.leads_moved).toBe(1);
  const moved = (appState as any).leads.get("lead-1");
  expect(moved.ownerUserId).toBe(result.owner_user_id);
  expect(moved.transferredAt).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-listing-transfer.service.test.ts`
Expected: PASS. If the in-memory tests fail on `this.appState.leads`, confirm the collection name in `apps/api/src/common/app-state.service.ts` and use the actual property.

Also re-run the AppState tests, since Step 3b touched a shared service:

Run: `pnpm --filter @cribliv/api exec vitest run src/common/__tests__/`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @cribliv/api typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/admin/admin-listing-transfer.service.ts apps/api/src/modules/admin/__tests__/admin-listing-transfer.service.test.ts
git commit -m "feat(admin): add listing ownership transfer service"
```

---

### Task 4: Transfer endpoint

**Files:**

- Modify: `apps/api/src/modules/admin/admin-homes.controller.ts`
- Modify: `apps/api/src/modules/admin/admin.module.ts:40-67`
- Test: `apps/api/src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts` (create)

**Interfaces:**

- Consumes: `AdminListingTransferService.transferOwner` (Task 3)
- Produces: `POST /admin/homes/:listing_id/transfer` with body `{ phone_e164: string; full_name?: string }`, responding `ok(TransferResult)`. Task 5's web client calls this.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { AdminHomesController } from "../admin-homes.controller";

describe("AdminHomesController.transfer", () => {
  it("passes the listing id, phone, name and acting admin to the service", async () => {
    const transferOwner = vi.fn(async () => ({
      listing_id: "listing-1",
      owner_user_id: "owner-9",
      owner_phone: "+919956729103",
      leads_moved: 0,
      already_owned: false
    }));
    const controller = new AdminHomesController({} as any, { transferOwner } as any);

    const result = await controller.transfer({ user: { id: "admin-1" } }, "listing-1", {
      phone_e164: "+919956729103",
      full_name: "Akash Rai"
    });

    expect(transferOwner).toHaveBeenCalledWith({
      listingId: "listing-1",
      phoneE164: "+919956729103",
      fullName: "Akash Rai",
      adminUserId: "admin-1"
    });
    expect(result).toEqual({ data: expect.objectContaining({ owner_user_id: "owner-9" }) });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts`
Expected: FAIL — `controller.transfer is not a function`.

- [ ] **Step 3: Add the constructor dependency and endpoint**

In `apps/api/src/modules/admin/admin-homes.controller.ts`, add `Post` to the `@nestjs/common` import, import the service, and extend the constructor:

```typescript
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards
} from "@nestjs/common";
import { AdminListingTransferService } from "./admin-listing-transfer.service";
```

```typescript
  constructor(
    @Inject(AdminHomesService) private readonly homes: AdminHomesService,
    @Inject(AdminListingTransferService) private readonly transfers: AdminListingTransferService
  ) {}
```

Then add the endpoint below `setAvailability`:

```typescript
  /**
   * Hand a flat/house listing to its real owner, identified by phone. Creates
   * the owner account if the number is new. Moves the account binding AND the
   * callback number together — see AdminListingTransferService.
   */
  @Post(":listing_id/transfer")
  async transfer(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: { phone_e164: string; full_name?: string }
  ) {
    return ok(
      await this.transfers.transferOwner({
        listingId,
        phoneE164: body.phone_e164,
        fullName: body.full_name,
        adminUserId: req.user.id
      })
    );
  }
```

- [ ] **Step 4: Register the service in the module**

In `apps/api/src/modules/admin/admin.module.ts`, add the import and list it in `providers` next to `AdminHomesService`:

```typescript
import { AdminListingTransferService } from "./admin-listing-transfer.service";
```

```typescript
(AdminHomesService, AdminListingTransferService);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts`
Expected: PASS

- [ ] **Step 6: Verify the existing admin-homes tests still pass**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/`
Expected: PASS. The `AdminHomesController` constructor gained a parameter — if any existing test constructs it directly, pass a second `{} as any`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/admin/admin-homes.controller.ts apps/api/src/modules/admin/admin.module.ts apps/api/src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts
git commit -m "feat(admin): expose POST /admin/homes/:id/transfer"
```

---

### Task 5: Transfer UI in the admin home workspace

**Files:**

- Create: `apps/web/components/admin/homes/TransferOwnerModal.tsx`
- Modify: `apps/web/lib/admin-api.ts`
- Modify: `apps/web/components/admin/homes/HomeOwnerTab.tsx`
- Test: `apps/web/components/admin/homes/__tests__/TransferOwnerModal.test.tsx` (create)

**Interfaces:**

- Consumes: `POST /admin/homes/:listing_id/transfer` (Task 4)
- Produces: `transferHomeOwner(accessToken, listingId, phone, fullName?)` in `admin-api.ts`, returning `{ ownerUserId: string; ownerPhone: string; leadsMoved: number; alreadyOwned: boolean }`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/admin/homes/__tests__/TransferOwnerModal.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TransferOwnerModal } from "../TransferOwnerModal";

describe("TransferOwnerModal", () => {
  const baseProps = {
    listingId: "listing-1",
    currentOwnerName: "Adarsh Tripathi",
    currentOwnerPhone: "+918800826659",
    accessToken: "tok",
    onClose: vi.fn(),
    onTransferred: vi.fn()
  };

  it("does not submit an empty phone", () => {
    const onTransfer = vi.fn();
    render(<TransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    fireEvent.click(screen.getByRole("button", { name: /transfer/i }));

    expect(onTransfer).not.toHaveBeenCalled();
  });

  it("submits the phone as typed and lets the server normalise it", async () => {
    const onTransfer = vi.fn(async () => ({
      ownerUserId: "owner-9",
      ownerPhone: "+919956729103",
      leadsMoved: 0,
      alreadyOwned: false
    }));
    render(<TransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    fireEvent.change(screen.getByLabelText(/owner's phone/i), {
      target: { value: "99567 29103" }
    });
    fireEvent.change(screen.getByLabelText(/owner's name/i), { target: { value: "Akash Rai" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer/i }));

    await waitFor(() =>
      expect(onTransfer).toHaveBeenCalledWith("listing-1", "99567 29103", "Akash Rai")
    );
  });

  it("shows the server's rejection when the number is unusable", async () => {
    const onTransfer = vi.fn(async () => {
      throw new Error("Enter a valid Indian mobile number");
    });
    render(<TransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    fireEvent.change(screen.getByLabelText(/owner's phone/i), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: /transfer/i }));

    await waitFor(() =>
      expect(screen.getByText(/valid indian mobile number/i)).toBeInTheDocument()
    );
  });

  it("warns that the callback number changes before confirming", () => {
    render(<TransferOwnerModal {...baseProps} onTransfer={vi.fn()} />);
    expect(screen.getByText(/callback number/i)).toBeInTheDocument();
  });

  it("surfaces a server error instead of closing", async () => {
    const onTransfer = vi.fn(async () => {
      throw new Error("That number belongs to an admin account");
    });
    render(<TransferOwnerModal {...baseProps} onTransfer={onTransfer} />);

    fireEvent.change(screen.getByLabelText(/owner's phone/i), {
      target: { value: "9956729103" }
    });
    fireEvent.click(screen.getByRole("button", { name: /transfer/i }));

    await waitFor(() => expect(screen.getByText(/admin account/i)).toBeInTheDocument());
    expect(baseProps.onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/admin/homes/__tests__/TransferOwnerModal.test.tsx`
Expected: FAIL — cannot resolve `../TransferOwnerModal`.

- [ ] **Step 3: Add the API client function**

In `apps/web/lib/admin-api.ts`, next to `setAdminHomeAvailability`:

```typescript
/**
 * Hand a flat/house listing to its real owner, identified by phone. Creates the
 * account if the number is new; the owner is granted the `owner` role on their
 * first OTP login. Moves the account binding and the callback number together.
 */
export async function transferHomeOwner(
  accessToken: string,
  listingId: string,
  phoneE164: string,
  fullName?: string
): Promise<{
  ownerUserId: string;
  ownerPhone: string;
  leadsMoved: number;
  alreadyOwned: boolean;
}> {
  const response = await fetchApi<{
    owner_user_id: string;
    owner_phone: string;
    leads_moved: number;
    already_owned: boolean;
  }>(`/admin/homes/${listingId}/transfer`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ phone_e164: phoneE164, full_name: fullName })
  });

  return {
    ownerUserId: response.owner_user_id,
    ownerPhone: response.owner_phone,
    leadsMoved: response.leads_moved,
    alreadyOwned: response.already_owned
  };
}
```

- [ ] **Step 4: Write the modal**

Create `apps/web/components/admin/homes/TransferOwnerModal.tsx`:

The API is the single authority on what a valid phone is — the modal deliberately does not
re-implement `normalizeIndianPhone`. It posts what the worker typed and renders whatever the server
says. That costs one round-trip on a typo and makes it impossible for the two implementations to
drift apart.

```tsx
"use client";

import { useState } from "react";

export interface TransferOwnerModalProps {
  listingId: string;
  currentOwnerName: string | null;
  currentOwnerPhone: string | null;
  accessToken: string;
  onClose: () => void;
  onTransferred: (result: { ownerPhone: string; leadsMoved: number }) => void;
  onTransfer: (
    listingId: string,
    phoneE164: string,
    fullName?: string
  ) => Promise<{
    ownerUserId: string;
    ownerPhone: string;
    leadsMoved: number;
    alreadyOwned: boolean;
  }>;
}

export function TransferOwnerModal({
  listingId,
  currentOwnerName,
  currentOwnerPhone,
  onClose,
  onTransferred,
  onTransfer
}: TransferOwnerModalProps) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    // No client-side normalising: the API owns that rule (phone.util.ts) and
    // rejects with `invalid_phone`. Only the empty case is worth catching here,
    // since it needs no server to know it is wrong.
    if (!phone.trim()) {
      setError("Enter the owner's phone number");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await onTransfer(listingId, phone.trim(), name.trim() || undefined);
      onTransferred({ ownerPhone: result.ownerPhone, leadsMoved: result.leadsMoved });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label="Transfer ownership">
      <h3>Transfer ownership</h3>
      <p>
        Currently owned by {currentOwnerName ?? "an unnamed account"} ({currentOwnerPhone ?? "-"}).
      </p>

      <label htmlFor="transfer-phone">Owner&apos;s phone</label>
      <input
        id="transfer-phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="99567 29103"
        inputMode="tel"
      />

      <label htmlFor="transfer-name">Owner&apos;s name (optional)</label>
      <input id="transfer-name" value={name} onChange={(e) => setName(e.target.value)} />

      <p className="admin-modal__note">
        This moves the listing out of the current account and changes the callback number tenants
        receive after unlocking. Any existing leads move too. The new owner sees the property after
        logging in with this number.
      </p>

      {error ? <p role="alert">{error}</p> : null}

      <div className="admin-modal__actions">
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={busy}>
          {busy ? "Transferring…" : "Transfer ownership"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/admin/homes/__tests__/TransferOwnerModal.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Wire the modal into HomeOwnerTab**

In `apps/web/components/admin/homes/HomeOwnerTab.tsx`, add `"use client";` at the top if absent, then import `useState`, `TransferOwnerModal` and `transferHomeOwner`. Change the signature to accept the token and a refresh callback:

```tsx
export function HomeOwnerTab({
  detail,
  accessToken,
  onOwnerChanged
}: {
  detail: AdminHomeDetail;
  accessToken: string;
  onOwnerChanged: () => void;
}) {
  const { owner } = detail;
  const [transferOpen, setTransferOpen] = useState(false);
```

Inside the "Owner identity" `SectionCard`, below the pills:

```tsx
<button type="button" onClick={() => setTransferOpen(true)}>
  Transfer ownership
</button>;
{
  transferOpen ? (
    <TransferOwnerModal
      listingId={detail.listing.id}
      currentOwnerName={owner.name}
      currentOwnerPhone={owner.phone}
      accessToken={accessToken}
      onClose={() => setTransferOpen(false)}
      onTransferred={onOwnerChanged}
      onTransfer={(listingId, phone, fullName) =>
        transferHomeOwner(accessToken, listingId, phone, fullName)
      }
    />
  ) : null;
}
```

In `apps/web/components/admin/homes/AdminHomeWorkspace.tsx`, the workspace already holds `accessToken` (line 40) and drives refetches with `setReloadKey` (line 69, and it is a dependency of the detail fetch effect at line 102). Update the `HomeOwnerTab` render to:

```tsx
<HomeOwnerTab
  detail={detail}
  accessToken={accessToken}
  onOwnerChanged={() => setReloadKey((key) => key + 1)}
/>
```

Bumping `reloadKey` refetches the detail, so the Owner tab shows the new owner immediately after a transfer.

- [ ] **Step 7: Verify the workspace tests still pass**

Run: `pnpm --filter @cribliv/web exec vitest run components/admin/homes/`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/admin/homes apps/web/lib/admin-api.ts
git commit -m "feat(admin-web): transfer ownership action on the home workspace"
```

---

### Task 6: Let admins drive the owner wizard endpoints

**Files:**

- Modify: `apps/api/src/modules/owner/owner.controller.ts`
- Test: `apps/api/src/modules/owner/__tests__/owner-roles.test.ts` (create)

**Interfaces:**

- Consumes: nothing
- Produces: the eight wizard endpoints accept `admin` in addition to `owner`, which Task 8's admin wizard mount depends on.

Safety note for the reviewer: this grants no lateral access. Every one of these service methods already scopes its queries by `owner_user_id = req.user.id` (`owner.service.ts:589`, `:806`, `:885`, `:934`), so an admin reaches their own drafts and nothing else.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/owner/__tests__/owner-roles.test.ts`:

```typescript
import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { OwnerController } from "../owner.controller";

/**
 * The listing wizard is reused inside the admin portal (create-on-behalf), so
 * the endpoints it calls must accept an admin caller. Ownership scoping still
 * happens in the service layer against req.user.id.
 */
const WIZARD_METHODS = [
  "list",
  "create",
  "getListing",
  "update",
  "presign",
  "complete",
  "reorderPhotos",
  "submit",
  "generateContent"
] as const;

describe("OwnerController wizard endpoints", () => {
  for (const method of WIZARD_METHODS) {
    it(`${method} accepts an admin caller`, () => {
      const roles = Reflect.getMetadata("roles", (OwnerController.prototype as any)[method]);
      expect(roles, `${method} must declare its own @Roles`).toBeDefined();
      expect(roles).toContain("admin");
      expect(roles).toContain("owner");
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/owner/__tests__/owner-roles.test.ts`
Expected: FAIL — roles metadata is undefined on these methods (they inherit the class-level `@Roles("owner")`).

Note: confirm the metadata key by reading `apps/api/src/common/roles.decorator.ts`. If it uses `SetMetadata("roles", ...)` the test above is correct; adjust the key if it differs.

- [ ] **Step 3: Add explicit @Roles to each wizard endpoint**

In `apps/api/src/modules/owner/owner.controller.ts`, add `@Roles("owner", "admin")` immediately above each of these decorators — `@Get("listings")` (`list`), `@Post("listings")` (`create`), `@Get("listings/:listing_id")` (`getListing`), `@Patch("listings/:listing_id")` (`update`), `@Post("listings/:listing_id/photos/presign")` (`presign`), `@Post("listings/:listing_id/photos/complete")` (`complete`), `@Patch("listings/:listing_id/photos/reorder")` (`reorderPhotos`), `@Post("listings/:listing_id/submit")` (`submit`), `@Post("listings/generate-content")` (`generateContent`) — and update the class comment at line 64:

`list` and `getListing` are included because Task 8's Add Listing tab shows the worker their own
unfinished drafts and lets them resume one; both read through these endpoints. Every other route on
this controller — visibility, availability-status, contact-unlocks — stays owner-only.

```typescript
  // Wizard endpoints also accept `admin`: the same wizard is mounted in the
  // admin portal for create-on-behalf. Ownership is still enforced in the
  // service layer, which scopes every query to owner_user_id = req.user.id, so
  // an admin caller reaches only their own drafts. Everything else on this
  // controller stays owner-only — see class @Roles. (SEC-H1)
  @Roles("owner", "admin")
  @Post("listings")
```

`apps/api/src/modules/owner/owner.capture.controller.ts` has a class-level `@Roles("owner")` at line 24 (the AI photo-extraction endpoint the wizard calls). Widen that class decorator directly, since `@Post("extract")` is its only route:

```typescript
@Roles("owner", "admin")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/owner/__tests__/owner-roles.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Verify no owner tests regressed**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/owner/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/owner
git commit -m "feat(owner): allow admin callers on the listing wizard endpoints"
```

---

### Task 7: Extract the wizard orchestrator

Pure refactor. No behaviour change, no new tests — the deliverable is that the existing suite still passes with the orchestrator living in a shared component. Doing this as its own commit means a regression here is bisectable and reviewable separately from the admin feature.

**Files:**

- Create: `apps/web/components/listing-wizard/ListingWizard.tsx`
- Modify: `apps/web/app/[locale]/owner/listings/new/page.tsx`
- Modify: `apps/web/components/listing-wizard/index.ts` (or wherever the barrel lives — confirm by reading the directory)

**Interfaces:**

- Consumes: the existing step components already exported from `components/listing-wizard`.
- Produces:

  ```typescript
  interface ListingWizardProps {
    locale: string;
    mode: "owner" | "admin";
    /** Where to send the user after a successful publish. */
    onPublished: (listingId: string) => void;
  }
  export function ListingWizard(props: ListingWizardProps): JSX.Element;
  ```

  Task 8 mounts this with `mode="admin"`.

- [ ] **Step 1: Capture the current green baseline**

Run: `pnpm --filter @cribliv/web exec vitest run components/listing-wizard/`
Expected: PASS. Record the test count — it must be identical after the move.

- [ ] **Step 2: Move the orchestrator body into the shared component**

Create `apps/web/components/listing-wizard/ListingWizard.tsx` containing everything currently in `apps/web/app/[locale]/owner/listings/new/page.tsx` except the default export wrapper. Changes while moving:

- Take `locale`, `mode` and `onPublished` as props instead of reading the route params directly.
- Replace the hardcoded `router.push(\`/${locale}/owner/dashboard\`)`at line 501 with`onPublished(listingId)`.
- Make the storage key mode-aware so an admin draft cannot collide with an owner one:

```typescript
const STORAGE_KEY = mode === "admin" ? "cribliv:wizard-draft:admin" : "cribliv:wizard-draft";
```

Since `STORAGE_KEY` is currently a module constant, move it inside the component or derive it via `useMemo`.

- Fix the relative import depth: the step imports change from `../../../../../components/listing-wizard` to `./`, and `lib/` imports from `../../../../../lib/...` to `../../lib/...`.

- [ ] **Step 3: Reduce the owner route to a wrapper**

Replace the contents of `apps/web/app/[locale]/owner/listings/new/page.tsx` with:

```tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { ListingWizard } from "../../../../../components/listing-wizard/ListingWizard";

export default function NewListingPage() {
  const router = useRouter();
  const params = useParams();
  const locale = typeof params?.locale === "string" ? params.locale : "en";

  return (
    <ListingWizard
      locale={locale}
      mode="owner"
      onPublished={() => router.push(`/${locale}/owner/dashboard`)}
    />
  );
}
```

- [ ] **Step 4: Export from the barrel**

Add to `apps/web/components/listing-wizard/index.ts`:

```typescript
export { ListingWizard } from "./ListingWizard";
```

- [ ] **Step 5: Verify the baseline is unchanged**

Run: `pnpm --filter @cribliv/web exec vitest run components/listing-wizard/`
Expected: PASS, same test count as Step 1.

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors.

- [ ] **Step 6: Verify the owner wizard still renders**

Run: `pnpm dev:web`, sign in as an owner, open `/en/owner/listings/new`, and step through Basics → Location. Confirm no console errors and that a refresh restores the draft.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/listing-wizard apps/web/app/\[locale\]/owner/listings/new/page.tsx
git commit -m "refactor(web): extract ListingWizard orchestrator for reuse"
```

---

### Task 8: Admin "Add Listing" tab

**Files:**

- Create: `apps/web/components/admin/tabs/AddListingTab.tsx`
- Modify: `apps/web/components/admin/shell/AdminSidebar.tsx:29-90`
- Modify: `apps/web/components/admin/shell/AdminShell.tsx`
- Test: `apps/web/components/admin/tabs/__tests__/AddListingTab.test.tsx` (create)

**Interfaces:**

- Consumes: `ListingWizard` (Task 7)
- Produces: an `"add-listing"` member of the `AdminTab` union, rendered by `AdminShell`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/admin/tabs/__tests__/AddListingTab.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddListingTab } from "../AddListingTab";

vi.mock("../../../listing-wizard/ListingWizard", () => ({
  ListingWizard: ({ mode }: { mode: string }) => <div data-testid="wizard">mode:{mode}</div>
}));

describe("AddListingTab", () => {
  it("mounts the shared wizard in admin mode", () => {
    render(<AddListingTab />);
    expect(screen.getByTestId("wizard")).toHaveTextContent("mode:admin");
  });

  it("explains that the listing goes to the owner, not the worker", () => {
    render(<AddListingTab />);
    expect(screen.getByText(/owner's number/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web exec vitest run components/admin/tabs/__tests__/AddListingTab.test.tsx`
Expected: FAIL — cannot resolve `../AddListingTab`.

- [ ] **Step 3: Write the tab**

Create `apps/web/components/admin/tabs/AddListingTab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ListingWizard } from "../../listing-wizard/ListingWizard";
import { SectionCard } from "../primitives/SectionCard";

/**
 * Create-on-behalf. The worker fills the same wizard an owner would, enters the
 * owner's number on the Review step, and publishes — the listing lands in review
 * already owned by that person. Until publish it is a draft under the worker's
 * own account and is never publicly visible.
 */
export function AddListingTab() {
  const [publishedId, setPublishedId] = useState<string | null>(null);

  if (publishedId) {
    return (
      <SectionCard title="Listing submitted" subtitle="Now owned by the number you entered">
        <p>
          The listing is in review and belongs to the owner. Tell them to log in with that number —
          they will get owner access automatically and see the property.
        </p>
        <button type="button" onClick={() => setPublishedId(null)}>
          Add another listing
        </button>
      </SectionCard>
    );
  }

  return (
    <div>
      <SectionCard title="Add a listing for an owner" subtitle="Create-on-behalf">
        <p>
          Fill this in as you normally would. On the last step, enter the owner&apos;s number — the
          listing publishes into their account with their number as the callback number, so you do
          not have to hand it over afterwards.
        </p>
      </SectionCard>
      <ListingWizard locale="en" mode="admin" onPublished={(id) => setPublishedId(id)} />
    </div>
  );
}
```

- [ ] **Step 4: Add the tab to the sidebar**

In `apps/web/components/admin/shell/AdminSidebar.tsx`, add `| "add-listing"` to the `AdminTab` union (line 29-48), and add the nav item to the WORK group next to `homes` (line 82), importing `HousePlus` from `lucide-react`:

```typescript
    { id: "add-listing", label: "Add Listing", icon: HousePlus },
```

- [ ] **Step 5: Render it in the shell**

In `apps/web/components/admin/shell/AdminShell.tsx`, import `AddListingTab` and add a branch alongside the other tabs, matching the file's existing switch/conditional style:

```tsx
{
  activeTab === "add-listing" ? <AddListingTab /> : null;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web exec vitest run components/admin/tabs/__tests__/AddListingTab.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 7: Verify the shell tests still pass**

Run: `pnpm --filter @cribliv/web exec vitest run components/admin/`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/admin
git commit -m "feat(admin-web): add create-on-behalf listing tab"
```

---

### Task 9: Publish-on-behalf

The wizard's admin-mode publish. Transfer and status flip must be one transaction: `submitListing()` is owner-scoped (`owner.service.ts:806`), so once ownership moves, a separate submit call by the admin would fail.

**Files:**

- Modify: `apps/api/src/modules/admin/admin-homes.controller.ts`
- Modify: `apps/web/lib/admin-api.ts`
- Modify: `apps/web/components/listing-wizard/ListingWizard.tsx`
- Test: `apps/api/src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts` (extend)

**Interfaces:**

- Consumes: `AdminListingTransferService.transferOwner` with `alsoSubmit: true` (Task 3); `ListingWizard` (Task 7)
- Produces: `POST /admin/homes/:listing_id/publish-on-behalf`, and `publishListingOnBehalf(accessToken, listingId, phone, fullName?)` in `admin-api.ts`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts`:

```typescript
describe("AdminHomesController.publishOnBehalf", () => {
  it("transfers and submits in one call", async () => {
    const transferOwner = vi.fn(async () => ({
      listing_id: "listing-1",
      owner_user_id: "owner-9",
      owner_phone: "+919956729103",
      leads_moved: 0,
      already_owned: false
    }));
    const controller = new AdminHomesController({} as any, { transferOwner } as any);

    await controller.publishOnBehalf({ user: { id: "admin-1" } }, "listing-1", {
      phone_e164: "+919956729103",
      full_name: "Akash Rai"
    });

    expect(transferOwner).toHaveBeenCalledWith({
      listingId: "listing-1",
      phoneE164: "+919956729103",
      fullName: "Akash Rai",
      adminUserId: "admin-1",
      alsoSubmit: true
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts`
Expected: FAIL — `controller.publishOnBehalf is not a function`.

- [ ] **Step 3: Add the endpoint**

In `apps/api/src/modules/admin/admin-homes.controller.ts`, below `transfer`:

```typescript
  /**
   * Create-on-behalf publish: hand the draft to its owner AND move it into
   * review, atomically. These cannot be two calls — submitListing() is scoped to
   * owner_user_id, so after the transfer the acting admin is no longer the owner
   * and a separate submit would fail.
   */
  @Post(":listing_id/publish-on-behalf")
  async publishOnBehalf(
    @Req() req: { user: { id: string } },
    @Param("listing_id") listingId: string,
    @Body() body: { phone_e164: string; full_name?: string }
  ) {
    return ok(
      await this.transfers.transferOwner({
        listingId,
        phoneE164: body.phone_e164,
        fullName: body.full_name,
        adminUserId: req.user.id,
        alsoSubmit: true
      })
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/admin/__tests__/admin-homes-transfer.controller.test.ts`
Expected: PASS

- [ ] **Step 5: Add the web client function**

In `apps/web/lib/admin-api.ts`:

```typescript
/**
 * Publish a draft created on an owner's behalf. Transfers ownership and moves
 * the listing into review in a single server-side transaction.
 */
export async function publishListingOnBehalf(
  accessToken: string,
  listingId: string,
  phoneE164: string,
  fullName?: string
): Promise<{ ownerUserId: string; ownerPhone: string }> {
  const response = await fetchApi<{ owner_user_id: string; owner_phone: string }>(
    `/admin/homes/${listingId}/publish-on-behalf`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ phone_e164: phoneE164, full_name: fullName })
    }
  );
  return { ownerUserId: response.owner_user_id, ownerPhone: response.owner_phone };
}
```

- [ ] **Step 6: Collect owner details on the Review step in admin mode**

In `apps/web/components/listing-wizard/ListingWizard.tsx`, add two pieces of state:

```typescript
const [ownerPhone, setOwnerPhone] = useState("");
const [ownerName, setOwnerName] = useState("");
```

Render the fields above the publish button when `mode === "admin"`:

```tsx
{
  mode === "admin" ? (
    <div className="wizard-owner-handoff">
      <label htmlFor="onbehalf-phone">Owner&apos;s phone</label>
      <input
        id="onbehalf-phone"
        value={ownerPhone}
        onChange={(e) => setOwnerPhone(e.target.value)}
        placeholder="99567 29103"
        inputMode="tel"
        required
      />
      <label htmlFor="onbehalf-name">Owner&apos;s name (optional)</label>
      <input id="onbehalf-name" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
      <p>Publishing hands this listing to that number. Tenants who unlock will call it, not you.</p>
    </div>
  ) : null;
}
```

In the publish handler, after the existing draft-save call resolves and before `onPublished`, branch on mode. In admin mode call `publishListingOnBehalf` instead of the owner submit, and block publish when the phone is missing:

```typescript
if (mode === "admin") {
  if (!ownerPhone.trim()) {
    setStepErrors([{ step: STEPS.length - 1, message: "Enter the owner's phone number" }]);
    return;
  }
  await publishListingOnBehalf(
    accessToken,
    listingId,
    ownerPhone.trim(),
    ownerName.trim() || undefined
  );
} else {
  await submitOwnerListing(accessToken, listingId);
}
onPublished(listingId);
```

No new prop is needed for the token: the orchestrator already derives `accessToken` from `useSession()` (page.tsx:84-85, carried over in Task 7), and `submitOwnerListing(accessToken, listingId)` is the existing signature at `owner-api.ts:390`.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @cribliv/web exec vitest run components/listing-wizard/ components/admin/`
Expected: PASS

Run: `pnpm --filter @cribliv/web typecheck` and `pnpm --filter @cribliv/api typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/admin apps/web/lib/admin-api.ts apps/web/components/listing-wizard
git commit -m "feat(admin): publish a listing on an owner's behalf"
```

---

### Task 10: End-to-end verification

**Files:**

- Test: `apps/web/tests/admin-listing-transfer.spec.ts` (create)

**Interfaces:**

- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Write the E2E spec**

Create `apps/web/tests/admin-listing-transfer.spec.ts`, using the same helpers as `admin-verified-homes.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";
import { loginAsRole, loginWithOtp, setSessionOnPage } from "./utils/auth";

/** A number that is not a seeded test account, so the transfer must create it. */
const NEW_OWNER_PHONE = "+919956729103";

test("admin transfers a listing and the new owner can see it", async ({ page, request }) => {
  const admin = await loginAsRole(request, "admin");
  await setSessionOnPage(page, admin);

  await page.goto("/en/admin");
  const adminNav = page.getByRole("navigation", { name: /admin navigation/i });
  await adminNav.getByRole("button", { name: "Verified Homes" }).click();
  await expect(page.getByRole("heading", { name: "Verified Homes" })).toBeVisible();

  // Open the first home in the inventory, then its Owner tab.
  await page.getByRole("row").nth(1).click();
  await page.getByRole("button", { name: "Owner" }).click();

  const listingTitle = await page.getByRole("heading").first().innerText();

  await page.getByRole("button", { name: /transfer ownership/i }).click();
  const dialog = page.getByRole("dialog", { name: /transfer ownership/i });
  await dialog.getByLabel(/owner's phone/i).fill("99567 29103");
  await dialog.getByLabel(/owner's name/i).fill("Akash Rai");
  await dialog.getByRole("button", { name: /transfer ownership/i }).click();

  // The workspace refetches, so the Owner tab now shows the new owner.
  await expect(page.getByText(NEW_OWNER_PHONE)).toBeVisible();
  await expect(page.getByText("Akash Rai")).toBeVisible();

  // The transferred-to account was created by the transfer and is an owner, so
  // an OTP login for that number lands in the owner dashboard holding the listing.
  const newOwner = await loginWithOtp(request, NEW_OWNER_PHONE);
  await setSessionOnPage(page, newOwner);
  await page.goto("/en/owner/listings");
  await expect(page.getByText(listingTitle)).toBeVisible();
});
```

This relies on seeded data — run `pnpm db:seed` first. Note that the E2E suite needs a live local database; there is a known gap where CI does not provide one, so treat this as a local gate rather than a CI gate.

- [ ] **Step 2: Run the E2E test**

```bash
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test admin-listing-transfer.spec.ts
```

Expected: PASS. If Playwright browsers are missing, run `pnpm --filter @cribliv/web exec playwright install` first.

- [ ] **Step 3: Full quality gate**

```bash
pnpm lint && pnpm typecheck && pnpm build
```

Expected: all clean.

- [ ] **Step 4: Targeted API suite**

```bash
pnpm --filter @cribliv/api exec vitest run src/modules/admin/ src/modules/owner/ src/modules/leads/
```

Expected: PASS. Do NOT run the full API suite against a live database — migration 0045's rollback drops `keyword_rankings` and `seo_indexing_queue`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/admin-listing-transfer.spec.ts
git commit -m "test(e2e): cover admin listing ownership transfer"
```

---

## Deployment notes

1. **Migration 0069 must be applied to prod before the code that reads `transferred_at` ships.** The API deploys automatically from master via the `deploy-api` CI job, so apply the migration first:
   ```bash
   DATABASE_URL="$PROD_DATABASE_URL" node infra/migrations/run-migrations.js
   ```
2. No feature flag. The endpoints are admin-only and the tab is only visible to admins, so exposure is already limited to staff.
3. Workers need `role = 'admin'` — grant via the existing `POST /admin/users` or the Users tab.
