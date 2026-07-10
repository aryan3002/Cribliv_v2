# Lead Monetization Slice 1 (Revenue Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the callback-guarantee lead model — tenant credits buy a guaranteed 24h callback (owner phone never revealed), owners get first-2-free then pay to unlock blurred leads — per `docs/superpowers/specs/2026-07-10-lead-monetization-design.md`.

**Architecture:** Repurposes the existing contact-unlock machinery: `POST tenant/contact-unlocks` keeps its wallet debit/idempotency/ledger but (behind `ff_callback_leads`) stops returning the owner phone and moves the deadline to 24h. Leads gain an `access_state` lifecycle (`free → locked → unlocked/expired`); owner unlock mirrors the tenant wallet-debit transaction pattern. Call-click and team-called mark the linked `contact_unlocks` row `responded`, so the existing worker refund sweep keeps working unchanged except for lead expiry. `LeadsService` stays DB-only; `ContactsService` stays dual-mode (DB + `AppStateService`).

**Tech Stack:** NestJS (apps/api), Next.js 14 App Router (apps/web), raw SQL migrations (infra/migrations), Vitest + supertest (API tests), Playwright (web E2E), pnpm + Turborepo.

## Global Constraints

- Everything ships behind `ff_callback_leads` (env `FF_CALLBACK_LEADS`, web `NEXT_PUBLIC_FF_CALLBACK_LEADS`), **default OFF**. Flag OFF must preserve today's behavior exactly (owner phone revealed, 12h deadline, no new UI).
- Timings from the spec, verbatim: **24 hours** callback deadline, **6 hours** rescue/reminder window, **72 hours** dispute window, first **2** leads free per owner (lifetime).
- Owner packs, verbatim: `leads_5` = 29900 paise → 5 credits; `leads_15` = 69900 paise → 15 credits.
- DTO fields snake_case; controller responses wrapped with `ok()` from `../../common/response` → `{ data: ... }`.
- English-only copy in this slice (the existing `unlock-contact-panel.tsx` uses hardcoded EN strings; match that). Hindi sweep is Slice 2.
- After editing `packages/shared-types`, run `pnpm --filter @cribliv/shared-types build` before API/web builds.
- API test runs: `pnpm --filter @cribliv/api test -- <pattern>`. DB-gated tests use `describe.runIf(!!process.env.TEST_DATABASE_URL)` (pattern: `apps/api/test/migration-0043-seo-city-config.integration.test.ts`). In-memory tests use the `createApp()` pattern from `apps/api/test/phase1.integration.test.ts`.
- Tenant phone numbers are never stored on `leads`; always joined from `users.phone_e164`.
- Commits: conventional prefixes (`feat(api):`, `feat(web):`, `test(api):`…), each ending with:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Branch: `feat/lead-monetization` (spec commit `fa199b8` is its tip; base is master).

---

### Task 1: Shared types + owner credit packs

**Files:**
- Modify: `packages/shared-types/src/types.ts:21-30` (WalletTxnType), `:92-103` (Lead)
- Modify: `apps/api/src/modules/payments/payments.util.ts:6-9`
- Test: `apps/api/test/lead-plans.test.ts`

**Interfaces:**
- Consumes: nothing (leaf task).
- Produces: `WalletTxnType` gains `"debit_lead_unlock" | "refund_lead_dispute"`; new exports `LeadAccessState = "free" | "locked" | "unlocked" | "expired"`, `LeadCalledBy = "owner" | "team"`, `CallbackStatus = "awaiting_call" | "call_claimed" | "refunded"`; `Lead` gains optional monetization fields; `CREDIT_PLANS` gains `leads_5`, `leads_15` (so `parseCreditPlan("leads_5")` works).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/lead-plans.test.ts
import { describe, it, expect } from "vitest";
import { CREDIT_PLANS, parseCreditPlan } from "../src/modules/payments/payments.util";

