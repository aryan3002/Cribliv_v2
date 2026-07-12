# Admin Lead Center — Slice 2 (Actions + Multi-channel Notifications) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the admin lead **actions** (manual refund, nudge owner) on top of Slice 1's read foundation, harden the board's query-param handling, and stand up a **multi-channel notification** layer (WhatsApp + a new D7 transactional SMS client) so new-lead and nudge alerts can reach owners on both channels.

**Architecture:** Two new admin endpoints on the existing `admin/leads` controller, backed by `AdminLeadOpsService` methods that reuse Slice 1's shared `refundUnlock()` and the existing `NotificationService`. A per-type `channels` field on notification templates drives a per-channel dispatch loop in `NotificationService`; a new `SmsClient` (mirroring `WhatsAppClient`, mock-default) handles SMS via D7's messaging API; the worker gains a parallel `notification.sms.*` dispatch branch.

**Tech Stack:** NestJS (`apps/api`), raw SQL via `pg`/`DatabaseService`, Postgres, Vitest, `@cribliv/shared-types`, D7 Networks (SMS), WhatsApp (Meta) — both provider-gated with a `mock` default.

## Global Constraints

- **Builds on Slice 1** (branch `claude/lead-analytics-dashboards-7449c3`, PR #70): migration 0055 already added `admin_action_type` values `nudge_owner`/`lead_manual_refund` and `wallet_txn_type` `refund_admin`, and `refundUnlock(client, unlockId, opts)` exists in `apps/api/src/modules/contacts/refund-unlock.ts`. **No new migration is required in this slice.** (`notification_log.channel` already permits `'sms'` per 0008.)
- **No database is available in this environment.** DB integration tests are WRITTEN but self-skip via `describe.runIf(!!process.env.TEST_DATABASE_URL)`. The verification gate for DB-dependent tasks is `pnpm --filter @cribliv/api typecheck` (must stay clean — the baseline is clean) plus the full non-DB suite (`pnpm --filter @cribliv/api test`). Pure-logic tasks (validation helper, channel fan-out with a fake client) get REAL unit tests that run.
- **Dual-mode:** every DB path guards on `this.database.isEnabled()`.
- **Admin routes** on `AdminLeadsController` are class-guarded `@UseGuards(AuthGuard, RolesGuard) @Roles("admin")`; responses wrap via `ok(...)`.
- **Provider gating:** the new `SmsClient` reads `SMS_PROVIDER` (`d7|mock`, default `mock`); `mock` logs + returns success (no network). Real SMS additionally needs DLT-registered templates (external, out of code scope) — see the Rollout section.
- **Notifications are opt-in for WhatsApp only:** the existing `resolveRecipient` gates on `whatsapp_opt_in`. Transactional SMS (new-lead, nudge) is operational, so SMS dispatch does NOT gate on `whatsapp_opt_in` — it only needs a phone. (No `sms_opt_in` column is introduced; DLT consent is handled at registration.)
- **Tests:** Vitest, `.test.ts` (never `.spec.ts`); DB integration files in `apps/api/test/*.integration.test.ts` with the raw-`pg` harness (`new Pool`, `describe.runIf(!!TEST_DATABASE_URL)`, inline seed, ordered-DELETE cleanup incl. `admin_actions` before `users`). Unit tests live in `src/**/__tests__/**/*.test.ts`. Run one file: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run <path>`.
- **Commits:** conventional; `lint-staged` is installed (a normal `git commit` runs prettier/eslint on staged files). End messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `apps/api/src/modules/leads/board-params.ts` (new) — pure `sanitizeBoardParams` helper.
- `apps/api/src/modules/leads/admin-lead-ops.service.ts` — use the sanitizer in `getBoard`; add `refundLead(...)` and `nudgeOwner(...)`.
- `apps/api/src/modules/leads/admin-leads.controller.ts` — add `POST :id/refund`, `POST :id/nudge-owner`.
- `apps/api/src/modules/leads/leads.module.ts` — import `NotificationsModule` (for `NotificationService` injection into `AdminLeadOpsService`).
- `apps/api/src/modules/notifications/notification.templates.ts` — add `channels` field; add `owner.lead_nudge`; set `owner.contact_unlocked` channels.
- `apps/api/src/modules/notifications/notification.service.ts` — per-channel dispatch + `channel`-aware logging; inject `SmsClient`.
- `apps/api/src/modules/notifications/sms.client.ts` (new) — D7 transactional SMS (mock default).
- `apps/api/src/modules/notifications/notifications.module.ts` — register `SmsClient`.
- `apps/api/src/worker/worker.ts` — `notification.sms.*` dispatch branch + `dispatchSmsEvent` + `SmsClient` instance.
- `apps/api/src/modules/contacts/refund-unlock.ts` — (unchanged; the refund endpoint guards `already_responded` so the hardcoded `owner_response_status='timeout_refunded'` is correct — see Task 2 note).
- Tests: `src/modules/leads/__tests__/board-params.test.ts`, `notifications/__tests__/notification-channels.test.ts` (unit, run); `test/admin-lead-refund.integration.test.ts`, `test/admin-lead-nudge.integration.test.ts` (self-skip).

---

### Task 1: Query-param validation (`sanitizeBoardParams`)

Resolves the final review's Important finding: malformed `status`/`range`/`page`/`page_size` can 500 the board.

**Files:**

- Create: `apps/api/src/modules/leads/board-params.ts`
- Create: `apps/api/src/modules/leads/__tests__/board-params.test.ts`
- Modify: `apps/api/src/modules/leads/admin-lead-ops.service.ts` (`getBoard` uses the sanitizer)

**Interfaces:**

- Produces: `sanitizeBoardParams(raw: RawBoardParams): BoardParams` — pure, DB-free. `RawBoardParams` = all-optional strings/unknowns from the controller; `BoardParams` is the existing service interface.

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/modules/leads/__tests__/board-params.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizeBoardParams } from "../board-params";

describe("sanitizeBoardParams", () => {
  it("defaults everything when input is empty", () => {
    const p = sanitizeBoardParams({});
    expect(p.filter).toBe("needs_call");
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(50);
    expect(p.status).toBeUndefined();
    expect(p.range).toBe("30 days");
  });

  it("drops an invalid status instead of passing it to the enum cast", () => {
    expect(sanitizeBoardParams({ status: "xyz" }).status).toBeUndefined();
    expect(sanitizeBoardParams({ status: "contacted" }).status).toBe("contacted");
  });

  it("falls back to a safe range on garbage (prevents ::interval 500)", () => {
    expect(sanitizeBoardParams({ range: "garbage" }).range).toBe("30 days");
    expect(sanitizeBoardParams({ range: "7 days" }).range).toBe("7 days");
    expect(sanitizeBoardParams({ range: "90 days" }).range).toBe("90 days");
  });

  it("coerces non-numeric page/page_size to defaults (prevents LIMIT NaN)", () => {
    const p = sanitizeBoardParams({ page: "abc", page_size: "abc" });
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(50);
    expect(sanitizeBoardParams({ page: "3", page_size: "25" })).toMatchObject({
      page: 3,
      pageSize: 25
    });
  });

  it("clamps page_size to 100 and page to >=1", () => {
    expect(sanitizeBoardParams({ page_size: "9999" }).pageSize).toBe(100);
    expect(sanitizeBoardParams({ page: "-5" }).page).toBe(1);
  });

  it("passes an invalid filter through as needs_call default", () => {
    expect(sanitizeBoardParams({ filter: "nonsense" }).filter).toBe("needs_call");
    expect(sanitizeBoardParams({ filter: "expiring_6h" }).filter).toBe("expiring_6h");
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/leads/__tests__/board-params.test.ts`
Expected: FAIL — cannot resolve `../board-params`.

- [ ] **Step 3: Implement the sanitizer**

Create `apps/api/src/modules/leads/board-params.ts`:

```ts
import type { AdminLeadBoardFilter, LeadStatus } from "@cribliv/shared-types";
import type { BoardParams } from "./admin-lead-ops.service";

export interface RawBoardParams {
  filter?: string;
  owner_id?: string;
  state?: string;
  status?: string;
  q?: string;
  range?: string;
  page?: string;
  page_size?: string;
}

const VALID_FILTERS: ReadonlySet<AdminLeadBoardFilter> = new Set([
  "needs_call",
  "expiring_6h",
  "called",
  "expired_today",
  "refunded_today",
  "all"
]);
const VALID_STATUS: ReadonlySet<LeadStatus> = new Set([
  "new",
  "contacted",
  "visit_scheduled",
  "deal_done",
  "lost"
]);
const VALID_RANGE = new Set(["7 days", "30 days", "90 days"]);

function toPositiveInt(raw: string | undefined, fallback: number, max?: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  let v = Math.max(1, Math.floor(n));
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

/** Coerce untrusted query params into a safe BoardParams (no value can reach a SQL cast unvalidated). */
export function sanitizeBoardParams(raw: RawBoardParams): BoardParams {
  const filter = (
    raw.filter && VALID_FILTERS.has(raw.filter as AdminLeadBoardFilter)
      ? (raw.filter as AdminLeadBoardFilter)
      : "needs_call"
  ) as AdminLeadBoardFilter;
  const status =
    raw.status && VALID_STATUS.has(raw.status as LeadStatus)
      ? (raw.status as LeadStatus)
      : undefined;
  const range = raw.range && VALID_RANGE.has(raw.range) ? raw.range : "30 days";
  return {
    filter,
    ownerId: raw.owner_id || undefined,
    state: raw.state || undefined, // access_state is a text column — a bad value just returns 0 rows
    status,
    q: raw.q || undefined,
    range,
    page: toPositiveInt(raw.page, 1),
    pageSize: toPositiveInt(raw.page_size, 50, 100)
  };
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/leads/__tests__/board-params.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Use the sanitizer in `getBoard`**

In `apps/api/src/modules/leads/admin-lead-ops.service.ts`, `getBoard` currently derives `filter`/`range`/`page`/`pageSize` inline. Keep `getBoard(p: BoardParams)` as-is (it already receives a `BoardParams`), but harden the two values that reach SQL casts: the `status` filter and the `range`. Add the same guards the sanitizer uses, so `getBoard` is safe even if called directly:

- In the `status` filter block, wrap with the valid-status check:

```ts
if (p.status && ["new", "contacted", "visit_scheduled", "deal_done", "lost"].includes(p.status)) {
  params.push(p.status);
  where.push(`ld.status = $${params.length}::lead_status`);
}
```

- Replace `const range = p.range ?? "30 days";` with:

```ts
const range = ["7 days", "30 days", "90 days"].includes(p.range ?? "")
  ? (p.range as string)
  : "30 days";
```

- Replace the page/pageSize derivation with `Number.isFinite` guards:

```ts
const page = Number.isFinite(p.page) ? Math.max(1, Math.floor(p.page as number)) : 1;
const pageSize = Number.isFinite(p.pageSize)
  ? Math.min(100, Math.max(1, Math.floor(p.pageSize as number)))
  : 50;
```

(The controller will pass sanitized params in Task 2's wiring; these in-service guards are defense-in-depth.)

- [ ] **Step 6: Typecheck + run the new unit test again**

Run: `pnpm --filter @cribliv/api typecheck` (clean) and re-run the board-params test (PASS).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/leads/board-params.ts apps/api/src/modules/leads/__tests__/board-params.test.ts apps/api/src/modules/leads/admin-lead-ops.service.ts
git commit -m "feat(api): validate admin lead board query params (no 500 on bad input)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Manual refund endpoint (`POST admin/leads/:id/refund`)

**Files:**

- Modify: `apps/api/src/modules/leads/admin-lead-ops.service.ts` (add `refundLead`)
- Modify: `apps/api/src/modules/leads/admin-leads.controller.ts` (add route; use `sanitizeBoardParams` in `board()`)
- Test: `apps/api/test/admin-lead-refund.integration.test.ts`

**Interfaces:**

- Consumes: `refundUnlock` from `../contacts/refund-unlock`.
- Produces: `AdminLeadOpsService.refundLead(leadId: string, adminUserId: string, reason: string): Promise<{ lead_id: string; refunded: boolean; refund_txn_id: string | null }>`.

**Design note (resolves Slice-1 review item):** the endpoint guards `409 already_responded` when the lead's linked unlock is not `pending`, so `refundUnlock` only ever runs on a genuinely-unanswered lead — the routine's hardcoded `owner_response_status='timeout_refunded'` is therefore correct here, and no `finalStatus` option is needed.

- [ ] **Step 1: Write the failing integration test**

Create `apps/api/test/admin-lead-refund.integration.test.ts` (raw-`pg` harness; `describe.runIf(!!process.env.TEST_DATABASE_URL)`):

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { DatabaseService } from "../src/common/database.service";
import { AdminLeadOpsService } from "../src/modules/leads/admin-lead-ops.service";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("AdminLeadOpsService.refundLead (DB)", () => {
  let pool: Pool;
  let db: DatabaseService;
  let svc: AdminLeadOpsService;
  let adminId: string;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    pool = new Pool({ connectionString: TEST_DB! });
    db = new DatabaseService();
    svc = new AdminLeadOpsService(db);
    const s = String(Math.floor(Math.random() * 1e8)).padStart(8, "0");
    adminId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone_e164, role) VALUES ($1,'admin') RETURNING id::text`,
        [`+9194${s}`]
      )
    ).rows[0].id;
    ownerId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone_e164, role) VALUES ($1,'owner') RETURNING id::text`,
        [`+9196${s}`]
      )
    ).rows[0].id;
    tenantId = (
      await pool.query<{ id: string }>(
        `INSERT INTO users (phone_e164, role) VALUES ($1,'tenant') RETURNING id::text`,
        [`+9195${s}`]
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO wallets (user_id, balance_credits, free_credits_granted) VALUES ($1::uuid,0,0)`,
      [tenantId]
    );
    listingId = (
      await pool.query<{ id: string }>(
        `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status) VALUES ($1::uuid,'flat_house','Refund Ep',9000,'active') RETURNING id::text`,
        [ownerId]
      )
    ).rows[0].id;
  }, 60_000);

  async function seedPendingLead() {
    const idem = `rf-${Math.random().toString(36).slice(2)}`;
    const txn = (
      await pool.query<{ id: string }>(
        `INSERT INTO wallet_transactions (wallet_user_id, txn_type, credits_delta, reference_type, idempotency_key, metadata) VALUES ($1::uuid,'debit_contact_unlock',-1,'listing',$2,'{}'::jsonb) RETURNING id::text`,
        [tenantId, idem]
      )
    ).rows[0].id;
    const unlock = (
      await pool.query<{ id: string }>(
        `INSERT INTO contact_unlocks (tenant_user_id, listing_id, wallet_txn_id, idempotency_key, response_deadline_at, owner_response_status) VALUES ($1::uuid,$2::uuid,$3::uuid,$4, now() + interval '10 hours','pending') RETURNING id::text`,
        [tenantId, listingId, txn, idem]
      )
    ).rows[0].id;
    const lead = (
      await pool.query<{ id: string }>(
        `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id, status, access_state, call_deadline_at) VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,'new','locked', now() + interval '10 hours') ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET contact_unlock_id=EXCLUDED.contact_unlock_id, access_state='locked' RETURNING id::text`,
        [listingId, ownerId, tenantId, unlock]
      )
    ).rows[0].id;
    return { unlock, lead };
  }

  afterAll(async () => {
    await pool.query(`DELETE FROM admin_actions WHERE admin_user_id = $1::uuid`, [adminId]);
    await pool.query(
      `DELETE FROM contact_events WHERE contact_unlock_id IN (SELECT id FROM contact_unlocks WHERE listing_id=$1::uuid)`,
      [listingId]
    );
    await pool.query(`DELETE FROM leads WHERE listing_id=$1::uuid`, [listingId]);
    await pool.query(`UPDATE contact_unlocks SET refund_txn_id=NULL WHERE listing_id=$1::uuid`, [
      listingId
    ]);
    await pool.query(`DELETE FROM contact_unlocks WHERE listing_id=$1::uuid`, [listingId]);
    await pool.query(`DELETE FROM wallet_transactions WHERE wallet_user_id=$1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM wallets WHERE user_id=$1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM listings WHERE id=$1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid,$2::uuid,$3::uuid)`, [
      adminId,
      ownerId,
      tenantId
    ]);
    await db.onModuleDestroy();
    await pool.end();
  }, 60_000);

  it("refunds the seeker, expires the locked lead, writes refund_admin txn + audit", async () => {
    const { unlock, lead } = await seedPendingLead();
    const res = await svc.refundLead(lead, adminId, "listing looked fake");
    expect(res.refunded).toBe(true);
    const wallet = await pool.query<{ balance_credits: number }>(
      `SELECT balance_credits FROM wallets WHERE user_id=$1::uuid`,
      [tenantId]
    );
    expect(wallet.rows[0].balance_credits).toBe(1);
    const txn = await pool.query<{ txn_type: string }>(
      `SELECT txn_type FROM wallet_transactions WHERE reference_id=$1::uuid AND credits_delta=1`,
      [unlock]
    );
    expect(txn.rows[0].txn_type).toBe("refund_admin");
    const ld = await pool.query<{ access_state: string }>(
      `SELECT access_state FROM leads WHERE id=$1::uuid`,
      [lead]
    );
    expect(ld.rows[0].access_state).toBe("expired");
    const audit = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM admin_actions WHERE target_type='lead' AND target_id=$1::uuid AND action='lead_manual_refund'`,
      [lead]
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it("409s when the owner already responded", async () => {
    const { unlock, lead } = await seedPendingLead();
    await pool.query(
      `UPDATE contact_unlocks SET owner_response_status='responded', owner_responded_at=now() WHERE id=$1::uuid`,
      [unlock]
    );
    await expect(svc.refundLead(lead, adminId, "x")).rejects.toMatchObject({
      response: { code: "already_responded" }
    });
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/cribliv_test' pnpm --filter @cribliv/api exec vitest run test/admin-lead-refund.integration.test.ts`
Expected: FAIL — `svc.refundLead` is not a function (no DB → self-skips; if it collects it errors on the missing method — either way, implement next).

- [ ] **Step 3: Implement `refundLead`**

In `apps/api/src/modules/leads/admin-lead-ops.service.ts`, add the import and method (mirrors `teamMarkCalled`'s transaction shape + the wallet-adjust audit):

```ts
import { refundUnlock } from "../contacts/refund-unlock";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
```

```ts
  async refundLead(leadId: string, adminUserId: string, reason: string) {
    this.ensureEnabled();
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");
      const leadRes = await client.query<{ id: string; contact_unlock_id: string | null }>(
        `SELECT id::text, contact_unlock_id::text FROM leads WHERE id = $1::uuid FOR UPDATE`,
        [leadId]
      );
      const lead = leadRes.rows[0];
      if (!lead) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      if (!lead.contact_unlock_id) {
        throw new ConflictException({ code: "no_unlock", message: "Lead has no linked callback to refund" });
      }
      // Lock the unlock row and guard state before refunding.
      const cu = await client.query<{ owner_response_status: string; unlock_status: string }>(
        `SELECT owner_response_status, unlock_status FROM contact_unlocks WHERE id = $1::uuid FOR UPDATE`,
        [lead.contact_unlock_id]
      );
      const row = cu.rows[0];
      if (!row) throw new NotFoundException({ code: "not_found", message: "Callback not found" });
      if (row.unlock_status !== "active") {
        throw new ConflictException({ code: "already_refunded", message: "Callback already resolved" });
      }
      if (row.owner_response_status !== "pending") {
        throw new ConflictException({ code: "already_responded", message: "Owner already responded — not refundable" });
      }
      const result = await refundUnlock(client, lead.contact_unlock_id, {
        txnType: "refund_admin",
        actorRole: "admin",
        expireLockedLead: true,
        metadata: { reason, admin_user_id: adminUserId }
      });
      await client.query(
        `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action, reason, after_state)
         VALUES ($1::uuid, 'lead', $2::uuid, 'lead_manual_refund', $3, $4::jsonb)`,
        [adminUserId, leadId, reason, JSON.stringify({ refund_txn_id: result.refundTxnId })]
      );
      await client.query("COMMIT");
      return { lead_id: leadId, refunded: result.refunded, refund_txn_id: result.refundTxnId };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
```

(Note: `ensureEnabled` and `this.database` already exist on the service from Slice 1; add only the imports not already present.)

- [ ] **Step 4: Add the controller route + sanitize the board params**

In `apps/api/src/modules/leads/admin-leads.controller.ts`: import `sanitizeBoardParams` and `Body`; change `board()` to build params via the sanitizer; add the refund route.

```ts
import { Body, Controller, Get, Post, Param, Query, Req, Inject, UseGuards } from "@nestjs/common";
import { sanitizeBoardParams } from "./board-params";
```

Replace the `board()` body's param assembly with:

```ts
return ok(
  await this.ops.getBoard(
    sanitizeBoardParams({
      filter,
      owner_id: ownerId,
      state,
      status,
      q,
      range,
      page,
      page_size: pageSize
    })
  )
);
```

(keep the `@Query(...)` params; pass them straight into the sanitizer). Add:

```ts
  @Post(":id/refund")
  async refund(
    @Param("id") leadId: string,
    @Req() req: { user: { id: string } },
    @Body() body: { reason?: string }
  ) {
    return ok(await this.ops.refundLead(leadId, req.user.id, body?.reason ?? "admin manual refund"));
  }
```

- [ ] **Step 5: Verify — self-skip + typecheck**

Run the refund integration test (collects + self-skips, no DB) and `pnpm --filter @cribliv/api typecheck` (clean).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/leads/admin-lead-ops.service.ts apps/api/src/modules/leads/admin-leads.controller.ts apps/api/test/admin-lead-refund.integration.test.ts
git commit -m "feat(api): admin manual lead refund endpoint (reuses refundUnlock, audited)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Nudge-owner endpoint (`POST admin/leads/:id/nudge-owner`)

Ships the nudge on the existing WhatsApp channel (SMS is added in Task 5, automatically, once `owner.lead_nudge` gains the `sms` channel).

**Files:**

- Modify: `apps/api/src/modules/notifications/notification.templates.ts` (add `owner.lead_nudge`)
- Modify: `apps/api/src/modules/leads/admin-lead-ops.service.ts` (add `nudgeOwner`)
- Modify: `apps/api/src/modules/leads/admin-leads.controller.ts` (add route)
- Modify: `apps/api/src/modules/leads/leads.module.ts` (import `NotificationsModule`)
- Test: `apps/api/test/admin-lead-nudge.integration.test.ts`

**Interfaces:**

- Consumes: `NotificationService.send`.
- Produces: `AdminLeadOpsService.nudgeOwner(leadId, adminUserId): Promise<{ lead_id: string; nudged: boolean }>`; rate-limited to once per lead per 3h via a `lead_events` marker (`notes='admin_nudged_owner'`).

- [ ] **Step 1: Add the `owner.lead_nudge` template**

In `notification.templates.ts`, add `"owner.lead_nudge"` to the `NotificationType` union, and this registry entry (place before the closing `}` of `TEMPLATES`):

```ts
  "owner.lead_nudge": {
    type: "owner.lead_nudge",
    templateName: "owner_lead_nudge_hi",
    languageCode: "hi",
    description:
      "Admin nudge to an owner with an uncalled lead. Params: tenant_name, listing_title, hours_left",
    buildBodyParams: (payload) => [
      String(payload.tenant_name ?? "एक किरायेदार"),
      String(payload.listing_title ?? "आपकी प्रॉपर्टी"),
      String(payload.hours_left ?? "24 घंटे")
    ]
  },
```

(If Task 4 has already added a `channels` field to the template interface, include `channels: ["whatsapp", "sms"]` here; if Task 3 runs first, omit it — Task 5 sets it.)

- [ ] **Step 2: Write the failing integration test**

Create `apps/api/test/admin-lead-nudge.integration.test.ts` — mirror the refund test's harness; seed an uncalled lead. Construct the service with a **fake** notifications object so the test is decoupled from `NotificationService`'s internals/constructor arity:

```ts
const fakeNotifications: any = { send: async () => true };
// ...
svc = new AdminLeadOpsService(db, fakeNotifications);
```

Minimum assertions:

```ts
it("sends once, writes a nudge lead_event + admin_action, and rate-limits a second nudge", async () => {
  const { lead } = await seedUncalledLead();
  const first = await svc.nudgeOwner(lead, adminId);
  expect(first.nudged).toBe(true);
  const ev = await pool.query<{ n: number }>(
    `SELECT count(*)::int n FROM lead_events WHERE lead_id=$1::uuid AND notes='admin_nudged_owner'`,
    [lead]
  );
  expect(ev.rows[0].n).toBe(1);
  const audit = await pool.query<{ n: number }>(
    `SELECT count(*)::int n FROM admin_actions WHERE target_id=$1::uuid AND action='nudge_owner'`,
    [lead]
  );
  expect(audit.rows[0].n).toBe(1);
  const second = await svc.nudgeOwner(lead, adminId); // within 3h window
  expect(second.nudged).toBe(false);
});
```

- [ ] **Step 3: Inject `NotificationService` + implement `nudgeOwner`**

In `leads.module.ts`, add `imports: [NotificationsModule]` (import it from `../notifications/notifications.module`). In `admin-lead-ops.service.ts`, add `@Inject(NotificationService) private readonly notifications: NotificationService` as the **second** constructor param.

**Cross-task fix (required):** adding this constructor param breaks every existing `new AdminLeadOpsService(db)` in tests. Update them to pass a fake notifications: in `apps/api/test/admin-lead-board.integration.test.ts` (Slice 1) and `apps/api/test/admin-lead-refund.integration.test.ts` (Task 2), change the construction to `new AdminLeadOpsService(db, { send: async () => true } as any)`. Then implement `nudgeOwner`:

```ts
  async nudgeOwner(leadId: string, adminUserId: string) {
    this.ensureEnabled();
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }
    const info = await this.database.query<{
      owner_user_id: string; tenant_name: string; listing_title: string;
      called_at: string | null; hours_left: number | null; recently_nudged: boolean;
    }>(
      `SELECT ld.owner_user_id::text,
              COALESCE(t.full_name,'एक किरायेदार') AS tenant_name,
              COALESCE(NULLIF(l.title_en,''),'आपकी प्रॉपर्टी') AS listing_title,
              ld.called_at::text,
              GREATEST(0, ROUND(EXTRACT(EPOCH FROM (ld.call_deadline_at - now())) / 3600))::int AS hours_left,
              EXISTS (SELECT 1 FROM lead_events le WHERE le.lead_id = ld.id
                        AND le.notes = 'admin_nudged_owner' AND le.created_at > now() - interval '3 hours') AS recently_nudged
       FROM leads ld
       JOIN users t ON t.id = ld.tenant_user_id
       JOIN listings l ON l.id = ld.listing_id
       WHERE ld.id = $1::uuid`,
      [leadId]
    );
    const row = info.rows[0];
    if (!row) throw new NotFoundException({ code: "not_found", message: "Lead not found" });
    if (row.recently_nudged) return { lead_id: leadId, nudged: false };

    await this.notifications.send({
      type: "owner.lead_nudge",
      recipientUserId: row.owner_user_id,
      payload: {
        tenant_name: row.tenant_name,
        listing_title: row.listing_title,
        hours_left: `${row.hours_left ?? 24} घंटे`
      },
      mode: "immediate"
    });
    await this.database.query(
      `INSERT INTO lead_events (lead_id, to_status, notes)
       SELECT $1::uuid, status, 'admin_nudged_owner' FROM leads WHERE id = $1::uuid`,
      [leadId]
    );
    await this.database.query(
      `INSERT INTO admin_actions (admin_user_id, target_type, target_id, action)
       VALUES ($1::uuid, 'lead', $2::uuid, 'nudge_owner')`,
      [adminUserId, leadId]
    );
    return { lead_id: leadId, nudged: true };
  }
```

- [ ] **Step 4: Add the controller route**

```ts
  @Post(":id/nudge-owner")
  async nudge(@Param("id") leadId: string, @Req() req: { user: { id: string } }) {
    return ok(await this.ops.nudgeOwner(leadId, req.user.id));
  }
```

- [ ] **Step 5: Verify — self-skip + typecheck + full suite**

Run the nudge test (self-skips), `pnpm --filter @cribliv/api typecheck` (clean), and `pnpm --filter @cribliv/api test` (confirm the `NotificationsModule` import didn't break DI-based tests; expect the pre-existing flaky callback tests may intermittently fail — re-run those two files in isolation to confirm they pass).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notifications/notification.templates.ts apps/api/src/modules/leads/admin-lead-ops.service.ts apps/api/src/modules/leads/admin-leads.controller.ts apps/api/src/modules/leads/leads.module.ts apps/api/test/admin-lead-nudge.integration.test.ts
git commit -m "feat(api): admin nudge-owner endpoint (WhatsApp, rate-limited, audited)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Multi-channel notification layer + D7 `SmsClient`

Adds SMS as a second channel without disturbing the WhatsApp path.

**Files:**

- Create: `apps/api/src/modules/notifications/sms.client.ts`
- Modify: `apps/api/src/modules/notifications/notification.templates.ts` (add `channels` to the interface + each entry)
- Modify: `apps/api/src/modules/notifications/notification.service.ts` (per-channel dispatch + channel-aware logging; inject `SmsClient`)
- Modify: `apps/api/src/modules/notifications/notifications.module.ts` (register `SmsClient`)
- Test: `apps/api/src/modules/notifications/__tests__/notification-channels.test.ts` (unit — runs, no DB)

**Interfaces:**

- Produces: `SmsClient` (`@Injectable`) with `sendSms(msg: SmsMessage): Promise<SmsSendResult>` where `SmsMessage = { to: string; body: string }`, `SmsSendResult = { success: boolean; messageId?: string; error?: string }`. `NotificationTemplate` gains `channels: ("whatsapp"|"sms")[]` and an optional `buildSmsBody?(payload): string`.

- [ ] **Step 1: Write the failing unit test (channel fan-out)**

Create `apps/api/src/modules/notifications/__tests__/notification-channels.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { NotificationService } from "../notification.service";

function svc(waSend: any, smsSend: any) {
  const appState: any = {
    users: new Map([["u1", { phone: "+919999999999", whatsapp_opt_in: true }]])
  };
  const database: any = { isEnabled: () => false };
  const whatsApp: any = { sendTemplate: waSend };
  const sms: any = { sendSms: smsSend };
  return new NotificationService(appState, database, whatsApp, sms);
}

describe("NotificationService channel fan-out", () => {
  it("dispatches to both whatsapp and sms for a two-channel type", async () => {
    const wa = vi.fn().mockResolvedValue({ success: true, messageId: "wa1" });
    const sms = vi.fn().mockResolvedValue({ success: true, messageId: "sms1" });
    const ok = await svc(wa, sms).send({
      type: "owner.contact_unlocked",
      recipientUserId: "u1",
      payload: { listing_title: "Flat", tenant_name: "A", response_deadline: "24 घंटे" },
      mode: "immediate",
      forceOptIn: true
    });
    expect(ok).toBe(true);
    expect(wa).toHaveBeenCalledTimes(1);
    expect(sms).toHaveBeenCalledTimes(1);
  });

  it("does not send SMS for a whatsapp-only type", async () => {
    const wa = vi.fn().mockResolvedValue({ success: true });
    const sms = vi.fn().mockResolvedValue({ success: true });
    await svc(wa, sms).send({
      type: "owner.listing_approved",
      recipientUserId: "u1",
      payload: {},
      mode: "immediate",
      forceOptIn: true
    });
    expect(wa).toHaveBeenCalledTimes(1);
    expect(sms).not.toHaveBeenCalled();
  });
});
```

(This test uses the in-memory `database.isEnabled()===false` path so `resolveRecipient` reads `appState.users`. It requires `owner.contact_unlocked` to declare `channels: ["whatsapp","sms"]` and a `buildSmsBody` — set in Step 3/Task 5. `owner.listing_approved` stays `channels: ["whatsapp"]`.)

- [ ] **Step 2: Run it — verify it fails** (`NotificationService` constructor has no 4th `sms` arg yet). Command: `pnpm --filter @cribliv/api exec vitest run src/modules/notifications/__tests__/notification-channels.test.ts` → FAIL.

- [ ] **Step 3: Implement `SmsClient`**

Create `apps/api/src/modules/notifications/sms.client.ts` (mirrors `WhatsAppClient`; D7 messaging API, mock default):

```ts
import { Injectable, Logger } from "@nestjs/common";

export interface SmsMessage {
  to: string; // E.164
  body: string;
}
export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 8_000;

@Injectable()
export class SmsClient {
  private readonly logger = new Logger(SmsClient.name);
  private readonly provider = (process.env.SMS_PROVIDER ?? "mock") as "d7" | "mock";
  private readonly apiKey = process.env.D7_KEY ?? "";
  private readonly url = process.env.D7_SMS_URL ?? "https://api.d7networks.com/messages/v1/send";
  private readonly originator = process.env.SMS_SENDER_ID ?? process.env.OTP_SENDER_ID ?? "CribLiv";

  async sendSms(message: SmsMessage): Promise<SmsSendResult> {
    if (this.provider === "mock") {
      this.logger.log(`[mock-sms] to=${message.to} body=${message.body.slice(0, 40)}…`);
      return { success: true, messageId: `mock_sms_${Date.now()}` };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              channel: "sms",
              recipients: [message.to],
              content: message.body,
              msg_type: "text",
              data_coding: "text"
            }
          ],
          message_globals: { originator: this.originator }
        }),
        signal: controller.signal
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) return { success: false, error: `d7 ${res.status}` };
      return { success: true, messageId: String((json as any).request_id ?? "") };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timeout);
    }
  }
}
```

- [ ] **Step 4: Add `channels` to the template interface + all entries**

In `notification.templates.ts`, extend `NotificationTemplate`:

```ts
  /** Channels this type dispatches on. Defaults to whatsapp-only. */
  channels: ("whatsapp" | "sms")[];
  /** Build the SMS body text (required when 'sms' is in channels). */
  buildSmsBody?: (payload: Record<string, unknown>) => string;
```

Add `channels: ["whatsapp"]` to every existing entry. (Task 5 changes `owner.contact_unlocked` and `owner.lead_nudge` to `["whatsapp","sms"]` and adds their `buildSmsBody`.)

- [ ] **Step 5: Per-channel dispatch in `NotificationService`**

Inject `SmsClient` (constructor 4th param + `notifications.module.ts` provider). Refactor `dispatchImmediate` and `enqueueNotification` to loop over `template.channels`:

- For `whatsapp`: existing `whatsApp.sendTemplate(...)`, resolve phone with the `whatsapp_opt_in` gate (existing `resolveRecipient`), `logNotification(..., 'whatsapp')`.
- For `sms`: resolve phone WITHOUT the opt-in gate (a new `resolveSmsPhone(userId, override)` that returns the phone if present), call `sms.sendSms({ to, body: template.buildSmsBody!(payload) })`, `logNotification(..., 'sms')`.
- `logNotification` gains a `channel: "whatsapp" | "sms"` param threaded into the `notification_log` INSERT (replace the hardcoded `'whatsapp'`).
- `enqueueNotification` (queued mode): emit one event per channel, `event_type = notification.${channel}.${type}`, `dedupeKey = ${channel}:${type}:${userId}:...`, and include `sms_body` in the SMS event payload.
- `send()` returns `true` if at least one channel succeeded. Preserve the WhatsApp behavior exactly for whatsapp-only types.

- [ ] **Step 6: Register `SmsClient`**

`notifications.module.ts`: add `SmsClient` to `providers` and `exports`; import it.

- [ ] **Step 7: Run the unit test — verify it passes** + typecheck clean. (The two-channel test needs `owner.contact_unlocked` to have `channels:["whatsapp","sms"]` + a `buildSmsBody`; if Task 5 hasn't run, add just those two fields to `owner.contact_unlocked` here so the test is green, and Task 5 finalizes `owner.lead_nudge`.)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/notifications/
git commit -m "feat(api): multi-channel notifications + D7 SmsClient (mock default)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: SMS for new-lead + nudge + worker dispatch branch

**Files:**

- Modify: `apps/api/src/modules/notifications/notification.templates.ts` (`owner.contact_unlocked` + `owner.lead_nudge` → `["whatsapp","sms"]` + `buildSmsBody`)
- Modify: `apps/api/src/worker/worker.ts` (`notification.sms.*` branch + `dispatchSmsEvent` + `SmsClient` instance)

- [ ] **Step 1: Give both owner alerts an SMS body + channel**

In `notification.templates.ts`, set `channels: ["whatsapp", "sms"]` on `owner.contact_unlocked` and `owner.lead_nudge`, and add `buildSmsBody`:

```ts
// owner.contact_unlocked:
    buildSmsBody: (payload) =>
      `New Cribliv lead: ${String(payload.tenant_name ?? "a seeker")} wants a callback for ${String(payload.listing_title ?? "your listing")}. Call within ${String(payload.response_deadline ?? "24 hours")} or the lead expires. cribliv.com`,
// owner.lead_nudge:
    buildSmsBody: (payload) =>
      `Reminder: your Cribliv lead ${String(payload.tenant_name ?? "a seeker")} for ${String(payload.listing_title ?? "your listing")} is still uncalled — ${String(payload.hours_left ?? "24 घंटे")} left before refund. Call now. cribliv.com`,
```

- [ ] **Step 2: Worker `notification.sms.*` branch**

In `apps/api/src/worker/worker.ts`: import `SmsClient`; add `dispatchSmsEvent(smsClient, event)` mirroring `dispatchWhatsAppEvent` but reading `payload.sms_body` + `payload.recipient_phone` and calling `smsClient.sendSms({ to, body })`; in `runOutboundDispatchDb`, add `const isSms = event.event_type.startsWith("notification.sms.");` and an `else if (isSms && smsClient) { await dispatchSmsEvent(smsClient, event); }` branch (plus a `skipped_no_client` log when absent), threading a new optional `smsClient?: SmsClient` param; instantiate `const smsClient = new SmsClient();` near the WhatsApp client and pass it at the call site.

- [ ] **Step 3: Verify — typecheck + worker compiles + full suite**

`pnpm --filter @cribliv/api typecheck` (clean); `pnpm --filter @cribliv/api test` (full suite — the notification unit test green; pre-existing flaky callback tests may need isolation re-run).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/notifications/notification.templates.ts apps/api/src/worker/worker.ts
git commit -m "feat(api): SMS for new-lead + nudge owner alerts; worker sms dispatch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Slice 2 Definition of Done

- Board query params validated (no 500 on malformed `status`/`range`/`page`/`page_size`); `sanitizeBoardParams` unit-tested.
- `POST admin/leads/:id/refund` — reuses `refundUnlock` (`refund_admin`), guards `already_responded`/`already_refunded`, audited.
- `POST admin/leads/:id/nudge-owner` — WhatsApp+SMS (once channels wired), rate-limited (3h), audited.
- Multi-channel `NotificationService` + D7 `SmsClient` (mock default); new-lead + nudge alerts fan out to WhatsApp + SMS; worker dispatches `notification.sms.*`.
- `pnpm --filter @cribliv/api typecheck` clean; unit tests (board-params, notification-channels) pass; DB integration tests written (self-skip without a DB).

## Rollout (SMS)

Real SMS requires, outside code: `SMS_PROVIDER=d7`, `D7_KEY` (reused from OTP), `SMS_SENDER_ID`, `D7_SMS_URL` (default D7 messages endpoint), and **DLT-registered templates** for the transactional SMS bodies (TRAI requirement — the D7 sender/entity already exists from OTP, so this is template approval). Until then SMS stays `mock` (no-op) and WhatsApp carries the alerts. Verify the `owner.lead_nudge` / new-lead SMS bodies match the DLT-approved template text before flipping `SMS_PROVIDER=d7`.

## Deferred (Slice 3+)

- `/analytics` + `/by-owner/:id` (engagement funnel, per-owner rollup, PG drill-down) — and wiring real `owner.health_score` into board rows.
- Web Lead Center tab (Slice 4).
