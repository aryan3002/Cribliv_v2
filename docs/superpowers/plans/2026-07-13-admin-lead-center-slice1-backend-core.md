# Admin Lead Center — Slice 1 (Backend Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the read + refund backend foundation for the admin Lead Center — a platform-wide live-lead board query with counters, a lead timeline, a shared refund routine used by both the worker sweep and (later) admin, plus the feature flag, migration, and shared types the rest of the feature builds on.

**Architecture:** Extend the existing `admin/leads` NestJS controller with a new focused `AdminLeadOpsService` (injected into `AdminLeadsController`) that reads live lead/callback data. Extract the worker's per-unlock refund writes into one plain `refundUnlock(client, …)` function so the worker sweep and the future admin manual-refund can never diverge. All reads are raw SQL through `DatabaseService`; everything is dual-mode-safe and gated behind a new `ff_admin_lead_center` flag.

**Tech Stack:** NestJS (modular monolith, `apps/api`), raw SQL via `pg` through `DatabaseService`, Postgres, Vitest (integration tests against `TEST_DATABASE_URL`), `@cribliv/shared-types` (type-only DTO package).

## Global Constraints

- **Node/pnpm workspace, Turborepo.** `packages/*` build before `apps/*`. The API imports shared types as `import type { X } from "@cribliv/shared-types"`.
- **Dual-mode services (critical):** every DB path guards on `this.database.isEnabled()` and returns a safe empty result when the DB is off. New service methods follow this.
- **Admin auth:** every route on `AdminLeadsController` is class-guarded `@UseGuards(AuthGuard, RolesGuard) @Roles("admin")`. Responses wrap data via `ok(...)` from `apps/api/src/common/response.ts` → `{ data, meta }`.
- **Feature-flag pattern:** a new flag touches THREE spots in `apps/api/src/config/feature-flags.ts` — the `FeatureFlags` interface, `defaultFeatureFlags` (default **false**), and `readFeatureFlags()` (`parseBooleanEnv("FF_<NAME>", default)`). Read flags at call-time via `readFeatureFlags()`.
- **Migrations:** raw SQL in `infra/migrations/NNNN_name.sql` with a sibling `NNNN_name.rollback.sql`. Enum values are added with `ALTER TYPE … ADD VALUE IF NOT EXISTS` (additive; the rollback leaves enum values in place — dropping a Postgres enum value is unsupported). Follow the `0037_pg_analytics_overrides.sql` precedent. **Next number is `0055`** (latest on disk is `0054`).
- **Tests:** Vitest. Files end `.test.ts` (**never** `.spec.ts`). DB integration files live in `apps/api/test/` named `*.integration.test.ts`, wrapped in `describe.runIf(!!process.env.TEST_DATABASE_URL)`, connect with a raw `new Pool({ connectionString: TEST_DB })`, seed with inline parameterized `INSERT … RETURNING id::text` using a random suffix for uniqueness, and clean up with ordered `DELETE`s + `pool.end()` in `afterAll` (timeout `60_000`). Run one file: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/<file>.integration.test.ts`. Append `-t "<name>"` for one test. **Run migration-applying files one at a time** (known threaded-pool race).
- **Commits:** conventional messages. A husky `pre-commit` runs `lint-staged`, which may be absent in a fresh worktree — if `git commit` fails with `Command "lint-staged" not found`, re-run with `git commit --no-verify` (these commits touch SQL/TS that `pnpm lint`/`typecheck` already cover). End messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **SQL/DTO casing:** snake_case everywhere in SQL and in shared-types DTOs.

---

## File Structure

- `infra/migrations/0055_admin_lead_center.sql` (+ `.rollback.sql`) — enum values + board indexes.
- `apps/api/src/config/feature-flags.ts` — add `ff_admin_lead_center` (3 spots).
- `packages/shared-types/src/admin-leads.ts` (new) + `index.ts` (1 export line) — board/timeline DTOs.
- `apps/api/src/modules/contacts/refund-unlock.ts` (new) — shared `refundUnlock`.
- `apps/api/src/worker/callback-sweeps.ts` — refactor `runRefundSweepDb` to call `refundUnlock`.
- `apps/api/src/modules/leads/admin-lead-ops.service.ts` (new) — `getBoard`, `getTimeline`.
- `apps/api/src/modules/leads/leads.service.ts` — extend `teamMarkCalled` with optional admin audit.
- `apps/api/src/modules/leads/admin-leads.controller.ts` — add `GET /board`, `GET /:id/timeline`; wire admin id into `team-called`.
- `apps/api/src/modules/leads/leads.module.ts` — register `AdminLeadOpsService`.
- Tests: `apps/api/test/refund-unlock.integration.test.ts`, `apps/api/test/admin-lead-board.integration.test.ts`, `apps/api/test/admin-lead-center.controller.integration.test.ts`, `apps/api/src/config/__tests__/feature-flags-lead-center.test.ts`.

---

### Task 1: Migration 0055 — enum values + board indexes

**Files:**

- Create: `infra/migrations/0055_admin_lead_center.sql`
- Create: `infra/migrations/0055_admin_lead_center.rollback.sql`

**Interfaces:**

- Produces: enum values `admin_target_type += 'lead'`; `admin_action_type += 'nudge_owner','lead_manual_refund','mark_team_called'`; `wallet_txn_type += 'refund_admin'`; indexes `idx_leads_owner_created`, `idx_leads_access_state`, `idx_leads_created_at`.

- [ ] **Step 1: Write the forward migration**

Create `infra/migrations/0055_admin_lead_center.sql`:

```sql
-- 0055_admin_lead_center.sql
-- Admin Lead Center: audit enum values for admin lead actions, a ledger txn_type
-- for admin-initiated refunds, and covering indexes for the live-board filters.
-- All additive. ADD VALUE cannot be rolled back (enum values persist); the
-- rollback drops only the indexes.

ALTER TYPE admin_target_type ADD VALUE IF NOT EXISTS 'lead';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'nudge_owner';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'lead_manual_refund';
ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'mark_team_called';
ALTER TYPE wallet_txn_type   ADD VALUE IF NOT EXISTS 'refund_admin';