describe("owner lead-credit plans", () => {
  it("defines leads_5 at ₹299 for 5 credits", () => {
    expect(CREDIT_PLANS.leads_5).toEqual({ amountPaise: 29900, credits: 5 });
    expect(parseCreditPlan("leads_5").credits).toBe(5);
  });

  it("defines leads_15 at ₹699 for 15 credits", () => {
    expect(CREDIT_PLANS.leads_15).toEqual({ amountPaise: 69900, credits: 15 });
  });

  it("still rejects unknown plans", () => {
    expect(() => parseCreditPlan("leads_999")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- lead-plans`
Expected: FAIL — `leads_5` does not exist on `CREDIT_PLANS` (TypeScript error / undefined).

- [ ] **Step 3: Implement**

In `apps/api/src/modules/payments/payments.util.ts` replace lines 6–9:

```ts
export const CREDIT_PLANS = {
  starter_10: { amountPaise: 9900, credits: 10 },
  growth_20: { amountPaise: 19900, credits: 20 },
  // Owner lead-unlock packs (placeholder pricing per 2026-07-10 spec §4 — tune before launch)
  leads_5: { amountPaise: 29900, credits: 5 },
  leads_15: { amountPaise: 69900, credits: 15 }
} as const;
```

In `packages/shared-types/src/types.ts` replace the `WalletTxnType` union (lines 21–26):

```ts
export type WalletTxnType =
  | "grant_signup"
  | "debit_contact_unlock"
  | "refund_no_response"
  | "admin_adjustment"
  | "purchase_pack"
  | "debit_lead_unlock"
  | "refund_lead_dispute";
```

Below `LeadStatus` (line 90) add:

```ts
export type LeadAccessState = "free" | "locked" | "unlocked" | "expired";

export type LeadCalledBy = "owner" | "team";

export type CallbackStatus = "awaiting_call" | "call_claimed" | "refunded";
```

Extend the `Lead` interface (after `owner_notes`):

```ts
  access_state?: LeadAccessState;
  call_deadline_at?: string | null;
  called_at?: string | null;
  called_by?: LeadCalledBy | null;
  unlocked_at?: string | null;
  tenant_confirmed_at?: string | null;
  disputed_at?: string | null;
```

- [ ] **Step 4: Build shared types, run test to verify it passes**

Run: `pnpm --filter @cribliv/shared-types build && pnpm --filter @cribliv/api test -- lead-plans`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/types.ts apps/api/src/modules/payments/payments.util.ts apps/api/test/lead-plans.test.ts
git commit -m "feat(api): owner lead-credit packs + shared lead monetization types

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration 0053 + rollback

**Files:**
- Create: `infra/migrations/0053_lead_monetization.sql`
- Create: `infra/migrations/0053_lead_monetization.rollback.sql`
- Test: `apps/api/test/migration-0053-lead-monetization.integration.test.ts`

**Interfaces:**
- Consumes: existing `leads`, `wallet_transactions` tables, `wallet_txn_type` + `contact_event_type` enums (from `0001_init.sql`, `0010_leads_fraud.sql`).
- Produces: `leads` columns `access_state text NOT NULL DEFAULT 'locked'`, `unlocked_at timestamptz`, `unlock_txn_id uuid FK`, `called_at timestamptz`, `called_by text`, `call_deadline_at timestamptz`, `tenant_confirmed_at timestamptz`, `disputed_at timestamptz`; enum values `debit_lead_unlock`, `refund_lead_dispute` (wallet_txn_type) and `dispute_refund`, `tenant_confirmed` (contact_event_type); index `idx_leads_call_deadline`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/migration-0053-lead-monetization.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const TEST_DB = process.env.TEST_DATABASE_URL;
const MIG = join(__dirname, "../../../infra/migrations");

describe.runIf(!!TEST_DB)("migration 0053_lead_monetization", () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: TEST_DB! });
    await client.connect();
    await client.query(readFileSync(join(MIG, "0053_lead_monetization.sql"), "utf8"));
  });
  afterAll(async () => {
    await client.query(readFileSync(join(MIG, "0053_lead_monetization.rollback.sql"), "utf8"));
    await client.end();
  });

  it("adds lead monetization columns with correct defaults", async () => {
    const r = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns WHERE table_name = 'leads' ORDER BY column_name`);
    const by = Object.fromEntries(r.rows.map((c) => [c.column_name, c]));
    expect(by.access_state.is_nullable).toBe("NO");
    expect(by.access_state.column_default).toContain("locked");
    for (const col of [
      "unlocked_at", "called_at", "call_deadline_at",
      "tenant_confirmed_at", "disputed_at"
    ]) {
      expect(by[col].data_type, col).toBe("timestamp with time zone");
      expect(by[col].is_nullable, col).toBe("YES");
    }
    expect(by.called_by.data_type).toBe("text");
    expect(by.unlock_txn_id.data_type).toBe("uuid");
  });

  it("rejects invalid access_state and called_by values", async () => {
    await expect(
      client.query(`SELECT 'bogus'::text = ANY(ARRAY['free','locked','unlocked','expired'])`)
    ).resolves.toBeTruthy();
    const c = await client.query(`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'leads'::regclass AND conname IN ('leads_access_state_check','leads_called_by_check')`);
    expect(c.rows.map((x) => x.conname).sort()).toEqual([
      "leads_access_state_check", "leads_called_by_check"
    ]);
  });

  it("extends wallet_txn_type and contact_event_type enums", async () => {
    const w = await client.query(`SELECT unnest(enum_range(NULL::wallet_txn_type))::text AS v`);
    const values = w.rows.map((x) => x.v);
    expect(values).toContain("debit_lead_unlock");
    expect(values).toContain("refund_lead_dispute");
    const e = await client.query(`SELECT unnest(enum_range(NULL::contact_event_type))::text AS v`);
    const eventValues = e.rows.map((x) => x.v);
    expect(eventValues).toContain("dispute_refund");
    expect(eventValues).toContain("tenant_confirmed");
  });

  it("creates the sweep/rescue partial index", async () => {
    const r = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'leads' AND indexname = 'idx_leads_call_deadline'`);
    expect(r.rowCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- migration-0053`
(Adjust the connection string to the local docker compose DB; run `pnpm db:migrate` against it first. Without `TEST_DATABASE_URL` the suite self-skips.)
Expected: FAIL — cannot read `0053_lead_monetization.sql` (file missing).

- [ ] **Step 3: Write the migration**

```sql
-- infra/migrations/0053_lead_monetization.sql
-- Migration 0053: callback-guarantee lead monetization (spec 2026-07-10).
-- Leads gain an access lifecycle: 'free' (first-2 per owner), 'locked' (blurred,
-- owner must pay), 'unlocked' (owner paid), 'expired' (24h passed while locked).
-- Enum additions require PG >= 12 (values usable after this migration's txn commits).

ALTER TYPE wallet_txn_type ADD VALUE IF NOT EXISTS 'debit_lead_unlock';
ALTER TYPE wallet_txn_type ADD VALUE IF NOT EXISTS 'refund_lead_dispute';
ALTER TYPE contact_event_type ADD VALUE IF NOT EXISTS 'dispute_refund';
ALTER TYPE contact_event_type ADD VALUE IF NOT EXISTS 'tenant_confirmed';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS access_state        text        NOT NULL DEFAULT 'locked',
  ADD COLUMN IF NOT EXISTS unlocked_at         timestamptz,
  ADD COLUMN IF NOT EXISTS unlock_txn_id       uuid        REFERENCES wallet_transactions(id),
  ADD COLUMN IF NOT EXISTS called_at           timestamptz,
  ADD COLUMN IF NOT EXISTS called_by           text,
  ADD COLUMN IF NOT EXISTS call_deadline_at    timestamptz,
  ADD COLUMN IF NOT EXISTS tenant_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_at         timestamptz;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_access_state_check
    CHECK (access_state IN ('free','locked','unlocked','expired'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_called_by_check
    CHECK (called_by IS NULL OR called_by IN ('owner','team'));
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Rescue queue + reminder sweep scan: uncalled leads approaching their deadline.
CREATE INDEX IF NOT EXISTS idx_leads_call_deadline
  ON leads (call_deadline_at)
  WHERE called_at IS NULL AND call_deadline_at IS NOT NULL;
```

```sql
-- infra/migrations/0053_lead_monetization.rollback.sql
-- Rollback 0053. Note: Postgres cannot drop enum values; the added
-- wallet_txn_type / contact_event_type values remain (harmless).
DROP INDEX IF EXISTS idx_leads_call_deadline;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_access_state_check;
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_called_by_check;
ALTER TABLE leads
  DROP COLUMN IF EXISTS access_state,
  DROP COLUMN IF EXISTS unlocked_at,
  DROP COLUMN IF EXISTS unlock_txn_id,
  DROP COLUMN IF EXISTS called_at,
  DROP COLUMN IF EXISTS called_by,
  DROP COLUMN IF EXISTS call_deadline_at,
  DROP COLUMN IF EXISTS tenant_confirmed_at,
  DROP COLUMN IF EXISTS disputed_at;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- migration-0053`
Expected: PASS (4 tests). Then apply it for later DB-gated tasks: `pnpm db:migrate`.

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/0053_lead_monetization.sql infra/migrations/0053_lead_monetization.rollback.sql apps/api/test/migration-0053-lead-monetization.integration.test.ts
git commit -m "feat(db): migration 0053 — lead access lifecycle + callback columns

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `ff_callback_leads` feature flag (API + web)

**Files:**
- Modify: `apps/api/src/config/feature-flags.ts` (interface ~line 86, defaults ~line 130+, `readFeatureFlags()` — follow the three-spot pattern of `ff_lead_management_enabled` at lines 32/119/278)
- Modify: `apps/web/lib/feature-flags.ts:9-15` (ENV_FLAG_MAP)
- Test: `apps/api/test/feature-flags-callback.test.ts`

**Interfaces:**
- Produces: `readFeatureFlags().ff_callback_leads: boolean` (default `false`, env `FF_CALLBACK_LEADS`); web `useFlag("ff_callback_leads")` reading `NEXT_PUBLIC_FF_CALLBACK_LEADS` OR PostHog.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/feature-flags-callback.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { defaultFeatureFlags, readFeatureFlags } from "../src/config/feature-flags";

describe("ff_callback_leads", () => {
  afterEach(() => {
    delete process.env.FF_CALLBACK_LEADS;
  });

  it("defaults OFF", () => {
    delete process.env.FF_CALLBACK_LEADS;
    expect(defaultFeatureFlags.ff_callback_leads).toBe(false);
    expect(readFeatureFlags().ff_callback_leads).toBe(false);
  });

  it("turns on via FF_CALLBACK_LEADS=true", () => {
    process.env.FF_CALLBACK_LEADS = "true";
    expect(readFeatureFlags().ff_callback_leads).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- feature-flags-callback`
Expected: FAIL — `ff_callback_leads` missing from `FeatureFlags`.

- [ ] **Step 3: Implement**

In `apps/api/src/config/feature-flags.ts`, add to the `FeatureFlags` interface (after `ff_seo_gsc`):

```ts
  /** Slice 1 – Lead monetization: callback-guarantee model (24h call promise, owner lead unlock). */
  ff_callback_leads: boolean;
```

Add to `defaultFeatureFlags` (same position):

```ts
  ff_callback_leads: false
```

Add inside `readFeatureFlags()`'s returned object (same position, matching the existing `parseBooleanEnv` idiom):

```ts
    ff_callback_leads: parseBooleanEnv(
      process.env.FF_CALLBACK_LEADS,
      defaultFeatureFlags.ff_callback_leads
    )
```

In `apps/web/lib/feature-flags.ts`, add to `ENV_FLAG_MAP`:

```ts
  ff_callback_leads: process.env.NEXT_PUBLIC_FF_CALLBACK_LEADS
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- feature-flags-callback`
Expected: PASS (2 tests). Also run `pnpm --filter @cribliv/web typecheck` — clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/feature-flags.ts apps/web/lib/feature-flags.ts apps/api/test/feature-flags-callback.test.ts
git commit -m "feat: ff_callback_leads flag (API env + web env/PostHog), default off

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Callback pivot in ContactsService (no phone reveal, 24h deadline)

**Files:**
- Modify: `apps/api/src/modules/contacts/contacts.service.ts` (`unlockContactDb` :166-429, `unlockContactInMemory` :431-511, `notifyOwnerContactUnlocked` :140-150)
- Test: `apps/api/test/callback-pivot.integration.test.ts`

**Interfaces:**
- Consumes: `readFeatureFlags().ff_callback_leads` (Task 3).
- Produces: with flag ON, `POST /v1/tenant/contact-unlocks` returns `{ unlock_id, callback: { status: "awaiting_call", call_deadline_at }, credits_remaining, response_deadline_at }` (NO `owner_contact`), deadline `now()+24h`. Flag OFF: byte-identical current behavior. Task 12's web panel consumes this shape.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/callback-pivot.integration.test.ts
// In-memory (no DATABASE_URL) integration test, phase1.integration.test.ts style.
import "reflect-metadata";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

async function createApp(overrides: Record<string, string | undefined> = {}) {
  delete process.env.DATABASE_URL;
  process.env.OTP_PROVIDER = "mock";
  process.env.PAYMENT_WEBHOOK_SECRET = "test_webhook_secret";
  process.env.FF_REAL_VERIFICATION_PROVIDER = "false";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix("v1");
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

function http(app: INestApplication) {
  return request(app.getHttpAdapter().getInstance());
}

async function loginWithOtp(app: INestApplication, phone: string) {
  const sendRes = await http(app)
    .post("/v1/auth/otp/send")
    .send({ phone_e164: phone, purpose: "login" })
    .expect(201);
  const verifyRes = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: sendRes.body.data.challenge_id,
      otp_code: sendRes.body.data.dev_otp,
      device_fingerprint: "callback-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string };
}

async function getFirstListingId(app: INestApplication) {
  const res = await http(app).get("/v1/listings/search").expect(200);
  return res.body.data.items[0].id as string;
}

describe("callback pivot (ff_callback_leads ON)", () => {
  let app: INestApplication;
  beforeEach(async () => {
    app = await createApp({ FF_CALLBACK_LEADS: "true" });
  });
  afterEach(async () => {
    await app.close();
  });

  it("returns callback shape without owner phone, 24h deadline", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    const res = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "cb-1")
      .send({ listing_id: listingId })
      .expect(201);

    expect(res.body.data.owner_contact).toBeUndefined();
    expect(res.body.data.callback.status).toBe("awaiting_call");
    const deadlineMs = new Date(res.body.data.callback.call_deadline_at).getTime();
    expect(deadlineMs).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    expect(deadlineMs).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000);
  });

  it("idempotent replay returns the same callback shape", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    const args = (k: string) =>
      http(app)
        .post("/v1/tenant/contact-unlocks")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", k)
        .send({ listing_id: listingId });
    const first = await args("cb-idem").expect(201);
    const second = await args("cb-idem").expect(201);
    expect(second.body.data.unlock_id).toBe(first.body.data.unlock_id);
    expect(second.body.data.owner_contact).toBeUndefined();
    expect(second.body.data.callback.status).toBe("awaiting_call");
  });

  it("still 402s when credits run out", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    for (const key of ["cb-a", "cb-b"]) {
      await http(app)
        .post("/v1/tenant/contact-unlocks")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", key)
        .send({ listing_id: listingId })
        .expect(201);
    }
    await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "cb-c")
      .send({ listing_id: listingId })
      .expect(402);
  });
});

describe("callback pivot regression (flag OFF)", () => {
  it("keeps the legacy owner_contact reveal", async () => {
    const app = await createApp();
    try {
      const tenant = await loginWithOtp(app, "+919999999902");
      const listingId = await getFirstListingId(app);
      const res = await http(app)
        .post("/v1/tenant/contact-unlocks")
        .set("Authorization", `Bearer ${tenant.access_token}`)
        .set("Idempotency-Key", "legacy-1")
        .send({ listing_id: listingId })
        .expect(201);
      expect(res.body.data.owner_contact.phone_e164).toBeTruthy();
      expect(res.body.data.callback).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- callback-pivot`
Expected: FAIL — flag-ON tests get `owner_contact` present / no `callback` field. Flag-OFF test passes already.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/contacts/contacts.service.ts`:

Add import: `import { readFeatureFlags } from "../../config/feature-flags";`

Add a private response builder (below the constructor):

```ts
  // Flag ON: the credit buys a guaranteed callback — the owner phone is never
  // returned to the tenant. Flag OFF: legacy reveal behavior, unchanged.
  private buildUnlockResponse(input: {
    unlockId: string;
    ownerPhone: string | null;
    whatsappAvailable: boolean;
    creditsRemaining: number;
    responseDeadlineAt: string;
  }) {
    if (readFeatureFlags().ff_callback_leads) {
      return {
        unlock_id: input.unlockId,
        callback: {
          status: "awaiting_call" as const,
          call_deadline_at: input.responseDeadlineAt
        },
        credits_remaining: input.creditsRemaining,
        response_deadline_at: input.responseDeadlineAt
      };
    }
    return {
      unlock_id: input.unlockId,
      owner_contact: {
        phone_e164: input.ownerPhone ?? "+919888888888",
        whatsapp_available: input.whatsappAvailable
      },
      credits_remaining: input.creditsRemaining,
      response_deadline_at: input.responseDeadlineAt
    };
  }
```

In `unlockContactDb`:
1. At the top of the method add: `const deadlineInterval = readFeatureFlags().ff_callback_leads ? "24 hours" : "12 hours";`
2. In the unlock INSERT (line ~351) replace `now() + interval '12 hours'` with `now() + interval '${deadlineInterval}'` (template literal — the value is a code constant, never user input; the SQL string is already assembled dynamically for the `source` column).
3. Replace the idempotent-hit return (lines ~217-225) with:

```ts
        return this.buildUnlockResponse({
          unlockId: row.id,
          ownerPhone: row.owner_phone,
          whatsappAvailable: row.whatsapp_available,
          creditsRemaining: Number(row.balance_credits),
          responseDeadlineAt: row.response_deadline_at
        });
```

4. Replace the final return (lines ~414-422) with:

```ts
      return this.buildUnlockResponse({
        unlockId: unlockId,
        ownerPhone: listing.owner_phone,
        whatsappAvailable: listing.whatsapp_available,
        creditsRemaining: Number(balanceAfterResult.rows[0]?.balance_credits ?? 0),
        responseDeadlineAt: responseDeadlineAt
      });
```

In `unlockContactInMemory`:
1. Replace the idempotent-hit return object (lines ~441-449) with:

```ts
      return this.buildUnlockResponse({
        unlockId: existing.id,
        ownerPhone: "+919888888888",
        whatsappAvailable: true,
        creditsRemaining: this.appState.getWalletBalance(userId),
        responseDeadlineAt: new Date(existing.responseDeadlineAt).toISOString()
      });
```

2. Replace the deadline (line ~490): `responseDeadlineAt: Date.now() + (readFeatureFlags().ff_callback_leads ? 24 : 12) * 60 * 60 * 1000`
3. Replace the final return (lines ~502-510) with the same `buildUnlockResponse` call using `unlock.id` and `unlock.responseDeadlineAt`.

In `notifyOwnerContactUnlocked` (line ~147), replace `response_deadline: "12 घंटे"` with:

```ts
          response_deadline: readFeatureFlags().ff_callback_leads ? "24 घंटे" : "12 घंटे"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/api test -- callback-pivot && pnpm --filter @cribliv/api test -- phase1`
Expected: PASS — including all existing phase1 tests (flag-off regression).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts/contacts.service.ts apps/api/test/callback-pivot.integration.test.ts
git commit -m "feat(api): callback pivot — no owner phone in unlock response, 24h deadline (ff_callback_leads)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Lead access lifecycle at creation + owner leads read model

**Files:**
- Modify: `apps/api/src/modules/leads/leads.service.ts` (`createLead` :26-81, `getOwnerLeads` :83-145)
- Modify: `apps/api/src/modules/contacts/contacts.service.ts` (`createLeadFromUnlock` :81-107 and its call site :49)
- Test: `apps/api/test/lead-access-state.integration.test.ts`

**Interfaces:**
- Consumes: migration 0053 columns (Task 2), flag (Task 3), callback response `response_deadline_at` (Task 4).
- Produces: `createLead(params)` accepts new optional `call_deadline_at?: string`; first 2 leads per owner (lifetime count) get `access_state='free'`, later ones `'locked'`. `getOwnerLeads` rows gain `access_state`, `call_deadline_at`, `called_at`, `called_by`, and `tenant_phone` (full number — non-null ONLY when flag ON and `access_state IN ('free','unlocked')`). Tasks 6/7/9/11 rely on these exact field names.

- [ ] **Step 1: Write the failing test**

This is a DB-gated full-stack test (real Postgres, `describe.runIf`). It logs users in via OTP against the DB (first verify grants 2 credits), promotes one to owner by SQL, seeds a listing by SQL, then exercises the HTTP flow. Random phones isolate runs; `afterAll` cleans up.

```ts
// apps/api/test/lead-access-state.integration.test.ts
import "reflect-metadata";
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

async function loginWithOtp(app: INestApplication, phone: string) {
  const sendRes = await http(app)
    .post("/v1/auth/otp/send")
    .send({ phone_e164: phone, purpose: "login" })
    .expect(201);
  const verifyRes = await http(app)
    .post("/v1/auth/otp/verify")
    .send({
      challenge_id: sendRes.body.data.challenge_id,
      otp_code: sendRes.body.data.dev_otp,
      device_fingerprint: "lead-access-test"
    })
    .expect(201);
  return verifyRes.body.data as { access_token: string; user: { id: string } };
}

describe.runIf(!!TEST_DB)("lead access lifecycle (DB)", () => {
  let app: INestApplication;
  let db: Client;
  const phones = [randPhone(), randPhone(), randPhone(), randPhone()];
  const [ownerPhone, tenantA, tenantB, tenantC] = phones;
  let listingId: string;
  let ownerToken: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.OTP_PROVIDER = "mock";
    process.env.FF_CALLBACK_LEADS = "true";
    process.env.FF_LEAD_MANAGEMENT_ENABLED = "true";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("v1");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    db = new Client({ connectionString: TEST_DB! });
    await db.connect();

    const owner = await loginWithOtp(app, ownerPhone);
    await db.query(`UPDATE users SET role = 'owner' WHERE phone_e164 = $1`, [ownerPhone]);
    ownerToken = (await loginWithOtp(app, ownerPhone)).access_token;

    const listing = await db.query<{ id: string }>(
      `INSERT INTO listings (owner_user_id, listing_type, title_en, monthly_rent, status, contact_phone_encrypted)
       VALUES ($1::uuid, 'flat_house', 'Lead Access Test Flat', 12000, 'active', '+919777777777')
       RETURNING id::text`,
      [owner.user.id]
    );
    listingId = listing.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await db.query(
      `DELETE FROM contact_events WHERE contact_unlock_id IN
         (SELECT id FROM contact_unlocks WHERE listing_id = $1::uuid)`, [listingId]);
    await db.query(
      `DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE listing_id = $1::uuid)`,
      [listingId]);
    await db.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await db.query(`DELETE FROM contact_unlocks WHERE listing_id = $1::uuid`, [listingId]);
    await db.query(
      `DELETE FROM wallet_transactions WHERE wallet_user_id IN
         (SELECT id FROM users WHERE phone_e164 = ANY($1))`, [phones]);
    await db.query(
      `DELETE FROM wallets WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]);
    await db.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await db.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE phone_e164 = ANY($1))`,
      [phones]);
    await db.query(`DELETE FROM otp_challenges WHERE phone_e164 = ANY($1)`, [phones]);
    await db.query(`DELETE FROM users WHERE phone_e164 = ANY($1)`, [phones]);
    await db.end();
    await app.close();
    delete process.env.DATABASE_URL;
    delete process.env.FF_CALLBACK_LEADS;
    delete process.env.FF_LEAD_MANAGEMENT_ENABLED;
  }, 60_000);

  async function requestCallback(phone: string, key: string) {
    const tenant = await loginWithOtp(app, phone);
    await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", key)
      .send({ listing_id: listingId })
      .expect(201);
    // lead creation is fire-and-forget; give it a beat
    await new Promise((r) => setTimeout(r, 300));
  }

  it("first 2 leads are free with full tenant phone; 3rd is locked and masked", async () => {
    await requestCallback(tenantA, "la-1");
    await requestCallback(tenantB, "la-2");
    await requestCallback(tenantC, "la-3");

    const res = await http(app)
      .get("/v1/owner/leads")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(items.length).toBe(3);
    // newest first: tenantC's lead is items[0]
    const free = items.filter((l) => l.access_state === "free");
    const locked = items.filter((l) => l.access_state === "locked");
    expect(free.length).toBe(2);
    expect(locked.length).toBe(1);
    for (const lead of free) {
      expect(lead.tenant_phone).toMatch(/^\+91/);
    }
    expect(locked[0].tenant_phone).toBeNull();
    expect(locked[0].tenant_phone_masked).toMatch(/X/);
    const deadline = new Date(String(locked[0].call_deadline_at)).getTime();
    expect(deadline).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- lead-access-state`
Expected: FAIL — `access_state` is `'locked'` for all leads (default), `tenant_phone` undefined, `call_deadline_at` null.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/leads/leads.service.ts`, replace `createLead` with:

```ts
  async createLead(params: {
    listing_id: string;
    owner_user_id: string;
    tenant_user_id: string;
    contact_unlock_id?: string;
    tenant_phone_masked?: string;
    call_deadline_at?: string;
  }): Promise<{ lead_id: string; created: boolean }> {
    const flags = readFeatureFlags();
    if (!flags.ff_lead_management_enabled || !this.database.isEnabled()) {
      return { lead_id: "", created: false };
    }

    try {
      // Check 7-day dedup window
      const existing = await this.database.query<{ id: string }>(
        `SELECT id::text FROM leads
         WHERE listing_id = $1::uuid AND tenant_user_id = $2::uuid
           AND created_at > now() - interval '7 days'
         LIMIT 1`,
        [params.listing_id, params.tenant_user_id]
      );

      if (existing.rows.length > 0) {
        return { lead_id: existing.rows[0].id, created: false };
      }

      // First 2 leads per owner (lifetime) arrive free/un-blurred — the owner's
      // taste of lead quality. Racing concurrent leads can occasionally grant a
      // 3rd freebie; acceptable at current scale.
      const ownerLeadCount = await this.database.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM leads WHERE owner_user_id = $1::uuid`,
        [params.owner_user_id]
      );
      const accessState = Number(ownerLeadCount.rows[0]?.n ?? 0) < 2 ? "free" : "locked";

      const result = await this.database.query<{ id: string }>(
        `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id,
                            tenant_phone_masked, status, access_state, call_deadline_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 'new', $6, $7::timestamptz)
         ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET
           contact_unlock_id = COALESCE(EXCLUDED.contact_unlock_id, leads.contact_unlock_id),
           call_deadline_at = COALESCE(EXCLUDED.call_deadline_at, leads.call_deadline_at),
           updated_at = now()
         RETURNING id::text`,
        [
          params.listing_id,
          params.owner_user_id,
          params.tenant_user_id,
          params.contact_unlock_id ?? null,
          params.tenant_phone_masked ?? null,
          accessState,
          params.call_deadline_at ?? null
        ]
      );

      const leadId = result.rows[0].id;

      await this.database.query(
        `INSERT INTO lead_events (lead_id, to_status, actor_user_id)
         VALUES ($1::uuid, 'new', $2::uuid)`,
        [leadId, params.tenant_user_id]
      );

      return { lead_id: leadId, created: true };
    } catch (error) {
      this.logger.error("Failed to create lead", error);
      return { lead_id: "", created: false };
    }
  }
```

In `getOwnerLeads`, read the flag at the top (`const flags = readFeatureFlags();`), extend the row generic with `access_state: string; call_deadline_at: string | null; called_at: string | null; called_by: string | null; tenant_phone: string | null;`, and replace the SELECT list so it includes (after `ld.tenant_phone_masked,`):

```sql
         ld.access_state,
         ld.call_deadline_at::text,
         ld.called_at::text,
         ld.called_by,
         ${tenantPhoneSelect} AS tenant_phone,
```

where above the query you define:

```ts
    // Full tenant number is exposed ONLY for free/unlocked leads with the flag on.
    const tenantPhoneSelect = flags.ff_callback_leads
      ? `CASE WHEN ld.access_state IN ('free','unlocked') THEN u.phone_e164 ELSE NULL END`
      : `NULL`;
```

In `apps/api/src/modules/contacts/contacts.service.ts`:
- `createLeadFromUnlock` signature gains `callDeadlineAt: string | null` as 4th parameter and passes it through: `call_deadline_at: callDeadlineAt ?? undefined`.
- The call site in `unlockContact` (line ~49) becomes:

```ts
    this.createLeadFromUnlock(
      listingId,
      userId,
      result.unlock_id,
      (result as { response_deadline_at?: string }).response_deadline_at ?? null
    ).catch((err) => {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- lead-access-state && pnpm --filter @cribliv/api test -- phase1 callback-pivot`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/leads/leads.service.ts apps/api/src/modules/contacts/contacts.service.ts apps/api/test/lead-access-state.integration.test.ts
git commit -m "feat(api): lead access lifecycle — first-2-free, 24h deadline, gated tenant phone in owner leads

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Owner lead unlock endpoint

**Files:**
- Modify: `apps/api/src/modules/leads/leads.service.ts` (new method `unlockLead`, replacing the role of `openLeadForOperator`'s 402 seam — leave `openLeadForOperator` untouched)
- Modify: `apps/api/src/modules/leads/leads.controller.ts` (new route)
- Test: `apps/api/test/lead-unlock.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 columns, Task 3 flag, Task 5 access states, wallet-debit pattern from `contacts.service.ts:unlockContactDb`.
- Produces: `POST /v1/owner/leads/:id/unlock` (roles `owner`,`pg_operator`; `Idempotency-Key` header required) → `{ lead_id, access_state: "unlocked", tenant_phone, tenant_name, credits_remaining }`. Errors: `402 insufficient_credits`, `410 lead_expired`, `404 not_found`, `403 feature_disabled` (flag off). Service method: `unlockLead(leadId: string, ownerUserId: string, idempotencyKey: string)`. Task 11's web wrapper consumes this response shape.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/lead-unlock.integration.test.ts
// DB-gated. Reuses the setup style of lead-access-state.integration.test.ts:
// copy its imports, randPhone/http/loginWithOtp helpers, beforeAll/afterAll
// (same env, same cleanup) — same owner + listing seeding, plus three tenants
// tenantA/tenantB/tenantC creating leads la-1/la-2/la-3 in beforeAll so the
// third lead is 'locked'. Then:

describe.runIf(!!TEST_DB)("owner lead unlock (DB)", () => {
  // ...setup as described above; additionally resolve `lockedLeadId` and
  // `freeLeadId` in beforeAll via:
  //   SELECT id::text, access_state FROM leads WHERE listing_id = $1 ORDER BY created_at ASC

  it("402s when the owner wallet is empty", async () => {
    await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-nofunds")
      .expect(402);
  });

  it("debits 1 owner credit and reveals the tenant phone; idempotent replay", async () => {
    await db.query(
      `INSERT INTO wallets (user_id, balance_credits, free_credits_granted)
       VALUES ((SELECT id FROM users WHERE phone_e164 = $1), 3, 0)
       ON CONFLICT (user_id) DO UPDATE SET balance_credits = 3`,
      [ownerPhone]
    );
    const first = await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-1")
      .expect(201);
    expect(first.body.data.access_state).toBe("unlocked");
    expect(first.body.data.tenant_phone).toMatch(/^\+91/);
    expect(first.body.data.credits_remaining).toBe(2);

    const replay = await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-1")
      .expect(201);
    expect(replay.body.data.credits_remaining).toBe(2); // no double debit

    const txns = await db.query(
      `SELECT count(*)::int AS n FROM wallet_transactions
       WHERE txn_type = 'debit_lead_unlock'
         AND wallet_user_id = (SELECT id FROM users WHERE phone_e164 = $1)`,
      [ownerPhone]
    );
    expect(txns.rows[0].n).toBe(1);
  });

  it("free leads unlock without debiting", async () => {
    const res = await http(app)
      .post(`/v1/owner/leads/${freeLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-free")
      .expect(201);
    expect(res.body.data.tenant_phone).toMatch(/^\+91/);
    expect(res.body.data.credits_remaining).toBe(2); // unchanged
  });

  it("410s on an expired lead", async () => {
    // force a fresh locked lead past its deadline
    await db.query(
      `UPDATE leads SET call_deadline_at = now() - interval '1 hour'
       WHERE id = $1::uuid AND access_state = 'locked'`, [expiredLeadId]);
    await http(app)
      .post(`/v1/owner/leads/${expiredLeadId}/unlock`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "lu-exp")
      .expect(410);
  });
});
```

(`expiredLeadId`: create a 4th tenant + callback in beforeAll so there are two locked leads; use the second as the expiry victim. Write the file out in full — every helper copied concretely, no "same as" imports across test files.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- lead-unlock`
Expected: FAIL — 404 (route does not exist).

- [ ] **Step 3: Implement the service method**

In `apps/api/src/modules/leads/leads.service.ts` add (imports: `HttpException`, `HttpStatus` already present; add `NotFoundException`, `ForbiddenException` to the `@nestjs/common` import):

```ts
  /**
   * Paid reveal of a lead's tenant contact (ff_callback_leads).
   * Mirrors the tenant-side wallet debit in ContactsService.unlockContactDb:
   * row lock → idempotent txn insert → balance decrement → state flip, all in
   * one transaction. Free leads return the phone without touching the wallet.
   */
  async unlockLead(leadId: string, ownerUserId: string, idempotencyKey: string) {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({ code: "feature_disabled", message: "Lead unlock is not enabled" });
    }
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");

      const leadResult = await client.query<{
        id: string;
        access_state: string;
        call_deadline_at: string | null;
        deadline_passed: boolean;
        tenant_phone: string | null;
        tenant_name: string;
      }>(
        `SELECT ld.id::text, ld.access_state, ld.call_deadline_at::text,
                (ld.call_deadline_at IS NOT NULL AND ld.call_deadline_at <= now()) AS deadline_passed,
                u.phone_e164 AS tenant_phone,
                COALESCE(u.full_name, 'Tenant') AS tenant_name
         FROM leads ld
         LEFT JOIN users u ON u.id = ld.tenant_user_id
         WHERE ld.id = $1::uuid AND ld.owner_user_id = $2::uuid
         FOR UPDATE OF ld`,
        [leadId, ownerUserId]
      );

      const lead = leadResult.rows[0];
      if (!lead) {
        throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      }

      const balanceRow = async () => {
        const r = await client.query<{ balance_credits: number }>(
          `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid LIMIT 1`,
          [ownerUserId]
        );
        return Number(r.rows[0]?.balance_credits ?? 0);
      };

      // Idempotent success paths: already visible → return without debiting.
      if (lead.access_state === "free" || lead.access_state === "unlocked") {
        const credits = await balanceRow();
        await client.query("COMMIT");
        return {
          lead_id: lead.id,
          access_state: lead.access_state === "free" ? "free" : "unlocked",
          tenant_phone: lead.tenant_phone,
          tenant_name: lead.tenant_name,
          credits_remaining: credits
        };
      }

      if (lead.access_state === "expired" || lead.deadline_passed) {
        throw new HttpException(
          { code: "lead_expired", message: "Lead expired — it can no longer be unlocked" },
          HttpStatus.GONE
        );
      }

      await client.query(
        `INSERT INTO wallets(user_id, balance_credits, free_credits_granted)
         VALUES ($1::uuid, 0, 0) ON CONFLICT (user_id) DO NOTHING`,
        [ownerUserId]
      );
      const walletResult = await client.query<{ balance_credits: number }>(
        `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid FOR UPDATE`,
        [ownerUserId]
      );
      if (Number(walletResult.rows[0]?.balance_credits ?? 0) < 1) {
        throw new HttpException(
          { code: "insufficient_credits", message: "Insufficient credits" },
          HttpStatus.PAYMENT_REQUIRED
        );
      }

      const debit = await client.query<{ id: string }>(
        `INSERT INTO wallet_transactions(
           wallet_user_id, txn_type, credits_delta, reference_type, reference_id, idempotency_key, metadata)
         VALUES ($1::uuid, 'debit_lead_unlock', -1, 'lead', $2::uuid, $3, '{}'::jsonb)
         ON CONFLICT (wallet_user_id, idempotency_key) DO NOTHING
         RETURNING id::text`,
        [ownerUserId, leadId, idempotencyKey]
      );
      const debitInserted = Boolean(debit.rows[0]?.id);
      if (debitInserted) {
        await client.query(
          `UPDATE wallets SET balance_credits = balance_credits - 1, updated_at = now()
           WHERE user_id = $1::uuid AND balance_credits >= 1`,
          [ownerUserId]
        );
        await client.query(
          `UPDATE leads SET access_state = 'unlocked', unlocked_at = now(),
                            unlock_txn_id = $2::uuid, updated_at = now()
           WHERE id = $1::uuid`,
          [leadId, debit.rows[0].id]
        );
        await client.query(
          `INSERT INTO lead_events (lead_id, to_status, actor_user_id, notes)
           VALUES ($1::uuid, (SELECT status FROM leads WHERE id = $1::uuid), $2::uuid, 'lead_unlocked')`,
          [leadId, ownerUserId]
        );
      }

      const credits = await balanceRow();
      await client.query("COMMIT");
      logTelemetry("lead.unlocked", {
        lead_id: leadId,
        owner_user_id: ownerUserId,
        debited: debitInserted
      });
      return {
        lead_id: leadId,
        access_state: "unlocked",
        tenant_phone: lead.tenant_phone,
        tenant_name: lead.tenant_name,
        credits_remaining: credits
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
```

Add imports at the top of the file: `import { logTelemetry } from "../../common/telemetry";` and extend the `@nestjs/common` import with `NotFoundException, ForbiddenException`. `LeadsService` needs `this.database.getClient()` — `DatabaseService` already exposes it (used in `contacts.service.ts`).

In `apps/api/src/modules/leads/leads.controller.ts` add (import `Post` from `@nestjs/common`, `Req`; import `requireIdempotencyKey` from `../../common/idempotency.util`):

```ts
  @Post("owner/leads/:id/unlock")
  @Roles("owner", "pg_operator")
  async unlockLead(
    @Req() req: { user: { id: string }; headers: Record<string, string> },
    @Param("id") leadId: string
  ) {
    const idempotencyKey = requireIdempotencyKey(req.headers["idempotency-key"]);
    return ok(await this.leadsService.unlockLead(leadId, req.user.id, idempotencyKey));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- lead-unlock`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/leads/leads.service.ts apps/api/src/modules/leads/leads.controller.ts apps/api/test/lead-unlock.integration.test.ts
git commit -m "feat(api): owner lead unlock — wallet debit reveal behind ff_callback_leads

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Call-click endpoint (stops the refund clock)

**Files:**
- Modify: `apps/api/src/modules/leads/leads.service.ts` (new methods `recordCallClick`, private `markLeadCalled`)
- Modify: `apps/api/src/modules/leads/leads.controller.ts` (new route)
- Test: `apps/api/test/lead-call-click.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 2/3/5/6.
- Produces: `POST /v1/owner/leads/:id/call-click` (roles `owner`,`pg_operator`) → `{ lead_id, called_at, tel }` where `tel` is `tel:+91…`. Sets `leads.called_at`/`called_by='owner'` (first click wins) AND flips the linked `contact_unlocks` row to `owner_response_status='responded'` — which is exactly what the existing refund sweep checks, so the tenant's refund clock stops. Errors: `409 lead_locked` if `access_state` not in (`free`,`unlocked`), `404 not_found`, `403 feature_disabled`. Private helper `markLeadCalled(client, leadId, contactUnlockId, calledBy)` — Task 9 reuses it for team-called.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/lead-call-click.integration.test.ts
// DB-gated. Full setup copied concretely from lead-access-state.integration.test.ts
// (owner + listing + tenants A/B/C with callbacks la-cc-1..3; third lead locked).

describe.runIf(!!TEST_DB)("lead call-click (DB)", () => {
  it("records called_at and marks the linked unlock responded", async () => {
    // freeLeadId: one of the two free leads (query as in Task 6 setup)
    const res = await http(app)
      .post(`/v1/owner/leads/${freeLeadId}/call-click`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    expect(res.body.data.tel).toMatch(/^tel:\+91/);
    expect(res.body.data.called_at).toBeTruthy();

    const lead = await db.query(
      `SELECT called_at, called_by, contact_unlock_id FROM leads WHERE id = $1::uuid`, [freeLeadId]);
    expect(lead.rows[0].called_by).toBe("owner");
    const unlock = await db.query(
      `SELECT owner_response_status FROM contact_unlocks WHERE id = $1::uuid`,
      [lead.rows[0].contact_unlock_id]);
    expect(unlock.rows[0].owner_response_status).toBe("responded");
  });

  it("is idempotent — second click keeps the first called_at", async () => {
    const first = await db.query(`SELECT called_at FROM leads WHERE id = $1::uuid`, [freeLeadId]);
    await http(app)
      .post(`/v1/owner/leads/${freeLeadId}/call-click`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(201);
    const second = await db.query(`SELECT called_at FROM leads WHERE id = $1::uuid`, [freeLeadId]);
    expect(String(second.rows[0].called_at)).toBe(String(first.rows[0].called_at));
  });

  it("409s on a locked lead", async () => {
    await http(app)
      .post(`/v1/owner/leads/${lockedLeadId}/call-click`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- lead-call-click`
Expected: FAIL — 404, route missing.

- [ ] **Step 3: Implement**

In `apps/api/src/modules/leads/leads.service.ts` add:

```ts
  /**
   * Shared claim-a-call helper: stamps the lead and flips the linked
   * contact_unlock to 'responded' so the refund sweep skips it. First claim
   * wins; later calls are no-ops. `client` must be inside a transaction.
   */
  private async markLeadCalled(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rowCount: number | null }> },
    leadId: string,
    contactUnlockId: string | null,
    calledBy: "owner" | "team"
  ): Promise<boolean> {
    const stamped = await client.query(
      `UPDATE leads SET called_at = now(), called_by = $2, updated_at = now()
       WHERE id = $1::uuid AND called_at IS NULL`,
      [leadId, calledBy]
    );
    if (!stamped.rowCount) return false;

    if (contactUnlockId) {
      const responded = await client.query(
        `UPDATE contact_unlocks
         SET owner_response_status = 'responded', owner_responded_at = now(), updated_at = now()
         WHERE id = $1::uuid AND owner_response_status = 'pending'`,
        [contactUnlockId]
      );
      if (responded.rowCount) {
        await client.query(
          `INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
           VALUES ($1::uuid, $2, 'owner_responded', $3::jsonb)`,
          [contactUnlockId, calledBy === "team" ? "system" : "owner", JSON.stringify({ channel: "call", called_by: calledBy })]
        );
      }
    }
    return true;
  }

  async recordCallClick(leadId: string, ownerUserId: string) {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({ code: "feature_disabled", message: "Call tracking is not enabled" });
    }
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }

    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");
      const leadResult = await client.query<{
        id: string;
        access_state: string;
        contact_unlock_id: string | null;
        called_at: string | null;
        tenant_phone: string | null;
      }>(
        `SELECT ld.id::text, ld.access_state, ld.contact_unlock_id::text,
                ld.called_at::text, u.phone_e164 AS tenant_phone
         FROM leads ld
         LEFT JOIN users u ON u.id = ld.tenant_user_id
         WHERE ld.id = $1::uuid AND ld.owner_user_id = $2::uuid
         FOR UPDATE OF ld`,
        [leadId, ownerUserId]
      );
      const lead = leadResult.rows[0];
      if (!lead) {
        throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      }
      if (lead.access_state !== "free" && lead.access_state !== "unlocked") {
        throw new ConflictException({
          code: "lead_locked",
          message: "Unlock the lead before calling"
        });
      }

      await this.markLeadCalled(client, leadId, lead.contact_unlock_id, "owner");
      const stamped = await client.query<{ called_at: string }>(
        `SELECT called_at::text FROM leads WHERE id = $1::uuid`,
        [leadId]
      );
      await client.query("COMMIT");
      logTelemetry("lead.call_clicked", { lead_id: leadId, owner_user_id: ownerUserId });
      return {
        lead_id: leadId,
        called_at: stamped.rows[0].called_at,
        tel: `tel:${lead.tenant_phone ?? ""}`
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
```

(Add `ConflictException` to the `@nestjs/common` import.)

In `leads.controller.ts` add:

```ts
  @Post("owner/leads/:id/call-click")
  @Roles("owner", "pg_operator")
  async callClick(@AuthUser() user: { id: string }, @Param("id") leadId: string) {
    return ok(await this.leadsService.recordCallClick(leadId, user.id));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- lead-call-click`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/leads/leads.service.ts apps/api/src/modules/leads/leads.controller.ts apps/api/test/lead-call-click.integration.test.ts
git commit -m "feat(api): call-click claims the callback and stops the tenant refund clock

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Tenant callbacks — list, confirm, dispute

**Files:**
- Modify: `apps/api/src/modules/contacts/contacts.controller.ts` (3 new routes — note the class is `@Controller("tenant")` + `@Roles("tenant")`, so paths are `callbacks`, `callbacks/:id/confirm`, `callbacks/:id/dispute`)
- Modify: `apps/api/src/modules/contacts/contacts.service.ts` (methods `listCallbacks`, `confirmCallback`, `disputeCallback`, dual-mode)
- Modify: `apps/api/src/common/app-state.service.ts` (UnlockRecord gains `tenantConfirmedAt?: number; disputedAt?: number;` — the record type is defined near line 63)
- Test: `apps/api/test/tenant-callbacks.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 2/3/4; existing `markOwnerResponded` flow (`POST owner/contact-unlocks/:unlock_id/responded` in `owner.controller.ts:131`) as the call-claim signal in tests.
- Produces:
  - `GET /v1/tenant/callbacks` → `{ items: [{ callback_id, listing_id, listing_title, status, requested_at, call_deadline_at, call_claimed_at, tenant_confirmed_at, disputed_at }] }`, `status: "awaiting_call" | "call_claimed" | "refunded"`.
  - `POST /v1/tenant/callbacks/:id/confirm` → `{ callback_id, tenant_confirmed_at }`.
  - `POST /v1/tenant/callbacks/:id/dispute` → `{ callback_id, refunded: true, credits_remaining }` (+1 `refund_lead_dispute` txn, unlock → `refunded`, lead `disputed_at`, fraud flag when `called_by='owner'`). Errors: `409 no_call_claimed`, `409 dispute_window_closed` (72h), `409 already_refunded`, `403 feature_disabled`.
  - Task 13's web page consumes these exact shapes.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/tenant-callbacks.integration.test.ts
// In-memory, phase1 style. Copy createApp/http/loginWithOtp/getFirstListingId
// helpers concretely from callback-pivot.integration.test.ts. All suites use
// createApp({ FF_CALLBACK_LEADS: "true" }).
import { AppStateService } from "../src/common/app-state.service";

describe("tenant callbacks", () => {
  // beforeEach: app = await createApp({ FF_CALLBACK_LEADS: "true" })

  it("lists a fresh request as awaiting_call", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-1")
      .send({ listing_id: listingId })
      .expect(201);

    const list = await http(app)
      .get("/v1/tenant/callbacks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    const item = list.body.data.items.find(
      (i: { callback_id: string }) => i.callback_id === unlock.body.data.unlock_id
    );
    expect(item.status).toBe("awaiting_call");
    expect(item.call_claimed_at).toBeNull();
  });

  it("shows call_claimed after the owner responds, and confirm records it", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-2")
      .send({ listing_id: listingId })
      .expect(201);
    const unlockId = unlock.body.data.unlock_id as string;

    await http(app)
      .post(`/v1/owner/contact-unlocks/${unlockId}/responded`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({ channel: "call" })
      .expect(201);

    const list = await http(app)
      .get("/v1/tenant/callbacks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(200);
    const item = list.body.data.items.find((i: { callback_id: string }) => i.callback_id === unlockId);
    expect(item.status).toBe("call_claimed");

    const confirm = await http(app)
      .post(`/v1/tenant/callbacks/${unlockId}/confirm`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(201);
    expect(confirm.body.data.tenant_confirmed_at).toBeTruthy();
  });

  it("dispute refunds the credit exactly once", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-3")
      .send({ listing_id: listingId })
      .expect(201);
    const unlockId = unlock.body.data.unlock_id as string;
    await http(app)
      .post(`/v1/owner/contact-unlocks/${unlockId}/responded`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({ channel: "call" })
      .expect(201);

    const dispute = await http(app)
      .post(`/v1/tenant/callbacks/${unlockId}/dispute`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(201);
    expect(dispute.body.data.refunded).toBe(true);
    expect(dispute.body.data.credits_remaining).toBe(2); // 2 - 1 + 1

    await http(app)
      .post(`/v1/tenant/callbacks/${unlockId}/dispute`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(409); // already_refunded
  });

  it("409s a dispute with no claimed call", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-4")
      .send({ listing_id: listingId })
      .expect(201);
    await http(app)
      .post(`/v1/tenant/callbacks/${unlock.body.data.unlock_id}/dispute`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(409);
  });

  it("409s a dispute outside the 72h window", async () => {
    const tenant = await loginWithOtp(app, "+919999999902");
    const owner = await loginWithOtp(app, "+919999999901");
    const listingId = await getFirstListingId(app);
    const unlock = await http(app)
      .post("/v1/tenant/contact-unlocks")
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .set("Idempotency-Key", "tc-5")
      .send({ listing_id: listingId })
      .expect(201);
    const unlockId = unlock.body.data.unlock_id as string;
    await http(app)
      .post(`/v1/owner/contact-unlocks/${unlockId}/responded`)
      .set("Authorization", `Bearer ${owner.access_token}`)
      .send({ channel: "call" })
      .expect(201);

    const appState = app.get(AppStateService);
    const record = appState.unlocks.get(unlockId)!;
    record.ownerRespondedAt = Date.now() - 73 * 60 * 60 * 1000;

    await http(app)
      .post(`/v1/tenant/callbacks/${unlockId}/dispute`)
      .set("Authorization", `Bearer ${tenant.access_token}`)
      .expect(409); // dispute_window_closed
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- tenant-callbacks`
Expected: FAIL — 404 on `/v1/tenant/callbacks`.

- [ ] **Step 3: Implement**

`apps/api/src/common/app-state.service.ts`: add to the unlock record type (near line 63):

```ts
  tenantConfirmedAt?: number;
  disputedAt?: number;
```

`apps/api/src/modules/contacts/contacts.controller.ts` — add routes (import `Get`, `Param`):

```ts
  @Get("callbacks")
  async listCallbacks(@Req() req: { user: { id: string } }) {
    return ok(await this.contactsService.listCallbacks(req.user.id));
  }

  @Post("callbacks/:id/confirm")
  async confirmCallback(@Req() req: { user: { id: string } }, @Param("id") callbackId: string) {
    return ok(await this.contactsService.confirmCallback(req.user.id, callbackId));
  }

  @Post("callbacks/:id/dispute")
  async disputeCallback(@Req() req: { user: { id: string } }, @Param("id") callbackId: string) {
    return ok(await this.contactsService.disputeCallback(req.user.id, callbackId));
  }
```

`apps/api/src/modules/contacts/contacts.service.ts` — add (72h constant at module top: `const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000;`):

```ts
  private ensureCallbackMode() {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({ code: "feature_disabled", message: "Callbacks are not enabled" });
    }
  }

  private deriveCallbackStatus(input: {
    unlockStatus: string;
    ownerRespondedAt: string | number | null | undefined;
  }): "awaiting_call" | "call_claimed" | "refunded" {
    if (input.unlockStatus === "refunded") return "refunded";
    if (input.ownerRespondedAt) return "call_claimed";
    return "awaiting_call";
  }

  async listCallbacks(tenantUserId: string) {
    this.ensureCallbackMode();
    if (!this.database.isEnabled()) {
      const items = [...this.appState.unlocks.values()]
        .filter((u) => u.tenantUserId === tenantUserId)
        .sort((a, b) => b.responseDeadlineAt - a.responseDeadlineAt)
        .map((u) => ({
          callback_id: u.id,
          listing_id: u.listingId,
          listing_title: "Listing",
          status: this.deriveCallbackStatus({
            unlockStatus: u.unlockStatus,
            ownerRespondedAt: u.ownerRespondedAt
          }),
          requested_at: null,
          call_deadline_at: new Date(u.responseDeadlineAt).toISOString(),
          call_claimed_at: u.ownerRespondedAt ? new Date(u.ownerRespondedAt).toISOString() : null,
          tenant_confirmed_at: u.tenantConfirmedAt ? new Date(u.tenantConfirmedAt).toISOString() : null,
          disputed_at: u.disputedAt ? new Date(u.disputedAt).toISOString() : null
        }));
      return { items };
    }

    const result = await this.database.query<{
      callback_id: string;
      listing_id: string;
      listing_title: string;
      unlock_status: string;
      requested_at: string;
      call_deadline_at: string;
      call_claimed_at: string | null;
      tenant_confirmed_at: string | null;
      disputed_at: string | null;
    }>(
      `SELECT cu.id::text AS callback_id, cu.listing_id::text,
              COALESCE(NULLIF(l.title_en, ''), 'Listing') AS listing_title,
              cu.unlock_status::text AS unlock_status,
              cu.created_at::text AS requested_at,
              cu.response_deadline_at::text AS call_deadline_at,
              cu.owner_responded_at::text AS call_claimed_at,
              ld.tenant_confirmed_at::text, ld.disputed_at::text
       FROM contact_unlocks cu
       JOIN listings l ON l.id = cu.listing_id
       LEFT JOIN leads ld ON ld.contact_unlock_id = cu.id
       WHERE cu.tenant_user_id = $1::uuid
       ORDER BY cu.created_at DESC
       LIMIT 50`,
      [tenantUserId]
    );
    return {
      items: result.rows.map((r) => ({
        callback_id: r.callback_id,
        listing_id: r.listing_id,
        listing_title: r.listing_title,
        status: this.deriveCallbackStatus({
          unlockStatus: r.unlock_status,
          ownerRespondedAt: r.call_claimed_at
        }),
        requested_at: r.requested_at,
        call_deadline_at: r.call_deadline_at,
        call_claimed_at: r.call_claimed_at,
        tenant_confirmed_at: r.tenant_confirmed_at,
        disputed_at: r.disputed_at
      }))
    };
  }

  async confirmCallback(tenantUserId: string, callbackId: string) {
    this.ensureCallbackMode();
    if (!this.database.isEnabled()) {
      const unlock = this.appState.unlocks.get(callbackId);
      if (!unlock || unlock.tenantUserId !== tenantUserId) {
        throw new NotFoundException({ code: "not_found", message: "Callback not found" });
      }
      if (!unlock.ownerRespondedAt) {
        throw new ConflictException({ code: "no_call_claimed", message: "No call has been claimed yet" });
      }
      unlock.tenantConfirmedAt = unlock.tenantConfirmedAt ?? Date.now();
      return {
        callback_id: callbackId,
        tenant_confirmed_at: new Date(unlock.tenantConfirmedAt).toISOString()
      };
    }

    const unlock = await this.database.query<{ id: string; owner_responded_at: string | null }>(
      `SELECT id::text, owner_responded_at::text FROM contact_unlocks
       WHERE id = $1::uuid AND tenant_user_id = $2::uuid LIMIT 1`,
      [callbackId, tenantUserId]
    );
    if (!unlock.rows.length) {
      throw new NotFoundException({ code: "not_found", message: "Callback not found" });
    }
    if (!unlock.rows[0].owner_responded_at) {
      throw new ConflictException({ code: "no_call_claimed", message: "No call has been claimed yet" });
    }
    await this.database.query(
      `UPDATE leads SET tenant_confirmed_at = COALESCE(tenant_confirmed_at, now()), updated_at = now()
       WHERE contact_unlock_id = $1::uuid`,
      [callbackId]
    );
    await this.database.query(
      `INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
       VALUES ($1::uuid, 'tenant', 'tenant_confirmed', '{}'::jsonb)`,
      [callbackId]
    );
    const stamped = await this.database.query<{ tenant_confirmed_at: string }>(
      `SELECT tenant_confirmed_at::text FROM leads WHERE contact_unlock_id = $1::uuid LIMIT 1`,
      [callbackId]
    );
    return {
      callback_id: callbackId,
      tenant_confirmed_at: stamped.rows[0]?.tenant_confirmed_at ?? new Date().toISOString()
    };
  }

  async disputeCallback(tenantUserId: string, callbackId: string) {
    this.ensureCallbackMode();
    if (!this.database.isEnabled()) {
      return this.disputeCallbackInMemory(tenantUserId, callbackId);
    }
    return this.disputeCallbackDb(tenantUserId, callbackId);
  }

  private disputeCallbackInMemory(tenantUserId: string, callbackId: string) {
    const unlock = this.appState.unlocks.get(callbackId);
    if (!unlock || unlock.tenantUserId !== tenantUserId) {
      throw new NotFoundException({ code: "not_found", message: "Callback not found" });
    }
    if (!unlock.ownerRespondedAt) {
      throw new ConflictException({ code: "no_call_claimed", message: "No call has been claimed yet" });
    }
    if (Date.now() - unlock.ownerRespondedAt > DISPUTE_WINDOW_MS) {
      throw new ConflictException({ code: "dispute_window_closed", message: "Dispute window has closed" });
    }
    if (unlock.unlockStatus !== "active") {
      throw new ConflictException({ code: "already_refunded", message: "Callback already refunded" });
    }
    this.appState.addWalletTxn({
      userId: tenantUserId,
      type: "refund_lead_dispute",
      creditsDelta: 1,
      referenceId: unlock.id
    });
    unlock.unlockStatus = "refunded";
    unlock.disputedAt = Date.now();
    logTelemetry("callback.disputed", { mode: "in_memory", unlock_id: unlock.id });
    return {
      callback_id: callbackId,
      refunded: true,
      credits_remaining: this.appState.getWalletBalance(tenantUserId)
    };
  }

  private async disputeCallbackDb(tenantUserId: string, callbackId: string) {
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");
      const unlockResult = await client.query<{
        id: string;
        listing_id: string;
        unlock_status: string;
        owner_responded_at: string | null;
        window_closed: boolean;
      }>(
        `SELECT id::text, listing_id::text, unlock_status::text, owner_responded_at::text,
                (owner_responded_at IS NOT NULL AND owner_responded_at < now() - interval '72 hours') AS window_closed
         FROM contact_unlocks
         WHERE id = $1::uuid AND tenant_user_id = $2::uuid
         FOR UPDATE`,
        [callbackId, tenantUserId]
      );
      const unlock = unlockResult.rows[0];
      if (!unlock) {
        throw new NotFoundException({ code: "not_found", message: "Callback not found" });
      }
      if (!unlock.owner_responded_at) {
        throw new ConflictException({ code: "no_call_claimed", message: "No call has been claimed yet" });
      }
      if (unlock.window_closed) {
        throw new ConflictException({ code: "dispute_window_closed", message: "Dispute window has closed" });
      }
      if (unlock.unlock_status !== "active") {
        throw new ConflictException({ code: "already_refunded", message: "Callback already refunded" });
      }

      const refundTxn = await client.query<{ id: string }>(
        `INSERT INTO wallet_transactions(
           wallet_user_id, txn_type, credits_delta, reference_type, reference_id, metadata)
         VALUES ($1::uuid, 'refund_lead_dispute', 1, 'contact_unlock', $2::uuid, '{}'::jsonb)
         RETURNING id::text`,
        [tenantUserId, callbackId]
      );
      await client.query(
        `UPDATE wallets SET balance_credits = balance_credits + 1, updated_at = now()
         WHERE user_id = $1::uuid`,
        [tenantUserId]
      );
      await client.query(
        `UPDATE contact_unlocks
         SET unlock_status = 'refunded', refund_txn_id = $2::uuid, updated_at = now()
         WHERE id = $1::uuid`,
        [callbackId, refundTxn.rows[0].id]
      );
      const lead = await client.query<{ id: string; called_by: string | null }>(
        `UPDATE leads SET disputed_at = now(), updated_at = now()
         WHERE contact_unlock_id = $1::uuid
         RETURNING id::text, called_by`,
        [callbackId]
      );
      if (lead.rows[0]?.called_by === "owner") {
        // Serial disputers are handled manually via admin at current scale.
        await client.query(
          `INSERT INTO fraud_flags (listing_id, flag_type, severity, reporter_user_id, details)
           VALUES ($1::uuid, 'callback_dispute', 'medium', $2::uuid, $3::jsonb)`,
          [unlock.listing_id, tenantUserId, JSON.stringify({ lead_id: lead.rows[0].id, callback_id: callbackId })]
        );
      }
      await client.query(
        `INSERT INTO contact_events(contact_unlock_id, actor_role, event_type, metadata)
         VALUES ($1::uuid, 'tenant', 'dispute_refund', '{}'::jsonb)`,
        [callbackId]
      );
      const balance = await client.query<{ balance_credits: number }>(
        `SELECT balance_credits FROM wallets WHERE user_id = $1::uuid LIMIT 1`,
        [tenantUserId]
      );
      await client.query("COMMIT");
      logTelemetry("callback.disputed", { mode: "db", unlock_id: callbackId });
      return {
        callback_id: callbackId,
        refunded: true,
        credits_remaining: Number(balance.rows[0]?.balance_credits ?? 0)
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
```

(The in-memory unlock records store `ownerRespondedAt` as epoch ms — set by `markOwnerRespondedInMemory` at line ~630.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @cribliv/api test -- tenant-callbacks && pnpm --filter @cribliv/api test -- phase1`
Expected: PASS all.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/contacts apps/api/src/common/app-state.service.ts apps/api/test/tenant-callbacks.integration.test.ts
git commit -m "feat(api): tenant callbacks — status list, confirm, 72h dispute with refund + fraud flag

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Admin rescue queue + team-called

**Files:**
- Create: `apps/api/src/modules/leads/admin-leads.controller.ts`
- Modify: `apps/api/src/modules/leads/leads.service.ts` (methods `getRescueQueue`, `teamMarkCalled`)
- Modify: `apps/api/src/modules/leads/leads.module.ts` (register controller)
- Test: `apps/api/test/admin-rescue-queue.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 2/3/5/7 (`markLeadCalled` helper).
- Produces: `GET /v1/admin/leads/rescue-queue` (role `admin`) → `{ items: [{ lead_id, listing_id, listing_title, owner_user_id, owner_name, owner_phone, tenant_name, tenant_phone, access_state, call_deadline_at, created_at }] }` — uncalled leads with < 6h to deadline. `POST /v1/admin/leads/:id/team-called` → `{ lead_id, called_at, called_by: "team" }`. The queue doubles as the unresponsive-owner report (spec §3.3).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/admin-rescue-queue.integration.test.ts
// DB-gated. Setup copied concretely from lead-access-state.integration.test.ts
// (owner + listing + tenants; leads la-rq-1..3 so the third is locked), plus an
// admin login: loginWithOtp with a random phone, then
//   UPDATE users SET role = 'admin' WHERE phone_e164 = $1
// and re-login for adminToken.

describe.runIf(!!TEST_DB)("admin rescue queue (DB)", () => {
  it("lists uncalled leads inside the 6h window, with full contact info", async () => {
    // Push the locked lead into the rescue window:
    await db.query(
      `UPDATE leads SET call_deadline_at = now() + interval '5 hours' WHERE id = $1::uuid`,
      [lockedLeadId]);
    // Keep a free lead outside the window:
    await db.query(
      `UPDATE leads SET call_deadline_at = now() + interval '20 hours' WHERE id = $1::uuid`,
      [freeLeadId]);

    const res = await http(app)
      .get("/v1/admin/leads/rescue-queue")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const ids = res.body.data.items.map((i: { lead_id: string }) => i.lead_id);
    expect(ids).toContain(lockedLeadId);
    expect(ids).not.toContain(freeLeadId);
    const item = res.body.data.items.find((i: { lead_id: string }) => i.lead_id === lockedLeadId);
    expect(item.tenant_phone).toMatch(/^\+91/);
    expect(item.owner_phone).toMatch(/^\+91/);
  });

  it("team-called claims the call and stops the refund clock", async () => {
    const res = await http(app)
      .post(`/v1/admin/leads/${lockedLeadId}/team-called`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(201);
    expect(res.body.data.called_by).toBe("team");

    const lead = await db.query(
      `SELECT called_by, contact_unlock_id FROM leads WHERE id = $1::uuid`, [lockedLeadId]);
    expect(lead.rows[0].called_by).toBe("team");
    const unlock = await db.query(
      `SELECT owner_response_status FROM contact_unlocks WHERE id = $1::uuid`,
      [lead.rows[0].contact_unlock_id]);
    expect(unlock.rows[0].owner_response_status).toBe("responded");

    // second team-called on the same lead → 409
    await http(app)
      .post(`/v1/admin/leads/${lockedLeadId}/team-called`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(409);
  });

  it("403s non-admin users", async () => {
    await http(app)
      .get("/v1/admin/leads/rescue-queue")
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- admin-rescue-queue`
Expected: FAIL — 404.

- [ ] **Step 3: Implement**

`apps/api/src/modules/leads/leads.service.ts` — add:

```ts
  /** Leads at risk of breaking the 24h promise: uncalled, < 6h to deadline. */
  async getRescueQueue() {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({ code: "feature_disabled", message: "Callbacks are not enabled" });
    }
    if (!this.database.isEnabled()) {
      return { items: [] };
    }
    const result = await this.database.query(
      `SELECT ld.id::text AS lead_id, ld.listing_id::text,
              COALESCE(NULLIF(l.title_en, ''), 'Listing') AS listing_title,
              ld.owner_user_id::text,
              COALESCE(o.full_name, 'Owner') AS owner_name, o.phone_e164 AS owner_phone,
              COALESCE(t.full_name, 'Tenant') AS tenant_name, t.phone_e164 AS tenant_phone,
              ld.access_state, ld.call_deadline_at::text, ld.created_at::text
       FROM leads ld
       JOIN listings l ON l.id = ld.listing_id
       JOIN users o ON o.id = ld.owner_user_id
       JOIN users t ON t.id = ld.tenant_user_id
       WHERE ld.called_at IS NULL
         AND ld.call_deadline_at IS NOT NULL
         AND ld.call_deadline_at > now()
         AND ld.call_deadline_at <= now() + interval '6 hours'
         AND ld.access_state <> 'expired'
       ORDER BY ld.call_deadline_at ASC
       LIMIT 100`
    );
    return { items: result.rows };
  }

  async teamMarkCalled(leadId: string) {
    if (!readFeatureFlags().ff_callback_leads) {
      throw new ForbiddenException({ code: "feature_disabled", message: "Callbacks are not enabled" });
    }
    if (!this.database.isEnabled()) {
      throw new BadRequestException({ code: "db_unavailable", message: "Database unavailable" });
    }
    const client = await this.database.getClient();
    try {
      await client.query("BEGIN");
      const leadResult = await client.query<{
        id: string;
        contact_unlock_id: string | null;
        called_at: string | null;
        status: string;
      }>(
        `SELECT id::text, contact_unlock_id::text, called_at::text, status::text
         FROM leads WHERE id = $1::uuid FOR UPDATE`,
        [leadId]
      );
      const lead = leadResult.rows[0];
      if (!lead) {
        throw new NotFoundException({ code: "not_found", message: "Lead not found" });
      }
      if (lead.called_at) {
        throw new ConflictException({ code: "already_called", message: "Call already claimed" });
      }
      await this.markLeadCalled(client, leadId, lead.contact_unlock_id, "team");
      await client.query(
        `INSERT INTO lead_events (lead_id, to_status, notes)
         VALUES ($1::uuid, $2::lead_status, 'team_called')`,
        [leadId, lead.status]
      );
      const stamped = await client.query<{ called_at: string }>(
        `SELECT called_at::text FROM leads WHERE id = $1::uuid`,
        [leadId]
      );
      await client.query("COMMIT");
      logTelemetry("lead.team_called", { lead_id: leadId });
      return { lead_id: leadId, called_at: stamped.rows[0].called_at, called_by: "team" as const };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
```

Create `apps/api/src/modules/leads/admin-leads.controller.ts`:

```ts
import { Controller, Get, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { LeadsService } from "./leads.service";
import { ok } from "../../common/response";
import { AuthGuard } from "../../common/auth.guard";
import { RolesGuard } from "../../common/roles.guard";
import { Roles } from "../../common/roles.decorator";

/**
 * Ops tooling for the callback guarantee: the rescue queue lists leads about
 * to breach the 24h promise so the Cribliv team can call the tenant themselves
 * (spec §3.3). It doubles as the unresponsive-owner report.
 */
@Controller("admin/leads")
@UseGuards(AuthGuard, RolesGuard)
@Roles("admin")
export class AdminLeadsController {
  constructor(@Inject(LeadsService) private readonly leadsService: LeadsService) {}

  @Get("rescue-queue")
  async rescueQueue() {
    return ok(await this.leadsService.getRescueQueue());
  }

  @Post(":id/team-called")
  async teamCalled(@Param("id") leadId: string) {
    return ok(await this.leadsService.teamMarkCalled(leadId));
  }
}
```

`apps/api/src/modules/leads/leads.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { LeadsController } from "./leads.controller";
import { AdminLeadsController } from "./admin-leads.controller";
import { LeadsService } from "./leads.service";

@Module({
  controllers: [LeadsController, AdminLeadsController],
  providers: [LeadsService],
  exports: [LeadsService]
})
export class LeadsModule {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- admin-rescue-queue`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/leads apps/api/test/admin-rescue-queue.integration.test.ts
git commit -m "feat(api): admin rescue queue + team-called — ops backstop for the 24h promise

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: Worker — lead expiry on refund + 6h reminder sweep

**Files:**
- Create: `apps/api/src/worker/callback-sweeps.ts` (move `runRefundSweepDb` + `REFUND_BATCH_SIZE` out of `worker.ts` verbatim, then extend; add `runLeadReminderSweepDb`)
- Modify: `apps/api/src/worker/worker.ts` (remove moved code at :294-394, import from the new module, register the reminder interval in `run()` near :1110-1145)
- Test: `apps/api/test/worker-callback-sweeps.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 2/3/5; existing `outbound_events` WhatsApp queue pattern (`worker.ts:runLeadNudgeSweep` :843-905 is the template: insert `notification.whatsapp.<template>` events, dedupe via a `lead_events.notes` marker).
- Produces: `runRefundSweepDb(pool): Promise<number>` — unchanged signature/behavior PLUS: refunded unlocks expire their still-locked lead (`access_state 'locked' → 'expired'`). New `runLeadReminderSweepDb(pool): Promise<number>` — queues one `notification.whatsapp.lead_expiring` event per uncalled lead entering the last 6h, marker `expiry_reminder_sent`. Both exported for tests (importing `callback-sweeps.ts` must NOT start the worker loop — that's why they move out of `worker.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/worker-callback-sweeps.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { runRefundSweepDb, runLeadReminderSweepDb } from "../src/worker/callback-sweeps";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.runIf(!!TEST_DB)("callback worker sweeps (DB)", () => {
  let pool: Pool;
  let ownerId: string;
  let tenantId: string;
  let listingId: string;

  async function seedUnlockAndLead(opts: {
    deadline: string; // SQL interval expression relative to now()
    accessState: "free" | "locked";
    responded?: boolean;
  }) {
    const idem = `sweep-${Math.random().toString(36).slice(2)}`;
    const txn = await pool.query<{ id: string }>(
      `INSERT INTO wallet_transactions (wallet_user_id, txn_type, credits_delta, reference_type, idempotency_key, metadata)
       VALUES ($1::uuid, 'debit_contact_unlock', -1, 'listing', $2, '{}'::jsonb) RETURNING id::text`,
      [tenantId, idem]
    );
    const unlock = await pool.query<{ id: string }>(
      `INSERT INTO contact_unlocks (tenant_user_id, listing_id, wallet_txn_id, idempotency_key,
                                    response_deadline_at, owner_response_status)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + ${opts.deadline},
               ${opts.responded ? "'responded'" : "'pending'"})
       RETURNING id::text`,
      [tenantId, listingId, txn.rows[0].id, idem]
    );
    const lead = await pool.query<{ id: string }>(
      `INSERT INTO leads (listing_id, owner_user_id, tenant_user_id, contact_unlock_id,
                          status, access_state, call_deadline_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'new', $5, now() + ${opts.deadline})
       ON CONFLICT (listing_id, tenant_user_id) DO UPDATE SET
         contact_unlock_id = EXCLUDED.contact_unlock_id,
         access_state = EXCLUDED.access_state,
         call_deadline_at = EXCLUDED.call_deadline_at,
         called_at = NULL, called_by = NULL
       RETURNING id::text`,
      [listingId, ownerId, tenantId, unlock.rows[0].id, opts.accessState]
    );
    return { unlockId: unlock.rows[0].id, leadId: lead.rows[0].id };
  }

  beforeAll(async () => {
    process.env.FF_CALLBACK_LEADS = "true";
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
       VALUES ($1::uuid, 'flat_house', 'Sweep Test Flat', 9000, 'active') RETURNING id::text`,
      [ownerId]
    );
    listingId = listing.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    await pool.query(`DELETE FROM outbound_events WHERE aggregate_id IN (SELECT id::text FROM leads WHERE listing_id = $1::uuid)`, [listingId]);
    await pool.query(`DELETE FROM contact_events WHERE contact_unlock_id IN (SELECT id FROM contact_unlocks WHERE listing_id = $1::uuid)`, [listingId]);
    await pool.query(`DELETE FROM lead_events WHERE lead_id IN (SELECT id FROM leads WHERE listing_id = $1::uuid)`, [listingId]);
    await pool.query(`DELETE FROM leads WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`UPDATE contact_unlocks SET refund_txn_id = NULL WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM contact_unlocks WHERE listing_id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM wallet_transactions WHERE wallet_user_id = $1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM wallets WHERE user_id = $1::uuid`, [tenantId]);
    await pool.query(`DELETE FROM listings WHERE id = $1::uuid`, [listingId]);
    await pool.query(`DELETE FROM users WHERE id IN ($1::uuid, $2::uuid)`, [ownerId, tenantId]);
    await pool.end();
    delete process.env.FF_CALLBACK_LEADS;
  }, 60_000);

  it("refund sweep refunds overdue unlock and expires the locked lead", async () => {
    const { unlockId, leadId } = await seedUnlockAndLead({
      deadline: "interval '-1 hour'",
      accessState: "locked"
    });
    const refunded = await runRefundSweepDb(pool);
    expect(refunded).toBeGreaterThanOrEqual(1);

    const unlock = await pool.query(`SELECT unlock_status FROM contact_unlocks WHERE id = $1::uuid`, [unlockId]);
    expect(unlock.rows[0].unlock_status).toBe("refunded");
    const lead = await pool.query(`SELECT access_state FROM leads WHERE id = $1::uuid`, [leadId]);
    expect(lead.rows[0].access_state).toBe("expired");
  });

  it("does not refund a responded unlock", async () => {
    const { unlockId } = await seedUnlockAndLead({
      deadline: "interval '-1 hour'",
      accessState: "free",
      responded: true
    });
    await runRefundSweepDb(pool);
    const unlock = await pool.query(`SELECT unlock_status FROM contact_unlocks WHERE id = $1::uuid`, [unlockId]);
    expect(unlock.rows[0].unlock_status).toBe("active");
  });

  it("reminder sweep queues one WhatsApp event per lead, once", async () => {
    const { leadId } = await seedUnlockAndLead({
      deadline: "interval '5 hours'",
      accessState: "locked"
    });
    const first = await runLeadReminderSweepDb(pool);
    expect(first).toBeGreaterThanOrEqual(1);
    const second = await runLeadReminderSweepDb(pool);
    const events = await pool.query(
      `SELECT count(*)::int AS n FROM outbound_events
       WHERE event_type = 'notification.whatsapp.lead_expiring' AND aggregate_id = $1`,
      [leadId]
    );
    expect(events.rows[0].n).toBe(1);
  });
});
```

(Note: the two refund-sweep tests interact through the shared `(listing, tenant)` unique key — `seedUnlockAndLead` reuses/updates the same lead row via ON CONFLICT. Run assertions before the next seed call, as written.)

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- worker-callback-sweeps`
Expected: FAIL — module `../src/worker/callback-sweeps` does not exist.

- [ ] **Step 3: Implement**

Create `apps/api/src/worker/callback-sweeps.ts`:
1. Cut `runRefundSweepDb` (worker.ts:294-394) and the `REFUND_BATCH_SIZE` constant (defined near the top of worker.ts — move its line verbatim) into this file; add `import { Pool } from "pg";` and `export` both.
2. Inside the refunded branch (right after the `contact_events` 'refund_issued' insert), add:

```ts
          // A lead the owner never paid to see dies with the refund; free or
          // already-unlocked leads keep their access (spec §3.5).
          await client.query(
            `UPDATE leads SET access_state = 'expired', updated_at = now()
             WHERE contact_unlock_id = $1::uuid AND access_state = 'locked'`,
            [unlock.id]
          );
```

3. Add the reminder sweep:

```ts
import { readFeatureFlags } from "../config/feature-flags";

const REMINDER_BATCH_SIZE = 50;

/**
 * 6h-warning for the callback guarantee: owners with an uncalled lead entering
 * the final window get a WhatsApp nudge via the outbound_events dispatcher.
 * Deduped by a lead_events marker, mirroring runLeadNudgeSweep.
 */
export async function runLeadReminderSweepDb(pool: Pool): Promise<number> {
  if (!readFeatureFlags().ff_callback_leads) return 0;

  const due = await pool.query<{
    lead_id: string;
    listing_title: string;
    status: string;
    owner_phone: string;
    whatsapp_opt_in: boolean;
  }>(
    `SELECT ld.id::text AS lead_id,
            COALESCE(NULLIF(l.title_en, ''), 'your listing') AS listing_title,
            ld.status::text AS status,
            u.phone_e164 AS owner_phone,
            u.whatsapp_opt_in
     FROM leads ld
     JOIN users u ON u.id = ld.owner_user_id
     JOIN listings l ON l.id = ld.listing_id
     WHERE ld.called_at IS NULL
       AND ld.call_deadline_at IS NOT NULL
       AND ld.call_deadline_at > now()
       AND ld.call_deadline_at <= now() + interval '6 hours'
       AND ld.access_state <> 'expired'
       AND NOT EXISTS (
         SELECT 1 FROM lead_events le
         WHERE le.lead_id = ld.id AND le.notes = 'expiry_reminder_sent'
       )
     LIMIT $1`,
    [REMINDER_BATCH_SIZE]
  );
  if (!due.rowCount) return 0;

  const client = await pool.connect();
  let reminded = 0;
  try {
    for (const lead of due.rows) {
      if (!lead.whatsapp_opt_in || !lead.owner_phone) continue;
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO outbound_events (event_type, aggregate_type, aggregate_id, payload, next_attempt_at)
         VALUES ('notification.whatsapp.lead_expiring', 'lead', $1::uuid, $2::jsonb, now())`,
        [
          lead.lead_id,
          JSON.stringify({
            recipient_phone: lead.owner_phone,
            template_name: "lead_expiring",
            language_code: "hi",
            body_params: [lead.listing_title]
          })
        ]
      );
      await client.query(
        `INSERT INTO lead_events (lead_id, to_status, notes)
         VALUES ($1::uuid, $2::lead_status, 'expiry_reminder_sent')`,
        [lead.lead_id, lead.status]
      );
      await client.query("COMMIT");
      reminded += 1;
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return reminded;
}
```

In `worker.ts`:
1. Delete the moved code; add `import { runRefundSweepDb, runLeadReminderSweepDb } from "./callback-sweeps";`
2. In `run()`, after the refund-sweep `setInterval` block (line ~1142), add:

```ts
  const LEAD_REMINDER_SWEEP_MS = 10 * 60 * 1000;
  if (pool) {
    setInterval(async () => {
      try {
        const remindedCount = await runLeadReminderSweepDb(pool);
        console.log(
          JSON.stringify({
            job: "lead_expiry_reminders",
            reminded_count: remindedCount,
            timestamp: new Date().toISOString()
          })
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            job: "lead_expiry_reminders",
            error: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString()
          })
        );
      }
    }, LEAD_REMINDER_SWEEP_MS);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test -- worker-callback-sweeps && pnpm --filter @cribliv/api build`
Expected: PASS (3 tests) and the API builds (worker refactor compiles).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/worker/callback-sweeps.ts apps/api/src/worker/worker.ts apps/api/test/worker-callback-sweeps.integration.test.ts
git commit -m "feat(worker): lead expiry on refund + 6h WhatsApp reminder sweep

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Web — owner lead cards (blur, timer, unlock, call) + buy panel

**Files:**
- Modify: `apps/web/lib/owner-api.ts` (`LeadVm` + `mapLeadRow` :731-743, new wrappers)
- Modify: `apps/web/components/owner/lead-card.tsx`
- Modify: `apps/web/components/owner/leads-pipeline.tsx` (thread one new prop at the `<LeadCard` site, line ~237)
- Modify: `apps/web/components/owner/dashboard-client.tsx` (pass `accessToken` to `LeadsPipeline`)
- Create: `apps/web/components/owner/lead-credits-panel.tsx`

**Interfaces:**
- Consumes: Task 6 (`POST owner/leads/:id/unlock`), Task 7 (`POST owner/leads/:id/call-click`), Task 1 (`leads_5` plan), `ff_callback_leads` via `useFlag`.
- Produces: `LeadVm` gains `accessState: "free" | "locked" | "unlocked" | "expired"`, `callDeadlineAt: string | null`, `calledAt: string | null`, `tenantPhone: string | null`. New `owner-api.ts` exports:
  - `unlockLead(accessToken, leadId, idempotencyKey)` → `{ leadId, accessState, tenantPhone, tenantName, creditsRemaining }`
  - `recordLeadCallClick(accessToken, leadId)` → `{ leadId, calledAt, tel }`
  - `LeadCard` gains optional prop `accessToken?: string | null` and handles unlock/call/buy-credits internally (no other prop threading).

- [ ] **Step 1: Extend owner-api.ts**

In `LeadVm` (find `interface LeadVm` in the same file, near `mapLeadRow`) add:

```ts
  accessState: "free" | "locked" | "unlocked" | "expired";
  callDeadlineAt: string | null;
  calledAt: string | null;
  tenantPhone: string | null;
```

In `mapLeadRow` add before the closing brace:

```ts
    accessState:
      (row.access_state as "free" | "locked" | "unlocked" | "expired") ?? "locked",
    callDeadlineAt: row.call_deadline_at ? String(row.call_deadline_at) : null,
    calledAt: row.called_at ? String(row.called_at) : null,
    tenantPhone: row.tenant_phone ? String(row.tenant_phone) : null
```

Add wrappers (below `updateLeadStatus`):

```ts
export async function unlockLead(
  accessToken: string,
  leadId: string,
  idempotencyKey: string
): Promise<{
  leadId: string;
  accessState: string;
  tenantPhone: string | null;
  tenantName: string;
  creditsRemaining: number;
}> {
  const result = await fetchApi<{
    lead_id: string;
    access_state: string;
    tenant_phone: string | null;
    tenant_name: string;
    credits_remaining: number;
  }>(`/owner/leads/${leadId}/unlock`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Idempotency-Key": idempotencyKey }
  });
  return {
    leadId: result.lead_id,
    accessState: result.access_state,
    tenantPhone: result.tenant_phone,
    tenantName: result.tenant_name,
    creditsRemaining: result.credits_remaining
  };
}

export async function recordLeadCallClick(
  accessToken: string,
  leadId: string
): Promise<{ leadId: string; calledAt: string; tel: string }> {
  const result = await fetchApi<{ lead_id: string; called_at: string; tel: string }>(
    `/owner/leads/${leadId}/call-click`,
    { method: "POST", headers: authHeaders(accessToken) }
  );
  return { leadId: result.lead_id, calledAt: result.called_at, tel: result.tel };
}
```

- [ ] **Step 2: Create the buy panel**

```tsx
// apps/web/components/owner/lead-credits-panel.tsx
"use client";

import { useState } from "react";
import { fetchApi } from "../../lib/api";

interface LeadCreditsPanelProps {
  accessToken: string;
  onPurchased?: () => void;
}

interface PurchaseIntentResponse {
  order_id: string;
  amount_paise: number;
  credits_to_grant: number;
  provider_payload?: { deep_link?: string };
}

function createClientKey() {
  return typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`;
}

/**
 * Owner-side lead-credit purchase: same purchase-intent + UPI deep-link + poll
 * flow the tenant unlock panel uses, pinned to the leads_5 pack.
 */
export function LeadCreditsPanel({ accessToken, onPurchased }: LeadCreditsPanelProps) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => createClientKey());
  const [intent, setIntent] = useState<PurchaseIntentResponse | null>(null);
  const [state, setState] = useState<"idle" | "creating" | "pending" | "checking" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(0);

  async function readBalance() {
    const wallet = await fetchApi<{ balance_credits: number }>("/wallet", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return wallet.balance_credits;
  }

  async function startPurchase() {
    setState("creating");
    setError(null);
    try {
      setBaseline(await readBalance());
      const res = await fetchApi<PurchaseIntentResponse>("/wallet/purchase-intents", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ plan_id: "leads_5", provider: "upi" })
      });
      setIntent(res);
      setState("pending");
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Unable to start purchase");
    }
  }

  async function checkStatus() {
    setState("checking");
    try {
      const balance = await readBalance();
      if (balance > baseline) {
        setState("done");
        setIdempotencyKey(createClientKey());
        onPurchased?.();
      } else {
        setState("pending");
      }
    } catch (err) {
      setState("failed");
      setError(err instanceof Error ? err.message : "Unable to refresh balance");
    }
  }

  return (
    <div className="alert alert--warning" data-testid="lead-credits-panel" style={{ marginTop: "var(--space-3)" }}>
      <p style={{ fontWeight: 600 }}>Not enough lead credits</p>
      <p className="caption" style={{ color: "var(--text-secondary)" }}>
        Buy 5 lead credits for ₹299 to unlock tenant contacts instantly.
      </p>
      <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
        <button
          className="btn btn--primary btn--sm"
          onClick={startPurchase}
          disabled={state === "creating" || state === "checking"}
        >
          {state === "creating" ? "Creating…" : "Buy 5 credits — ₹299"}
        </button>
        <button
          className="btn btn--secondary btn--sm"
          onClick={checkStatus}
          disabled={state === "idle" || state === "creating" || state === "checking"}
        >
          {state === "checking" ? "Checking…" : "I've paid — refresh"}
        </button>
      </div>
      {intent?.provider_payload?.deep_link ? (
        <a
          href={intent.provider_payload.deep_link}
          target="_blank"
          rel="noreferrer"
          className="btn btn--secondary btn--sm"
          style={{ display: "inline-flex", marginTop: "var(--space-2)", textDecoration: "none" }}
        >
          Open UPI App
        </a>
      ) : null}
      {state === "done" ? (
        <p className="caption" style={{ marginTop: "var(--space-2)" }}>
          Credits added — unlock the lead now.
        </p>
      ) : null}
      {error ? (
        <p className="alert alert--error" style={{ marginTop: "var(--space-2)" }}>{error}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Extend LeadCard**

In `apps/web/components/owner/lead-card.tsx`:
- Extend props: `accessToken?: string | null;`
- Add imports: `useEffect` from react; `unlockLead, recordLeadCallClick` from `../../lib/owner-api`; `LeadCreditsPanel` from `./lead-credits-panel`; `useFlag` from `../../lib/feature-flags`; `trackEvent` from `../../lib/analytics`.
- Inside the component add state + handlers:

```tsx
  const callbackMode = useFlag("ff_callback_leads");
  const [phone, setPhone] = useState<string | null>(lead.tenantPhone);
  const [accessState, setAccessState] = useState(lead.accessState);
  const [unlockKey] = useState(() =>
    typeof crypto !== "undefined" ? crypto.randomUUID() : `${lead.id}-unlock`
  );
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [needsCredits, setNeedsCredits] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    if (!callbackMode || !lead.callDeadlineAt || lead.calledAt) {
      setRemainingMs(null);
      return;
    }
    const tick = () => setRemainingMs(new Date(lead.callDeadlineAt!).getTime() - Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [callbackMode, lead.callDeadlineAt, lead.calledAt]);

  async function handleUnlock() {
    if (!accessToken) return;
    setUnlockBusy(true);
    setCardError(null);
    try {
      const res = await unlockLead(accessToken, lead.id, unlockKey);
      setPhone(res.tenantPhone);
      setAccessState("unlocked");
      setNeedsCredits(false);
      trackEvent("lead_unlocked", { lead_id: lead.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to unlock lead";
      if (message.toLowerCase().includes("insufficient")) setNeedsCredits(true);
      else setCardError(message);
    } finally {
      setUnlockBusy(false);
    }
  }

  async function handleCall() {
    if (!accessToken) return;
    try {
      const res = await recordLeadCallClick(accessToken, lead.id);
      trackEvent("call_clicked", { lead_id: lead.id });
      window.location.href = res.tel;
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Unable to start call");
    }
  }

  function formatRemaining(ms: number) {
    if (ms <= 0) return "expired";
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m left`;
  }
```

- In the JSX (below the existing tenant name / masked phone block), when `callbackMode` render the monetization strip; keep everything else untouched:

```tsx
      {callbackMode ? (
        <div style={{ marginTop: "var(--space-2)" }} data-testid="lead-monetization">
          {accessState === "free" ? (
            <span className="caption" style={{ fontWeight: 700, color: "#166534" }}>FREE LEAD</span>
          ) : null}
          {remainingMs !== null && accessState !== "expired" ? (
            <span className="caption" style={{ marginLeft: "var(--space-2)", color: remainingMs < 6 * 3_600_000 ? "#b91c1c" : "var(--text-secondary)" }}>
              ⏱ {formatRemaining(remainingMs)}
            </span>
          ) : null}

          {accessState === "locked" ? (
            <div style={{ marginTop: "var(--space-2)" }}>
              <div style={{ filter: "blur(6px)", userSelect: "none" }} aria-hidden="true">
                <p>{lead.tenantName} · {lead.tenantPhoneMasked ?? "XXXXXXXX"}</p>
              </div>
              <button
                className="btn btn--primary btn--sm"
                onClick={handleUnlock}
                disabled={unlockBusy || !accessToken}
                style={{ marginTop: "var(--space-1)" }}
              >
                {unlockBusy ? "Unlocking…" : "Unlock for 1 credit"}
              </button>
            </div>
          ) : null}

          {accessState === "free" || accessState === "unlocked" ? (
            <div style={{ marginTop: "var(--space-2)" }}>
              {phone ? <p style={{ fontWeight: 700 }}>{phone}</p> : null}
              <button className="btn btn--primary btn--sm" onClick={handleCall} disabled={!accessToken}>
                {lead.calledAt ? "Call again" : "Call now"}
              </button>
              {!lead.calledAt ? (
                <p className="caption" style={{ color: "var(--text-tertiary)", marginTop: "var(--space-1)" }}>
                  Call before the timer ends or the tenant is refunded.
                </p>
              ) : null}
            </div>
          ) : null}

          {accessState === "expired" ? (
            <p className="caption" style={{ color: "var(--text-tertiary)", marginTop: "var(--space-2)" }}>
              Expired — respond faster next time.
            </p>
          ) : null}

          {needsCredits && accessToken ? (
            <LeadCreditsPanel accessToken={accessToken} onPurchased={handleUnlock} />
          ) : null}
          {cardError ? (
            <p className="alert alert--error" style={{ marginTop: "var(--space-2)" }}>{cardError}</p>
          ) : null}
        </div>
      ) : null}
```

- When `callbackMode && accessState === "locked"`, also wrap the card's existing tenant-identity lines (name + masked phone rendered by the current markup) so they don't duplicate: leave them — the blur block above is additive and the existing masked phone stays visible; only ensure the card never prints `lead.tenantPhone` outside the strip.

- [ ] **Step 4: Thread accessToken**

In `apps/web/components/owner/leads-pipeline.tsx`: add `accessToken?: string | null;` to the component's props interface and pass `accessToken={accessToken}` at the `<LeadCard` call site (line ~237). In `apps/web/components/owner/dashboard-client.tsx`: pass `accessToken={accessToken}` where `<LeadsPipeline` is rendered (the component already holds `accessToken` state for `fetchOwnerLeads` at line ~168).

- [ ] **Step 5: Verify**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web lint`
Expected: clean. Manual check happens in Task 14.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/owner-api.ts apps/web/components/owner/lead-card.tsx apps/web/components/owner/lead-credits-panel.tsx apps/web/components/owner/leads-pipeline.tsx apps/web/components/owner/dashboard-client.tsx
git commit -m "feat(web): owner lead cards — blur, countdown, 1-credit unlock, call-now, buy panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Web — callback request panel (tenant side pivot)

**Files:**
- Modify: `apps/web/components/unlock-contact-panel.tsx`

**Interfaces:**
- Consumes: Task 4 response shape, `useFlag("ff_callback_leads")`.
- Produces: flag ON → button reads "Request Callback", promise copy, success shows a status timeline (never a phone number); flag OFF → identical to today. Task 14's E2E asserts the copy below verbatim.

- [ ] **Step 1: Implement**

In `apps/web/components/unlock-contact-panel.tsx`:

1. Import the flag hook: `import { useFlag } from "../lib/feature-flags";` and inside the component add `const callbackMode = useFlag("ff_callback_leads");`
2. Widen the response type (replace `UnlockResponse` interface):

```ts
interface UnlockResponse {
  unlock_id: string;
  owner_contact?: {
    phone_e164: string;
    whatsapp_available: boolean;
  };
  callback?: {
    status: "awaiting_call";
    call_deadline_at: string;
  };
  credits_remaining: number;
  response_deadline_at: string;
}
```

3. Replace the intro `<p>` (line ~423-428 content) with:

```tsx
      <p className="body-sm" style={{ color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
        {callbackMode
          ? "Use 1 credit — you'll get a call for this property within 24 hours. If nobody calls, your credit comes back automatically. Guaranteed."
          : "Unlock contact for 1 credit. Auto-refund if no response in 12 hours."}
      </p>
```

4. Replace the primary button label (line ~459):

```tsx
          {loading
            ? "Processing..."
            : sessionStatus === "loading"
              ? "Loading..."
              : callbackMode
                ? "Request Callback"
                : "Unlock Number"}
```

5. Replace the OTP verify button label "Verify & Unlock" with `{callbackMode ? "Verify & Request Callback" : "Verify & Unlock"}`.
6. Replace the success block (lines ~524-532) with:

```tsx
      {unlock ? (
        callbackMode && unlock.callback ? (
          <div className="alert alert--success" data-testid="callback-requested" style={{ marginTop: "var(--space-4)" }}>
            <p style={{ fontWeight: 700 }}>Callback requested ✓</p>
            <ol style={{ margin: "var(--space-2) 0", paddingLeft: "var(--space-4)" }}>
              <li>Requested ✓</li>
              <li>Owner notified ✓</li>
              <li>Call on its way — by {refundTimeLabel}</li>
            </ol>
            <p className="caption" style={{ color: "var(--text-secondary)" }}>
              No call by then? Your credit comes back automatically. Credits left: {unlock.credits_remaining}
            </p>
          </div>
        ) : (
          <div className="alert alert--success" style={{ marginTop: "var(--space-4)" }}>
            <p>
              Owner Contact: <strong>{unlock.owner_contact?.phone_e164}</strong>
            </p>
            <p>Credits remaining: {unlock.credits_remaining}</p>
            <p>Refund auto-check at: {refundTimeLabel}</p>
          </div>
        )
      ) : null}
```

7. In `unlockContact`'s success path, after `setUnlock(response)`, add:

```ts
      if (response.callback) {
        trackEvent("callback_requested", {
          unlock_id: response.unlock_id,
          listing_id: listingId,
          call_deadline: response.callback.call_deadline_at
        });
      }
```

8. Replace the guest hint (line ~476) with:

```tsx
          {callbackMode
            ? "Guest browsing is open. Sign in with OTP to request a callback — new accounts get 2 free credits."
            : "Guest browsing is open. OTP is required only for unlock."}
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/unlock-contact-panel.tsx
git commit -m "feat(web): callback request panel — 24h guarantee copy and timeline, no phone reveal (ff_callback_leads)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Web — tenant "My callbacks" page

**Files:**
- Create: `apps/web/app/[locale]/tenant/callbacks/page.tsx`
- Create: `apps/web/components/tenant/callbacks-client.tsx`

**Interfaces:**
- Consumes: Task 8 endpoints (`GET /tenant/callbacks`, confirm, dispute). Route is middleware-protected (`/*/tenant/*` requires `tenant` role).
- Produces: `/en/tenant/callbacks` — list with per-request timeline and, when `status === "call_claimed"` and neither confirmed nor disputed, the "Did you get the call?" prompt.

- [ ] **Step 1: Create the page (server component shell)**

```tsx
// apps/web/app/[locale]/tenant/callbacks/page.tsx
import { CallbacksClient } from "../../../../components/tenant/callbacks-client";

export const metadata = { title: "My Callbacks — Cribliv" };

export default function TenantCallbacksPage() {
  return <CallbacksClient />;
}
```

- [ ] **Step 2: Create the client component**

```tsx
// apps/web/components/tenant/callbacks-client.tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { readAuthSession } from "../../lib/client-auth";
import { fetchApi } from "../../lib/api";
import { trackEvent } from "../../lib/analytics";

interface CallbackItem {
  callback_id: string;
  listing_id: string;
  listing_title: string;
  status: "awaiting_call" | "call_claimed" | "refunded";
  requested_at: string | null;
  call_deadline_at: string;
  call_claimed_at: string | null;
  tenant_confirmed_at: string | null;
  disputed_at: string | null;
}

function formatDeadline(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short"
  });
}

export function CallbacksClient() {
  const { data: session } = useSession();
  const [token, setToken] = useState<string | null>(null);
  const [items, setItems] = useState<CallbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const stored = readAuthSession();
    const nextAuthToken = (session as { accessToken?: string } | null)?.accessToken ?? null;
    setToken(stored?.access_token ?? nextAuthToken);
  }, [session]);

  async function load(activeToken: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApi<{ items: CallbackItem[] }>("/tenant/callbacks", {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      setItems(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load callbacks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) void load(token);
  }, [token]);

  async function act(callbackId: string, action: "confirm" | "dispute") {
    if (!token) return;
    setBusyId(callbackId);
    try {
      await fetchApi(`/tenant/callbacks/${callbackId}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      trackEvent(action === "confirm" ? "callback_confirmed" : "callback_disputed", {
        callback_id: callbackId
      });
      await load(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!token && !loading) {
    return <p style={{ padding: "var(--space-6)" }}>Please log in to see your callbacks.</p>;
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "var(--space-6) var(--space-4)" }}>
      <h1 style={{ marginBottom: "var(--space-2)" }}>My Callbacks</h1>
      <p className="body-sm" style={{ color: "var(--text-secondary)", marginBottom: "var(--space-5)" }}>
        Every request is guaranteed: a call within 24 hours or your credit back.
      </p>

      {loading ? <p>Loading…</p> : null}
      {error ? <p className="alert alert--error">{error}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="caption" style={{ color: "var(--text-tertiary)" }}>
          No callback requests yet. Find a property and request a callback.
        </p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
        {items.map((item) => {
          const steps =
            item.status === "refunded"
              ? ["Requested ✓", "Credit refunded ✓"]
              : item.status === "call_claimed"
                ? ["Requested ✓", "Owner notified ✓", "Call made — did you get it?"]
                : ["Requested ✓", "Owner notified ✓", `Call on its way — by ${formatDeadline(item.call_deadline_at)}`];
          const showPrompt =
            item.status === "call_claimed" && !item.tenant_confirmed_at && !item.disputed_at;
          return (
            <div key={item.callback_id} className="card" data-testid="callback-item"
                 style={{ padding: "var(--space-4)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)" }}>
              <p style={{ fontWeight: 700 }}>{item.listing_title}</p>
              <ol style={{ margin: "var(--space-2) 0", paddingLeft: "var(--space-4)" }}>
                {steps.map((s) => <li key={s} className="body-sm">{s}</li>)}
              </ol>
              {item.status === "refunded" ? (
                <p className="caption" style={{ color: "var(--text-secondary)" }}>
                  Nobody called in time, so your credit came back automatically.
                </p>
              ) : null}
              {item.tenant_confirmed_at ? (
                <p className="caption" style={{ color: "var(--text-secondary)" }}>Confirmed — glad the call happened.</p>
              ) : null}
              {item.disputed_at ? (
                <p className="caption" style={{ color: "var(--text-secondary)" }}>
                  Dispute recorded — your credit was refunded.
                </p>
              ) : null}
              {showPrompt ? (
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
                  <button className="btn btn--primary btn--sm" disabled={busyId === item.callback_id}
                          onClick={() => act(item.callback_id, "confirm")}>
                    Yes, I got the call
                  </button>
                  <button className="btn btn--secondary btn--sm" disabled={busyId === item.callback_id}
                          onClick={() => act(item.callback_id, "dispute")}>
                    No call — refund my credit
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\[locale\]/tenant/callbacks apps/web/components/tenant/callbacks-client.tsx
git commit -m "feat(web): tenant My Callbacks page — timeline, confirm and dispute prompts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: E2E + full verification

**Files:**
- Create: `apps/web/tests/callback-leads.spec.ts`

**Interfaces:**
- Consumes: Task 12 panel copy (asserted verbatim), `apps/web/tests/utils/auth.ts` helpers (`loginWithOtp`, storage key `cribliv:auth-session`, tenant phone `+919999999902`), flag-guard pattern from `apps/web/tests/listening-hero.spec.ts:7-11`.

- [ ] **Step 1: Write the E2E spec**

```ts
// apps/web/tests/callback-leads.spec.ts
// Requires API (in-memory mode is fine) + web running with:
//   FF_CALLBACK_LEADS=true (api)  NEXT_PUBLIC_FF_CALLBACK_LEADS=true (web)
// Self-skips otherwise, mirroring listening-hero.spec.ts.
import { test, expect } from "@playwright/test";
import { loginWithOtp, injectSession } from "./utils/auth";

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
    await page.goto(`/en/listing/${listingId}`);
    await injectSession(page, session);
    await page.reload();

    await expect(
      page.getByText("you'll get a call for this property within 24 hours", { exact: false })
    ).toBeVisible();

    await page.getByRole("button", { name: "Request Callback" }).click();

    await expect(page.getByTestId("callback-requested")).toBeVisible();
    await expect(page.getByText("Owner notified ✓")).toBeVisible();
    // The guarantee: no phone number anywhere in the success panel
    await expect(page.getByTestId("callback-requested")).not.toContainText("+91");
  });

  test("my-callbacks page lists the request", async ({ page, request }) => {
    const session = await loginWithOtp(request, "+919999999902");
    await page.goto("/en");
    await injectSession(page, session);
    await page.goto("/en/tenant/callbacks");
    await expect(page.getByText("My Callbacks")).toBeVisible();
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
```

(Check `apps/web/tests/utils/auth.ts` for the exact exported session-injection helper name — the file defines the `cribliv:auth-session` localStorage write used by every spec; if it's not named `injectSession`, use the existing export.)

- [ ] **Step 2: Run E2E**

```bash
# terminal 1: FF_CALLBACK_LEADS=true FF_LEAD_MANAGEMENT_ENABLED=true pnpm dev:api
# terminal 2: NEXT_PUBLIC_FF_CALLBACK_LEADS=true pnpm dev:web
NEXT_PUBLIC_FF_CALLBACK_LEADS=true PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 \
  pnpm --filter @cribliv/web test -- callback-leads
```
Expected: 2 passed, 1 skipped. Then re-run without the env: flag-off guard passes.

- [ ] **Step 3: Full verification**

```bash
pnpm --filter @cribliv/shared-types build
pnpm typecheck
pnpm lint
pnpm --filter @cribliv/api test
TEST_DATABASE_URL=postgres://cribliv:cribliv@localhost:5432/cribliv pnpm --filter @cribliv/api test
pnpm build
```
Expected: all green (DB-gated suites skip in the first API test run, run in the second).

Manual smoke (flags on, DB up): request a callback as tenant → see it in owner dashboard blurred with timer → buy/grant owner credits → unlock → Call now → tenant's My Callbacks shows "call made" prompt → confirm. Verify admin rescue queue returns the lead when its deadline is forced under 6h.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/callback-leads.spec.ts
git commit -m "test(web): callback leads E2E — request flow, no phone leak, flag-off guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes (already applied)

- **Spec coverage:** §3.1 → Tasks 4/12/13; §3.2 → Tasks 5/6/7/11; §3.3 → Task 9; §3.4 → Task 8; §3.5 outcome matrix → Tasks 8/10 tests; §4 → Tasks 1/11; §7 → Task 2; §8 → Tasks 4–9; §10 → Task 10; §11 → Task 3; §12 analytics events → trackEvent/logTelemetry calls in Tasks 4–13. §5 (guest gating) and §6 (welcome celebration) are **Slice 2 — deliberately absent here**.
- Deferred to Slice 2/3: Hindi copy, guest gating, welcome animation, Razorpay checkout widget, session `walletBalance` refresh nuances.
- Known accepted gaps (spec §15): free-lead count race; late-unlock harshness; `runLeadNudgeSweep` selects `u.phone` while new code uses `u.phone_e164` (the column that provably exists in 0001) — do not copy `u.phone` from the nudge sweep.