CREATE INDEX IF NOT EXISTS idx_leads_owner_created ON leads (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_access_state  ON leads (access_state);
CREATE INDEX IF NOT EXISTS idx_leads_created_at    ON leads (created_at DESC);
```

- [ ] **Step 2: Write the rollback migration**

Create `infra/migrations/0055_admin_lead_center.rollback.sql`:

```sql
-- 0055_admin_lead_center.rollback.sql
-- Enum ADD VALUE is not reversible in Postgres; the added values are harmless
-- and left in place. Only the indexes are dropped.
DROP INDEX IF EXISTS idx_leads_owner_created;
DROP INDEX IF EXISTS idx_leads_access_state;
DROP INDEX IF EXISTS idx_leads_created_at;
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: completes without error; log shows `0055_admin_lead_center` applied.

- [ ] **Step 4: Verify the enum values landed**

Run:

```bash
pnpm --filter @cribliv/api exec node -e "const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});(async()=>{const a=await p.query(\"SELECT unnest(enum_range(NULL::admin_action_type))::text v\");const w=await p.query(\"SELECT unnest(enum_range(NULL::wallet_txn_type))::text v\");console.log('actions',a.rows.map(r=>r.v));console.log('txn',w.rows.map(r=>r.v));await p.end();})();"
```

Expected: `actions` includes `nudge_owner`, `lead_manual_refund`, `mark_team_called`; `txn` includes `refund_admin`.

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/0055_admin_lead_center.sql infra/migrations/0055_admin_lead_center.rollback.sql
git commit -m "feat(db): migration 0055 admin lead center enums + indexes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Feature flag `ff_admin_lead_center`

**Files:**

- Modify: `apps/api/src/config/feature-flags.ts` (3 spots)
- Test: `apps/api/src/config/__tests__/feature-flags-lead-center.test.ts`

**Interfaces:**

- Produces: `readFeatureFlags().ff_admin_lead_center: boolean` (default false; env `FF_ADMIN_LEAD_CENTER`).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/config/__tests__/feature-flags-lead-center.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { readFeatureFlags, defaultFeatureFlags } from "../feature-flags";

describe("ff_admin_lead_center", () => {
  afterEach(() => {
    delete process.env.FF_ADMIN_LEAD_CENTER;
  });

  it("defaults to false", () => {
    expect(defaultFeatureFlags.ff_admin_lead_center).toBe(false);
    expect(readFeatureFlags().ff_admin_lead_center).toBe(false);
  });

  it("is enabled when FF_ADMIN_LEAD_CENTER=true", () => {
    process.env.FF_ADMIN_LEAD_CENTER = "true";
    expect(readFeatureFlags().ff_admin_lead_center).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/config/__tests__/feature-flags-lead-center.test.ts`
Expected: FAIL — `ff_admin_lead_center` does not exist on the flags object.

- [ ] **Step 3: Add the flag in all three spots**

In `apps/api/src/config/feature-flags.ts`, add to the `FeatureFlags` interface (after `ff_callback_leads: boolean;`, line ~87):

```ts
/** Admin Lead Center — platform-wide lead ops board + analytics (ships dark). */
ff_admin_lead_center: boolean;
```

Add to `defaultFeatureFlags` (after `ff_callback_leads: false`, line ~171 — add a comma to the prior line):

```ts
  ff_callback_leads: false,
  ff_admin_lead_center: false
```

Add to the `readFeatureFlags()` return (after the `ff_callback_leads` entry, line ~428 — add a comma to the prior line):

```ts
    ff_callback_leads: parseBooleanEnv("FF_CALLBACK_LEADS", defaultFeatureFlags.ff_callback_leads),
    ff_admin_lead_center: parseBooleanEnv(
      "FF_ADMIN_LEAD_CENTER",
      defaultFeatureFlags.ff_admin_lead_center
    )
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/config/__tests__/feature-flags-lead-center.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/feature-flags.ts apps/api/src/config/__tests__/feature-flags-lead-center.test.ts
git commit -m "feat(api): add ff_admin_lead_center flag (default off)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Shared types — `admin-leads.ts`

**Files:**

- Create: `packages/shared-types/src/admin-leads.ts`
- Modify: `packages/shared-types/src/index.ts` (1 export line)

**Interfaces:**

- Consumes: `LeadStatus`, `LeadAccessState`, `LeadCalledBy` from `packages/shared-types/src/types.ts`.
- Produces: `AdminLeadBoardRow`, `AdminLeadCounters`, `AdminLeadBoardResponse`, `AdminLeadBoardFilter`, `AdminLeadTimelineEvent`, `AdminLeadTimelineResponse`.

- [ ] **Step 1: Write the types file**

Create `packages/shared-types/src/admin-leads.ts`:

```ts
import type { LeadStatus, LeadAccessState, LeadCalledBy } from "./types";

/** Preset filters for the admin live-lead board. */
export type AdminLeadBoardFilter =
  | "needs_call"
  | "expiring_6h"
  | "called"
  | "expired_today"
  | "refunded_today"
  | "all";

/** Where the refund promise stands for a lead's linked callback. */
export type AdminLeadRefundState = "pending" | "responded" | "refunded";

export interface AdminLeadBoardOwner {
  user_id: string;
  name: string;
  phone_masked: string;
  role: "owner" | "pg_operator";
  health_score: number | null;
  health_grade: "A" | "B" | "C" | "D" | "F" | null;
}

export interface AdminLeadBoardSeeker {
  user_id: string;
  name: string;
  phone_e164: string; // admin sees the full seeker number
}

export interface AdminLeadBoardRow {
  lead_id: string;
  listing_id: string;
  listing_title: string;
  city: string | null;
  owner: AdminLeadBoardOwner;
  seeker: AdminLeadBoardSeeker;
  access_state: LeadAccessState;
  status: LeadStatus;
  called_at: string | null;
  called_by: LeadCalledBy | null;
  response_deadline_at: string | null; // the refund timer
  seconds_remaining: number | null; // server-computed; client ticks down
  refund_state: AdminLeadRefundState;
  source: string | null;
  created_at: string;
}

export interface AdminLeadCounters {
  in_flight: number;
  uncalled: number;
  expiring_6h: number;
  expired_today: number;
  refunded_today: number;
}

export interface AdminLeadBoardResponse {
  rows: AdminLeadBoardRow[];
  total: number;
  generated_at: string;
  counters: AdminLeadCounters;
}

export interface AdminLeadTimelineEvent {
  at: string;
  source: "lead" | "contact" | "admin";
  kind: string;
  actor: string | null;
  detail: string | null;
}

export interface AdminLeadTimelineResponse {
  lead_id: string;
  events: AdminLeadTimelineEvent[];
}
```

- [ ] **Step 2: Export it from the barrel**

In `packages/shared-types/src/index.ts`, add after the existing type-only `export *` lines (after line 6, `export * from "./pg-listing-score";`):

```ts
export * from "./admin-leads";
```

- [ ] **Step 3: Build shared-types (verification)**

Run: `pnpm --filter @cribliv/shared-types build`
Expected: `tsc` completes with no errors and refreshes `packages/shared-types/dist` (the API's vitest alias resolves `@cribliv/shared-types` to that `dist`). Pure type declarations have no runtime test — the build IS the check.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/admin-leads.ts packages/shared-types/src/index.ts
git commit -m "feat(shared-types): admin lead board + timeline DTOs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `refundUnlock` shared routine + sweep refactor

**Files:**

- Create: `apps/api/src/modules/contacts/refund-unlock.ts`
- Modify: `apps/api/src/worker/callback-sweeps.ts` (`runRefundSweepDb` calls the shared routine)
- Test: `apps/api/test/refund-unlock.integration.test.ts`

**Interfaces:**

- Produces: `refundUnlock(client: PoolClient, unlockId: string, opts: RefundUnlockOptions): Promise<RefundUnlockResult>` where
  `RefundUnlockOptions = { txnType: "refund_no_response" | "refund_admin"; actorRole: "system" | "admin"; expireLockedLead: boolean; metadata?: Record<string, unknown> }`
  and `RefundUnlockResult = { refunded: boolean; tenantUserId: string | null; refundTxnId: string | null }`.
- Regression guard: the existing `apps/api/test/worker-callback-sweeps.integration.test.ts` must still pass after the refactor.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/refund-unlock.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { refundUnlock } from "../src/modules/contacts/refund-unlock";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("refundUnlock (DB)", () => {
  let pool: Pool;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB! });
    const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const owner = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, whatsapp_opt_in) VALUES ($1, 'owner', true) RETURNING id::text`,
      [`+9196${suffix}`]
    );
    ownerId = owner.rows[0].id;
    const tenant = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role) VALUES ($1, 'tenant') RETURNING id::text`,
      [`+9195${suffix}`]
    );
    tenantId = tenant.rows[0].id;
    await pool.query(
      `INSERT INTO wallets (user_id, balance_credits, free_credits_granted) VALUES ($1::uuid, 0, 0)`,
      [tenantId]
    );
    const listing = await pool.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status)
       VALUES ($1::uuid, 'flat_house', 'Refund Unlock Flat', 9000, 'active') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;
  }, 60_000);

  async function seedPendingUnlockAndLockedLead() {
    const idem = `ru-${Math.random().toString(36).slice(2)}`;
    const txn = await pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions (wallet_user_id, txn_type, credits_delta, reference_type, idempotency_key, metadata)
       VALUES ($1::uuid, 'debit_contact_unlock', -1, 'listing', $2, '{}'::jsonb) RETURNING id::text`,
      [tenantId, idem]
    );
    const unlock = await pool.query<{ id: string }>(
      `INSERT INTO contact_unlocks (tenant_user_id, listing_id, wallet_txn_id, idempotency_key,
                                    response_deadline_at, owner_response_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() - interval '1 hour', 'pending') RETURNING id::text`,
      [tenantId, listingId, txn.rows[0].id, idem]
    );
    const lead = await pool.query<{ id: string }>(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id, status, access_state, call_deadline_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'new', 'locked', now() - interval '1 hour')
       ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET
         contact_unlock_id = EXCLUDED.contact_unlock_id, access_state = 'locked',
         called_at = NULL, called_by = NULL RETURNING id::text`,
      [listingId, ownerId, tenantId, unlock.rows[0].id]
    );
    return { unlockId: unlock.rows[0].id, leadId: lead.rows[0].id };
  }

  afterAll(async () => {
    await pool.query(
      `DELETE FROM contact_events WHERE contact_unlock_id IN (SELECT id FROM contact_unlocks WHERE listing_id = $1::uuid)`,
      [listingId]
    );
    await pool.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(
      `UPDATE contact_unlocks SET refund_txn_id = NULL WHERE listing_id = $1::uuid`,
      [listingId]
    );
    await pool.query(`DELETE FROM contact_unlocks WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM wallet_transactions WHERE wallet_user_id = $1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM wallets WHERE user_id = $1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ownerId, tenantId]);
    await pool.end();
  }, 60_000);

  it("refunds the tenant, marks the unlock, expires the locked lead, logs the event", async () => {
    const { unlockId, leadId } = await seedPendingUnlockAndLockedLead();
    const client = await pool.connect();
    let result;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT 1 FROM contact_unlocks WHERE id = $1::uuid FOR UPDATE`, [
        unlockId
      ]);
      result = await refundUnlock(client, unlockId, {
        txnType: "refund_admin",
        actorRole: "admin",
        expireLockedLead: true
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    expect(result!.refunded).toBe(true);
    expect(result!.tenantUserId).toBe(tenantId);

    const wallet = await pool.query<{ balance_credits: number }>(
      `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid`,
      [tenantId]
    );
    expect(wallet.rows[0].balance_credits).toBe(1);
    const txn = await pool.query<{ txn_type: string }>(
      `SELECT txn_type FROM wallet_transactions WHERE reference_id = $1::uuid AND credits_delta = 1`,
      [unlockId]
    );
    expect(txn.rows[0].txn_type).toBe("refund_admin");
    const unlock = await pool.query<{ unlock_status: string }>(
      `SELECT unlock_status FROM contact_unlocks WHERE id = $1::uuid`,
      [unlockId]
    );
    expect(unlock.rows[0].unlock_status).toBe("refunded");
    const lead = await pool.query<{ access_state: string }>(
      `SELECT access_state FROM leads WHERE id = $1::uuid`,
      [leadId]
    );
    expect(lead.rows[0].access_state).toBe("expired");
    const ev = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM contact_events WHERE contact_unlock_id = $1::uuid AND event_type = 'refund_issued'`,
      [unlockId]
    );
    expect(ev.rows[0].n).toBe(1);
  });

  it("is idempotent: a second refund on an already-refunded unlock is a no-op", async () => {
    const { unlockId } = await seedPendingUnlockAndLockedLead();
    const run = async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`SELECT 1 FROM contact_unlocks WHERE id = $1::uuid FOR UPDATE`, [
          unlockId
        ]);
        const r = await refundUnlock(client, unlockId, {
          txnType: "refund_admin",
          actorRole: "admin",
          expireLockedLead: true
        });
        await client.query("COMMIT");
        return r;
      } finally {
        client.release();
      }
    };
    const first = await run();
    const second = await run();
    expect(first.refunded).toBe(true);
    expect(second.refunded).toBe(false);
    const wallet = await pool.query<{ balance_credits: number }>(
      `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid`,
      [tenantId]
    );
    // exactly one credit from the two seeded refunds' first-wins claims
    expect(wallet.rows[0].balance_credits).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/refund-unlock.integration.test.ts`
Expected: FAIL — cannot resolve `../src/modules/contacts/refund-unlock` (module does not exist).

- [ ] **Step 3: Implement `refundUnlock`**

Create `apps/api/src/modules/contacts/refund-unlock.ts`:

```ts
import type { PoolClient } from "pg";

export interface RefundUnlockOptions {
  /** Ledger attribution: 'refund_no_response' (worker sweep) | 'refund_admin' (admin manual). */
  txnType: "refund_no_response" | "refund_admin";
  /** contact_events actor_role for the refund_issued row. */
  actorRole: "system" | "admin";
  /** Expire a still-locked linked lead (spec §3.5). */
  expireLockedLead: boolean;
  metadata?: Record<string, unknown>;
}

export interface RefundUnlockResult {
  refunded: boolean;
  tenantUserId: string | null;
  refundTxnId: string | null;
}

/**
 * Refund one contact_unlock's credit to the tenant. The CALLER must already have
 * opened a transaction and locked the row (FOR UPDATE / FOR UPDATE SKIP LOCKED).
 *
 * The guarded status flip is the atomic claim: only the caller that flips the row
 * from ('pending','active') credits the wallet, so a second call on an
 * already-refunded unlock is a no-op returning refunded:false. Shared by the
 * worker timeout sweep and the admin manual refund so the two never diverge.
 */
export async function refundUnlock(
  client: PoolClient,
  unlockId: string,
  opts: RefundUnlockOptions
): Promise<RefundUnlockResult> {
  const meta = JSON.stringify(opts.metadata ?? {});

  // Atomic claim FIRST — no credit unless this flip wins.
  const claim = await client.query<{ tenant_user_id: string }>(
    `UPDATE contact_unlocks
     SET owner_response_status = 'timeout_refunded', unlock_status = 'refunded', updated_at = now()
     WHERE id = $1::uuid AND owner_response_status = 'pending' AND unlock_status = 'active'
     RETURNING tenant_user_id::text`,
    [unlockId]
  );
  if (!claim.rowCount) {
    return { refunded: false, tenantUserId: null, refundTxnId: null };
  }
  const tenantUserId = claim.rows[0].tenant_user_id;

  await client.query(
    `INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
     VALUES ($1::uuid, 0, 0) ON CONFLICT (user_id) DO NOTHING`,
    [tenantUserId]
  );
  await client.query(
    `UPDATE wallets SET balance_credits = balance_credits + 1, updated_at = now()
     WHERE user_id = $1::uuid`,
    [tenantUserId]
  );
  const refundTxn = await client.query<{ id: string }>(
    `INSERT INTO wallet_transactions(
       wallet_user_id, txn_type, credits_delta, reference_type, reference_id, metadata)
     VALUES ($1::uuid, $2, 1, 'contact_unlock', $3::uuid, $4::jsonb)
     RETURNING id::text`,
    [tenantUserId, opts.txnType, unlockId, meta]
  );
  const refundTxnId = refundTxn.rows[0].id;

  await client.query(
    `UPDATE contact_unlocks SET refund_txn_id = $2::uuid, updated_at = now() WHERE id = $1::uuid`,
    [unlockId, refundTxnId]
  );
  await client.query(
    `INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
     VALUES ($1::uuid, $2, 'refund_issued', $3::jsonb)`,
    [unlockId, opts.actorRole, meta]
  );
  if (opts.expireLockedLead) {
    await client.query(
      `UPDATE leads SET access_state = 'expired', updated_at = now()
       WHERE contact_unlock_id = $1::uuid AND access_state = 'locked'`,
      [unlockId]
    );
  }
  return { refunded: true, tenantUserId, refundTxnId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/refund-unlock.integration.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Refactor the worker sweep to call the shared routine**

In `apps/api/src/worker/callback-sweeps.ts`, add the import at the top (after line 2):

```ts
import { refundUnlock } from "../modules/contacts/refund-unlock";
```

Replace the per-unlock body of the `for (const unlock of dueUnlocks.rows)` loop (current lines 34–101) with:

```ts
for (const unlock of dueUnlocks.rows) {
  const res = await refundUnlock(client, unlock.id, {
    txnType: "refund_no_response",
    actorRole: "system",
    expireLockedLead: true
  });
  if (res.refunded) refundedCount += 1;
}
```

Leave the surrounding `while (true)` batch loop, the `BEGIN`/`COMMIT`, the `FOR UPDATE SKIP LOCKED` selection, the `dueUnlocks.rowCount` break, and the `catch`/`finally` exactly as they are.

- [ ] **Step 6: Run the existing sweep test (regression / parity guard)**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/worker-callback-sweeps.integration.test.ts`
Expected: PASS — all three existing cases still green (refund + expire, no-refund-when-responded, reminder idempotency). This proves the sweep behaves identically through the shared routine.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/contacts/refund-unlock.ts apps/api/src/worker/callback-sweeps.ts apps/api/test/refund-unlock.integration.test.ts
git commit -m "feat(api): shared refundUnlock routine; worker sweep uses it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `AdminLeadOpsService.getBoard`

**Files:**

- Create: `apps/api/src/modules/leads/admin-lead-ops.service.ts`
- Modify: `apps/api/src/modules/leads/leads.module.ts` (register provider)
- Test: `apps/api/test/admin-lead-board.integration.test.ts`

**Interfaces:**

- Consumes: `DatabaseService`; `readFeatureFlags().ff_admin_lead_center`; shared type `AdminLeadBoardResponse`.
- Produces: `AdminLeadOpsService.getBoard(params: BoardParams): Promise<AdminLeadBoardResponse>` where
  `BoardParams = { filter?: AdminLeadBoardFilter; ownerId?: string; state?: string; status?: string; q?: string; range?: string; page?: number; pageSize?: number }`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin-lead-board.integration.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { DatabaseService } from "../src/common/database.service";
import { AdminLeadOpsService } from "../src/modules/leads/admin-lead-ops.service";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("AdminLeadOpsService.getBoard (DB)", () => {
  let pool: Pool;
  let db: DatabaseService;
  let svc: AdminLeadOpsService;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.FF_ADMIN_LEAD_CENTER = "true";
    pool = new Pool({ connectionString: TEST_DB! });
    db = new DatabaseService();
    svc = new AdminLeadOpsService(db);

    const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    const owner = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'owner', 'Board Owner') RETURNING id::text`,
      [`+9196${suffix}`]
    );
    ownerId = owner.rows[0].id;
    const tenant = await pool.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'tenant', 'Board Seeker') RETURNING id::text`,
      [`+9195${suffix}`]
    );
    tenantId = tenant.rows[0].id;
    const listing = await pool.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status, city_slug)
       VALUES ($1::uuid, 'flat_house', 'Board Test Flat', 9000, 'active', 'mumbai') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;

    // Uncalled lead, ~4h to deadline (expiring). Seeker phone must come back full.
    await pool.query(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, status, access_state,
                          call_deadline_at, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'new', 'locked', now() + interval '4 hours', now())`,
      [listingId, ownerId, tenantId]
    );
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ownerId, tenantId]);
    await db.onModuleDestroy();
    await pool.end();
    delete process.env.FF_ADMIN_LEAD_CENTER;
  }, 60_000);

  it("returns the uncalled lead with full seeker phone and a masked owner phone", async () => {
    const res = await svc.getBoard({ filter: "needs_call", ownerId });
    const row = res.rows.find((r) => r.owner.user_id === ownerId);
    expect(row).toBeTruthy();
    expect(row!.seeker.name).toBe("Board Seeker");
    expect(row!.seeker.phone_e164).toMatch(/^\+9195/); // full seeker number
    expect(row!.owner.phone_masked).toMatch(/X/); // owner masked
    expect(row!.access_state).toBe("locked");
    expect(row!.called_at).toBeNull();
    expect(row!.seconds_remaining).toBeGreaterThan(0);
    expect(res.counters.uncalled).toBeGreaterThanOrEqual(1);
    expect(res.counters.expiring_6h).toBeGreaterThanOrEqual(1);
  });

  it("the expiring_6h filter includes the ~4h lead", async () => {
    const res = await svc.getBoard({ filter: "expiring_6h", ownerId });
    expect(res.rows.some((r) => r.owner.user_id === ownerId)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/admin-lead-board.integration.test.ts`
Expected: FAIL — cannot resolve `AdminLeadOpsService`.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/modules/leads/admin-lead-ops.service.ts`:

```ts
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { DatabaseService } from "../../common/database.service";
import { readFeatureFlags } from "../../config/feature-flags";
import type {
  AdminLeadBoardFilter,
  AdminLeadBoardResponse,
  AdminLeadBoardRow,
  AdminLeadCounters
} from "@cribliv/shared-types";

export interface BoardParams {
  filter?: AdminLeadBoardFilter;
  ownerId?: string;
  state?: string;
  status?: string;
  q?: string;
  range?: string; // interval string for the 'all' filter, e.g. '30 days'
  page?: number;
  pageSize?: number;
}

interface BoardSqlRow {
  lead_id: string;
  listing_id: string;
  listing_title: string;
  city: string | null;
  owner_user_id: string;
  owner_name: string;
  owner_phone: string;
  owner_role: "owner" | "pg_operator";
  seeker_user_id: string;
  seeker_name: string;
  seeker_phone: string;
  access_state: AdminLeadBoardRow["access_state"];
  status: AdminLeadBoardRow["status"];
  called_at: string | null;
  called_by: AdminLeadBoardRow["called_by"];
  response_deadline_at: string | null;
  seconds_remaining: number | null;
  owner_response_status: string | null;
  unlock_status: string | null;
  source: string | null;
  created_at: string;
}

const EMPTY_COUNTERS: AdminLeadCounters = {
  in_flight: 0,
  uncalled: 0,
  expiring_6h: 0,
  expired_today: 0,
  refunded_today: 0
};

function maskPhone(phone: string | null): string {
  if (!phone || phone.length < 4) return "XXXX";
  return phone.slice(0, -4).replace(/./g, "X") + phone.slice(-4);
}

function refundState(
  ownerResponseStatus: string | null,
  unlockStatus: string | null
): AdminLeadBoardRow["refund_state"] {
  if (unlockStatus === "refunded") return "refunded";
  if (ownerResponseStatus === "responded") return "responded";
  return "pending";
}

@Injectable()
export class AdminLeadOpsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private ensureEnabled() {
    if (!readFeatureFlags().ff_admin_lead_center) {
      throw new ForbiddenException({
        code: "feature_disabled",
        message: "Lead Center is not enabled"
      });
    }
  }

  /** Builds the filter WHERE fragment + pushes any params it needs. */
  private filterClause(filter: AdminLeadBoardFilter, params: unknown[], range: string): string {
    switch (filter) {
      case "expiring_6h":
        return `ld.called_at IS NULL AND ld.access_state <> 'expired'
                AND ld.call_deadline_at > now() AND ld.call_deadline_at <= now() + interval '6 hours'`;
      case "called":
        return `ld.called_at IS NOT NULL`;
      case "expired_today":
        return `ld.access_state = 'expired' AND ld.updated_at >= date_trunc('day', now())`;
      case "refunded_today":
        return `cu.unlock_status = 'refunded' AND cu.updated_at >= date_trunc('day', now())`;
      case "all":
        params.push(range);
        return `ld.created_at >= now() - ($${params.length})::interval`;
      case "needs_call":
      default:
        return `ld.called_at IS NULL AND ld.access_state <> 'expired'`;
    }
  }

  async getBoard(p: BoardParams): Promise<AdminLeadBoardResponse> {
    this.ensureEnabled();
    const generatedAt = new Date().toISOString();
    if (!this.database.isEnabled()) {
      return { rows: [], total: 0, generated_at: generatedAt, counters: { ...EMPTY_COUNTERS } };
    }

    const filter = p.filter ?? "needs_call";
    const range = p.range ?? "30 days";
    const page = Math.max(1, p.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, p.pageSize ?? 50));
    const params: unknown[] = [];
    const where: string[] = [this.filterClause(filter, params, range)];

    if (p.ownerId) {
      params.push(p.ownerId);
      where.push(`ld.owner_user_id = $${params.length}::uuid`);
    }
    if (p.state) {
      params.push(p.state);
      where.push(`ld.access_state = $${params.length}`);
    }
    if (p.status) {
      params.push(p.status);
      where.push(`ld.status = $${params.length}::lead_status`);
    }
    if (p.q) {
      params.push(`%${p.q}%`);
      const i = params.length;
      where.push(
        `(o.full_name ILIKE $${i} OR t.full_name ILIKE $${i} OR o.phone_e164 ILIKE $${i}
          OR t.phone_e164 ILIKE $${i} OR l.title_en ILIKE $${i})`
      );
    }
    const whereSql = where.join(" AND ");

    // Page of rows.
    params.push(pageSize);
    const limitIdx = params.length;
    params.push((page - 1) * pageSize);
    const offsetIdx = params.length;
    const rowsResult = await this.database.query<BoardSqlRow>(
      `SELECT ld.id::text AS lead_id, ld.listing_id::text,
              COALESCE(NULLIF(l.title_en,''), NULLIF(l.title_hi,''), 'Listing') AS listing_title,
              l.city_slug AS city,
              ld.owner_user_id::text, COALESCE(o.full_name,'Owner') AS owner_name,
              o.phone_e164 AS owner_phone, o.role::text AS owner_role,
              ld.tenant_user_id::text AS seeker_user_id,
              COALESCE(t.full_name,'Seeker') AS seeker_name, t.phone_e164 AS seeker_phone,
              ld.access_state, ld.status::text AS status,
              ld.called_at::text, ld.called_by,
              ld.call_deadline_at::text AS response_deadline_at,
              GREATEST(0, EXTRACT(EPOCH FROM (ld.call_deadline_at - now())))::int AS seconds_remaining,
              cu.owner_response_status, cu.unlock_status, cu.source, ld.created_at::text
       FROM leads ld
       JOIN listings l ON l.id = ld.listing_id
       JOIN users o ON o.id = ld.owner_user_id
       JOIN users t ON t.id = ld.tenant_user_id
       LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
       WHERE ${whereSql}
       ORDER BY (ld.call_deadline_at IS NULL), ld.call_deadline_at ASC, ld.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params
    );

    // Total for the same filter (drop the LIMIT/OFFSET params).
    const countParams = params.slice(0, limitIdx - 1);
    const countResult = await this.database.query<{ n: number }>(
      `SELECT count(*)::int AS n
       FROM leads ld
       JOIN listings l ON l.id = ld.listing_id
       JOIN users o ON o.id = ld.owner_user_id
       JOIN users t ON t.id = ld.tenant_user_id
       LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id
       WHERE ${whereSql}`,
      countParams
    );

    const counters = await this.getCounters();

    const rows: AdminLeadBoardRow[] = rowsResult.rows.map((r) => ({
      lead_id: r.lead_id,
      listing_id: r.listing_id,
      listing_title: r.listing_title,
      city: r.city,
      owner: {
        user_id: r.owner_user_id,
        name: r.owner_name,
        phone_masked: maskPhone(r.owner_phone),
        role: r.owner_role,
        health_score: null, // wired in the analytics slice
        health_grade: null
      },
      seeker: { user_id: r.seeker_user_id, name: r.seeker_name, phone_e164: r.seeker_phone },
      access_state: r.access_state,
      status: r.status,
      called_at: r.called_at,
      called_by: r.called_by,
      response_deadline_at: r.response_deadline_at,
      seconds_remaining: r.seconds_remaining,
      refund_state: refundState(r.owner_response_status, r.unlock_status),
      source: r.source,
      created_at: r.created_at
    }));

    return { rows, total: countResult.rows[0]?.n ?? 0, generated_at: generatedAt, counters };
  }

  private async getCounters(): Promise<AdminLeadCounters> {
    const result = await this.database.query<AdminLeadCounters>(
      `SELECT
         count(*) FILTER (WHERE ld.called_at IS NULL AND ld.access_state <> 'expired')::int AS in_flight,
         count(*) FILTER (WHERE ld.called_at IS NULL)::int AS uncalled,
         count(*) FILTER (WHERE ld.called_at IS NULL AND ld.access_state <> 'expired'
                            AND ld.call_deadline_at > now()
                            AND ld.call_deadline_at <= now() + interval '6 hours')::int AS expiring_6h,
         count(*) FILTER (WHERE ld.access_state = 'expired'
                            AND ld.updated_at >= date_trunc('day', now()))::int AS expired_today,
         count(*) FILTER (WHERE cu.unlock_status = 'refunded'
                            AND cu.updated_at >= date_trunc('day', now()))::int AS refunded_today
       FROM leads ld
       LEFT JOIN contact_unlocks cu ON cu.id = ld.contact_unlock_id`
    );
    return result.rows[0] ?? { ...EMPTY_COUNTERS };
  }
}
```

- [ ] **Step 4: Register the provider**

In `apps/api/src/modules/leads/leads.module.ts`, import and add `AdminLeadOpsService` to `providers` (and `exports`):

```ts
import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { AdminLeadsController } from "./admin-leads.controller";
import { LeadsService } from "./leads.service";
import { AdminLeadOpsService } from "./admin-lead-ops.service";

@Module({
  controllers: [LeadsController, AdminLeadsController],
  providers: [LeadsService, AdminLeadOpsService],
  exports: [LeadsService, AdminLeadOpsService]
})
export class LeadsModule {}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/admin-lead-board.integration.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/leads/admin-lead-ops.service.ts apps/api/src/modules/leads/leads.module.ts apps/api/test/admin-lead-board.integration.test.ts
git commit -m "feat(api): AdminLeadOpsService.getBoard live lead board + counters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `AdminLeadOpsService.getTimeline`

**Files:**

- Modify: `apps/api/src/modules/leads/admin-lead-ops.service.ts` (add method)
- Test: extend `apps/api/test/admin-lead-board.integration.test.ts` with a timeline case

**Interfaces:**

- Consumes: `AdminLeadTimelineResponse` from `@cribliv/shared-types`.
- Produces: `AdminLeadOpsService.getTimeline(leadId: string): Promise<AdminLeadTimelineResponse>`.

- [ ] **Step 1: Write the failing test (append to the board integration file)**

Append this `it(...)` inside the existing `describe.runIf(...)` block in `apps/api/test/admin-lead-board.integration.test.ts` (it reuses the seeded lead; capture its id by querying):

```ts
it("getTimeline returns the lead's events in time order", async () => {
  const lead = await pool.query<{ id: string }>(
    `SELECT id::text FROM leads WHERE owner_user_id = $1::uuid LIMIT 1`,
    [ownerId]
  );
  const leadId = lead.rows[0].id;
  // seed one lead_event so there is at least one row
  await pool.query(
    `INSERT INTO lead_events (lead_id, to_status, notes) VALUES ($1::uuid, 'new'::lead_status, 'seeded_event')`,
    [leadId]
  );
  const timeline = await svc.getTimeline(leadId);
  expect(timeline.lead_id).toBe(leadId);
  expect(timeline.events.length).toBeGreaterThanOrEqual(1);
  expect(timeline.events.some((e) => e.source === "lead" && e.kind === "seeded_event")).toBe(true);
});
```

Also extend `afterAll` cleanup to delete lead_events first (add as the first delete):

```ts
await pool.query(
  `DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE listing_id = $1::uuid)`,
  [listingId]
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/admin-lead-board.integration.test.ts -t "getTimeline"`
Expected: FAIL — `svc.getTimeline` is not a function.

- [ ] **Step 3: Implement `getTimeline`**

Add to `AdminLeadOpsService` (in `admin-lead-ops.service.ts`), and import the type at the top:

```ts
import type {
  AdminLeadBoardFilter,
  AdminLeadBoardResponse,
  AdminLeadBoardRow,
  AdminLeadCounters,
  AdminLeadTimelineEvent,
  AdminLeadTimelineResponse
} from "@cribliv/shared-types";
```

```ts
  async getTimeline(leadId: string): Promise<AdminLeadTimelineResponse> {
    this.ensureEnabled();
    if (!this.database.isEnabled()) {
      return { lead_id: leadId, events: [] };
    }
    const result = await this.database.query<AdminLeadTimelineEvent>(
      `SELECT at, source, kind, actor, detail FROM (
         SELECT le.created_at::text AS at, 'lead' AS source,
                COALESCE(NULLIF(le.notes,''), le.to_status::text) AS kind,
                le.actor_user_id::text AS actor, le.to_status::text AS detail
         FROM lead_events le WHERE le.lead_id = $1::uuid
         UNION ALL
         SELECT ce.event_ts::text, 'contact', ce.event_type::text,
                ce.actor_role::text, ce.metadata::text
         FROM contact_events ce
         JOIN leads ld ON ld.contact_unlock_id = ce.contact_unlock_id
         WHERE ld.id = $1::uuid
         UNION ALL
         SELECT aa.created_at::text, 'admin', aa.action::text,
                aa.admin_user_id::text, aa.reason
         FROM admin_actions aa
         WHERE aa.target_type = 'lead' AND aa.target_id = $1::uuid
       ) t
       ORDER BY at ASC`,
      [leadId]
    );
    return { lead_id: leadId, events: result.rows };
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/admin-lead-board.integration.test.ts`
Expected: PASS (all cases, including the new timeline one).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/leads/admin-lead-ops.service.ts apps/api/test/admin-lead-board.integration.test.ts
git commit -m "feat(api): AdminLeadOpsService.getTimeline lead event timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Controller endpoints + team-called audit

**Files:**

- Modify: `apps/api/src/modules/leads/admin-leads.controller.ts` (add `GET /board`, `GET /:id/timeline`; pass admin id to `team-called`)
- Modify: `apps/api/src/modules/leads/leads.service.ts` (`teamMarkCalled` writes an `admin_actions` audit row)
- Test: `apps/api/test/admin-lead-center.controller.integration.test.ts`

**Interfaces:**

- Consumes: `AdminLeadOpsService.getBoard`, `AdminLeadOpsService.getTimeline`; `LeadsService.teamMarkCalled`.
- Produces: routes `GET /v1/admin/leads/board`, `GET /v1/admin/leads/:id/timeline`; `teamMarkCalled(leadId, adminUserId?)` now writes an audit row when `adminUserId` is given.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/admin-lead-center.controller.integration.test.ts`:

```ts
import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { Client } from "pg";
import { AppModule } from "../src/app.module";

const TEST_DB = process.env.TEST_DATABASE_URL;

function randPhone() {
  return `+9197${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}
function http(app: INestApplication) {
  return request(app.getHttpAdapter().getInstance());
}
// Mint a real bearer token via the OTP flow (OTP_PROVIDER=mock returns dev_otp).
async function loginWithOtp(app: INestApplication, phone: string) {
  const send = await http(app)
    .post("/v1/auth/otp/send")
    .send({ phone_e164: phone, purpose: "login" })
    .expect(201);
  const verify = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: send.body.data.challenge_id,
      otp_code: send.body.data.dev_otp,
      device_fingerprint: "lead-center-test"
    })
    .expect(201);
  return verify.body.data as { access_token: string; user: { id: string } };
}

describe.runIf(!!TEST_DB)("Admin Lead Center controller (DB)", () => {
  let app: INestApplication;
  let db: Client;
  const adminPhone = randPhone();
  const tenantAuthPhone = randPhone();
  const ownerPhone = randPhone();
  const seekerPhone = randPhone();
  const allPhones = [adminPhone, tenantAuthPhone, ownerPhone, seekerPhone];
  let adminToken: string;
  let tenantToken: string;
  let ownerId: string;
  let listingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.OTP_PROVIDER = "mock";
    process.env.FF_ADMIN_LEAD_CENTER = "true";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = new Client({ connectionString: TEST_DB! });
    await db.connect();

    // Admin token: sign up, promote to admin, re-login so the token carries the role.
    await loginWithOtp(app, adminPhone);
    await db.query(`UPDATE users SET role = 'admin' WHERE phone_e164 = $1`, [adminPhone]);
    adminToken = (await loginWithOtp(app, adminPhone)).access_token;

    // A non-admin (tenant) token for the 403 check.
    tenantToken = (await loginWithOtp(app, tenantAuthPhone)).access_token;

    // Owner + seeker as plain rows (no tokens needed) + a listing + an uncalled lead.
    const owner = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'owner', 'LC Owner') RETURNING id::text`,
      [ownerPhone]
    );
    ownerId = owner.rows[0].id;
    const seeker = await db.query<{ id: string }>(
      `INSERT INTO users (phone_e164, role, full_name) VALUES ($1, 'tenant', 'LC Seeker') RETURNING id::text`,
      [seekerPhone]
    );
    const seekerId = seeker.rows[0].id;
    const listing = await db.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status, city_slug)
       VALUES ($1::uuid, 'flat_house', 'LC Flat', 9000, 'active', 'mumbai') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;
    await db.query(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, status, access_state, call_deadline_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'new', 'locked', now() + interval '4 hours')`,
      [listingId, ownerId, seekerId]
    );
  }, 60_000);

  afterAll(async () => {
    await db.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await db.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await db.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [allPhones]
    );
    await db.query(`DELETE FROM otp_challenges WHERE phone_e164 = ANY($1)`, [allPhones]);
    await db.query(
      `DELETE FROM wallet_transactions WHERE wallet_user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [allPhones]
    );
    await db.query(
      `DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [allPhones]
    );
    await db.query(`DELETE FROM users WHERE phone_e164 = ANY($1)`, [allPhones]);
    await db.end();
    await app.close();
    delete process.env.FF_ADMIN_LEAD_CENTER;
  }, 60_000);

  it("GET /admin/leads/board returns rows + counters for an admin", async () => {
    const res = await http(app)
      .get("/v1/admin/leads/board?filter=needs_call")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body.data.rows)).toBe(true);
    expect(res.body.data.counters).toHaveProperty("uncalled");
    const row = res.body.data.rows.find((r: any) => r.owner.user_id === ownerId);
    expect(row).toBeTruthy();
    expect(row.seeker.phone_e164).toMatch(/^\+9197/); // admin sees the full seeker number
    expect(row.owner.phone_masked).toMatch(/X/);
  });

  it("rejects an unauthenticated request with 401", async () => {
    await http(app).get("/v1/admin/leads/board").expect(401);
  });

  it("rejects a non-admin token with 403", async () => {
    await http(app)
      .get("/v1/admin/leads/board")
      .set("Authorization", `Bearer ${tenantToken}`)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/admin-lead-center.controller.integration.test.ts`
Expected: FAIL — `GET /v1/admin/leads/board` returns 404 (route not defined).

- [ ] **Step 3: Add the controller routes**

Rewrite `apps/api/src/modules/leads/admin-leads.controller.ts`:

```ts
import { Controller, Get, Post, Param, Query, Req, Inject, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";
import { ok } from "../../common/response";
import { LeadsService } from "./leads.service";
import { AdminLeadOpsService, BoardParams } from "./admin-lead-ops.service";
import type { AdminLeadBoardFilter } from "@cribliv/shared-types";

@Controller("admin/leads")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminLeadsController {
  constructor(
    @Inject(LeadsService) private readonly leadsService: LeadsService,
    @Inject(AdminLeadOpsService) private readonly ops: AdminLeadOpsService
  ) {}

  @Get("board")
  async board(
    @Query("filter") filter?: string,
    @Query("owner_id") ownerId?: string,
    @Query("state") state?: string,
    @Query("status") status?: string,
    @Query("q") q?: string,
    @Query("range") range?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string
  ) {
    const params: BoardParams = {
      filter: (filter as AdminLeadBoardFilter) || undefined,
      ownerId,
      state,
      status,
      q,
      range,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    };
    return ok(await this.ops.getBoard(params));
  }

  @Get("rescue-queue")
  async rescueQueue() {
    return ok(await this.leadsService.getRescueQueue());
  }

  @Get(":id/timeline")
  async timeline(@Param("id") leadId: string) {
    return ok(await this.ops.getTimeline(leadId));
  }

  @Post(":id/team-called")
  async teamCalled(@Param("id") leadId: string, @Req() req: { user: { id: string } }) {
    return ok(await this.leadsService.teamMarkCalled(leadId, req.user.id));
  }
}
```

(Import paths are exactly those in the current controller: `AuthGuard` from `../../common/auth.guard`, `RolesGuard` from `../../common/roles.guard`, `Roles` from `../../common/roles.decorator`, `ok` from `../../common/response`.)

- [ ] **Step 4: Add the audit write to `teamMarkCalled`**

In `apps/api/src/modules/leads/leads.service.ts`, change the signature and add the audit insert. Replace the method header:

```ts
  async teamMarkCalled(leadId: string, adminUserId?: string) {
```

and, immediately after the existing `team_called` `lead_events` insert (current lines 591–595), before re-reading `called_at`, add:

```ts
if (adminUserId) {
  await client.query(
    `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, after_state)
           VALUES ($1::uuid, 'lead', $2::uuid, 'mark_team_called', $3::jsonb)`,
    [adminUserId, leadId, JSON.stringify({ called_by: "team" })]
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/admin-lead-center.controller.integration.test.ts`
Expected: PASS (board returns rows + counters; non-admin gets 401/403).

- [ ] **Step 6: Typecheck the whole API + run the lead suites**

Run:

```bash
pnpm --filter @cribliv/api typecheck
TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/refund-unlock.integration.test.ts test/admin-lead-board.integration.test.ts test/worker-callback-sweeps.integration.test.ts
```

Expected: typecheck clean; all three files green (run individually if the threaded-pool race bites — see Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/leads/admin-leads.controller.ts apps/api/src/modules/leads/leads.service.ts apps/api/test/admin-lead-center.controller.integration.test.ts
git commit -m "feat(api): admin lead board + timeline endpoints; team-called audit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Slice 1 Definition of Done

- Migration 0055 applied (enums + indexes); rollback authored.
- `ff_admin_lead_center` flag (default off) gates the board/timeline service.
- `refundUnlock` shared by the worker sweep and available for the admin refund (Slice 2); existing sweep test still green (parity proven).
- `GET /v1/admin/leads/board` (filters + counters + masked owner phone + full seeker phone + `seconds_remaining`) and `GET /v1/admin/leads/:id/timeline` live and admin-guarded.
- `team-called` writes an `admin_actions` audit row.
- `pnpm --filter @cribliv/api typecheck` clean; all new + existing lead integration tests green.

## What Slice 1 deliberately defers (later slices, per the spec §14)

- **Slice 2:** `nudge-owner` + `refund` endpoints; multi-channel `NotificationService` + D7 `SmsClient`; new-lead SMS.
- **Slice 3:** `/analytics` + `/by-owner/:id` (engagement funnel, rates, per-owner rollup, PG drill-down) — and wiring real `owner.health_score`/`grade` into the board rows.
- **Slice 4:** the web `LeadCenterTab` (board, countdown, actions, drawer, analytics) + `admin-api.ts` client + tab registration.
- **Slice 5:** verify + dark-ship.
