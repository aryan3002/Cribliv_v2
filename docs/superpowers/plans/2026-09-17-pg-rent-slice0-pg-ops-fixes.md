# PG Rent — Slice 0: pg-operations fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assignment dates the rent engine will consume trustworthy — written as IST calendar dates, with an explicit move-out date, and with a direct way back from a served notice — without changing any other pg-operations behaviour.

**Architecture:** One new shared helper (`apps/api/src/common/date.ts`) supplies the IST date in TypeScript and as a SQL fragment; `PgBedAssignmentService` swaps its seven `CURRENT_DATE` uses for it, gains an optional `move_out_date` on the two operator move-out transitions, clears the notice fields when a move-out is cancelled, and gains a `cancelNotice` transition (`notice_served | move_out_requested → active`). The controller exposes the new input and endpoint; the web API client gets matching wrappers. Everything else is untouched.

**Tech Stack:** NestJS 10, `pg`, vitest + supertest integration tests against local Postgres (`describe.skipIf(!DATABASE_URL)`), `@cribliv/shared-types`.

**Spec:** `docs/superpowers/specs/2026-09-17-pg-rent-collection-design.md` — §2 "Assignment date writers", §8.9 "pg-operations service" row, §12 "pg-operations additions", §17 #10 and #11, §19 #10 and #42.

## Global Constraints

See `docs/superpowers/plans/2026-09-17-pg-rent-00-index.md` "Global constraints" and "Environment". Specific to this slice:

- Do **not** touch `pg-occupancy.service.ts`, `pg-maintenance.service.ts` or `pg-residence.service.ts` `CURRENT_DATE` uses — they are reads/derived values, out of scope (§8.9 names only the assignment writers).
- No new notification types (the `NotificationType` union in `notification.templates.ts` is closed and template-backed; `cancelNotice` sends no notification in this slice).
- Existing tests in `assignment.integration.test.ts` must keep passing unchanged except where a step below edits them.
- Run every API test with the environment exports from the index plan; `pnpm --filter @cribliv/shared-types build` after any shared-types edit.

---

## File structure

| File                                                                                   | Responsibility                                                                                             |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apps/api/src/common/date.ts` (create)                                                 | `todayIst()`, `IST_TODAY_SQL`, `isIsoDate()`, `compareIsoDates()` — the only place that knows the timezone |
| `apps/api/src/common/__tests__/date.test.ts` (create)                                  | Pure unit tests for the helper                                                                             |
| `packages/shared-types/src/pg-operations.ts` (modify)                                  | `PgMoveOutInput` type                                                                                      |
| `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts` (modify)    | IST writers; `move_out_date` input; notice-field clearing; `cancelNotice`                                  |
| `apps/api/src/modules/pg-operations/pg-assignment.controller.ts` (modify)              | Body on the two move-out endpoints; `cancel-notice` endpoint                                               |
| `apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts` (modify) | New/extended integration tests                                                                             |
| `apps/web/lib/pg-operations-api.ts` (modify)                                           | `confirmAssignmentMoveOut` / `moveOutAssignmentNow` accept a date; `cancelAssignmentNotice`                |
| `apps/web/lib/__tests__/pg-operations-api.test.ts` (modify)                            | Wrapper tests                                                                                              |

---

### Task 1: IST date helper

**Files:**

- Create: `apps/api/src/common/date.ts`
- Test: `apps/api/src/common/__tests__/date.test.ts`

**Interfaces:**

- Produces:
  - `todayIst(now?: Date): string` — `YYYY-MM-DD` of the IST calendar date for `now` (default: real clock).
  - `IST_TODAY_SQL: string` — the literal `(now() AT TIME ZONE 'Asia/Kolkata')::date` for embedding in SQL.
  - `isIsoDate(value: unknown): value is string` — `^\d{4}-\d{2}-\d{2}$` **and** a real calendar date.
  - `compareIsoDates(a: string, b: string): -1 | 0 | 1`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/src/common/__tests__/date.test.ts
import { describe, expect, it } from "vitest";

import { IST_TODAY_SQL, compareIsoDates, isIsoDate, todayIst } from "../date";

describe("todayIst", () => {
  it("returns the IST calendar date, not the UTC one, across the 18:30 UTC boundary", () => {
    // 2026-09-16 23:00 UTC is 2026-09-17 04:30 IST
    expect(todayIst(new Date("2026-09-16T23:00:00.000Z"))).toBe("2026-09-17");
    // 2026-09-16 18:29 UTC is still 2026-09-16 23:59 IST
    expect(todayIst(new Date("2026-09-16T18:29:59.000Z"))).toBe("2026-09-16");
    // 2026-09-16 18:30 UTC is 2026-09-17 00:00 IST
    expect(todayIst(new Date("2026-09-16T18:30:00.000Z"))).toBe("2026-09-17");
  });

  it("formats with zero padding", () => {
    expect(todayIst(new Date("2026-01-05T10:00:00.000Z"))).toBe("2026-01-05");
  });
});

describe("IST_TODAY_SQL", () => {
  it("is the exact fragment the spec mandates", () => {
    expect(IST_TODAY_SQL).toBe("(now() AT TIME ZONE 'Asia/Kolkata')::date");
  });
});

describe("isIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-9-1")).toBe(false);
    expect(isIsoDate("2026-09-01T00:00:00Z")).toBe(false);
    expect(isIsoDate(20260901)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe("compareIsoDates", () => {
  it("orders lexically, which is chronological for ISO dates", () => {
    expect(compareIsoDates("2026-09-01", "2026-09-02")).toBe(-1);
    expect(compareIsoDates("2026-09-02", "2026-09-02")).toBe(0);
    expect(compareIsoDates("2026-10-01", "2026-09-30")).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @cribliv/api exec vitest run src/common/__tests__/date.test.ts`
Expected: FAIL — `Cannot find module '../date'`.

- [ ] **Step 3: Write the helper**

```ts
// apps/api/src/common/date.ts
/**
 * IST calendar-date helpers. The rent module (and the assignment writers it
 * depends on) reason in Indian calendar days; Postgres sessions on Azure run in
 * UTC, so `CURRENT_DATE` is one day early between 00:00 and 05:30 IST. Every
 * "today" in SQL or TypeScript goes through this file.
 */

/** SQL fragment for today's IST date. Embed verbatim; it takes no parameters. */
export const IST_TODAY_SQL = "(now() AT TIME ZONE 'Asia/Kolkata')::date";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** `YYYY-MM-DD` of the IST calendar date for `now` (default: the real clock). */
export function todayIst(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True only for `YYYY-MM-DD` strings that name a real calendar date. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** Lexical order of ISO dates is chronological order. */
export function compareIsoDates(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @cribliv/api exec vitest run src/common/__tests__/date.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/common/date.ts apps/api/src/common/__tests__/date.test.ts
git commit -m "feat(api): add IST calendar-date helper for assignment and rent date logic"
```

---

### Task 2: Write assignment dates in IST

**Files:**

- Modify: `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts:544, :573, :655, :663, :914, :973, :981`
- Test: `apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts`

**Interfaces:**

- Consumes: `IST_TODAY_SQL`, `todayIst` from Task 1.
- Produces: no signature change; `move_in_date`, `move_out_date`, `notice_served_date`, `pg_beds.available_from` are now IST dates.

- [ ] **Step 1: Write the failing test**

Add to the `describe.skipIf(!HAS_DB)("PG bed assignments (real Postgres integration)"` block, after the existing test "lets an operator directly move out a live occupant and frees the bed with an event" (`:473`):

```ts
it("writes move-in, move-out, notice and available-from dates as IST calendar dates", async () => {
  const fixture = await createFixture();
  const today = todayIst();

  const active = await service.moveIn(
    operatorId,
    fixture.propertyId,
    fixture.bedIds[0],
    occupant({ occupant_phone_e164: "+919999999902", move_in_date: null })
  );
  expect(active.move_in_date).toBe(today);

  const noticed = await service.serveNotice(tenantId, active.id, {
    notice_end_date: "2099-02-15"
  });
  expect(noticed.notice_served_date).toBe(today);

  const movedOut = await service.operatorDirectMoveOut(operatorId, fixture.propertyId, active.id);
  expect(movedOut.move_out_date).toBe(today);

  const bed = await db.query<{ available_from: Date | string | null }>(
    `SELECT to_char(available_from, 'YYYY-MM-DD') AS available_from
         FROM pg_beds WHERE id = $1::uuid`,
    [fixture.bedIds[0]]
  );
  expect(bed.rows[0].available_from).toBe(today);

  // The session date and the IST date must agree on what was written: the
  // column holds an IST day even when the DB session runs in UTC.
  const check = await db.query<{ same: boolean }>(
    `SELECT move_out_date = (now() AT TIME ZONE 'Asia/Kolkata')::date AS same
         FROM pg_bed_assignments WHERE id = $1::uuid`,
    [active.id]
  );
  expect(check.rows[0].same).toBe(true);
});
```

Add the import at the top of the test file, after the `DatabaseService` import:

```ts
import { todayIst } from "../../../common/date";
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations/__tests__/assignment.integration.test.ts -t "IST calendar dates"`
Expected: FAIL only if the local clock is between 00:00 and 05:30 IST (the UTC and IST dates differ); at other times it passes for the wrong reason. To make it fail deterministically, force the DB session into a zone whose calendar date differs from IST _right now_:

```bash
# IST clock before 16:30 → a zone 11 h behind UTC is still on yesterday's date
# IST clock 16:30 or later → a zone 14 h ahead of UTC is already on tomorrow's date
ZONE=$([ "$(TZ=Asia/Kolkata date +%H%M)" -lt 1630 ] && echo "Etc/GMT+11" || echo "Etc/GMT-14")
psql "$DATABASE_URL" -c "ALTER DATABASE cribliv_v2 SET timezone TO '$ZONE'"
pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations/__tests__/assignment.integration.test.ts -t "IST calendar dates"
```

(`Etc/GMT+11` is UTC−11 and `Etc/GMT-14` is UTC+14 — POSIX signs are inverted.) Expected: FAIL on `expect(active.move_in_date).toBe(today)` and on the `same` check. Leave the setting in place for Step 4 and reset it in Step 5.

- [ ] **Step 3: Replace every `CURRENT_DATE` in the assignment writers**

In `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts`:

Add the import after `import { transaction } from "../../../common/transaction";`:

```ts
import { IST_TODAY_SQL } from "../../../common/date";
```

`:544` (moveIn UPDATE) — change

```ts
                  move_in_date = COALESCE($8::date, CURRENT_DATE),
```

to

```ts
                  move_in_date = COALESCE($8::date, ${IST_TODAY_SQL}),
```

`:573` (moveIn INSERT) — change

```ts
              COALESCE($9::date, CURRENT_DATE), $10::bigint, $11::bigint, $12, $13::uuid)
```

to

```ts
              COALESCE($9::date, ${IST_TODAY_SQL}), $10::bigint, $11::bigint, $12, $13::uuid)
```

`:655` (operatorTransition) — change

```ts
                move_out_date = CASE WHEN $2 = 'moved_out' THEN CURRENT_DATE ELSE move_out_date END
```

to

```ts
                move_out_date = CASE WHEN $2 = 'moved_out' THEN ${IST_TODAY_SQL} ELSE move_out_date END
```

`:663` and `:981` (both `pg_beds` updates) — change

```ts
                available_from = CASE WHEN $2 = 'vacant' THEN CURRENT_DATE ELSE NULL END
```

to

```ts
                available_from = CASE WHEN $2 = 'vacant' THEN ${IST_TODAY_SQL} ELSE NULL END
```

`:914` (serveNotice) — change

```ts
                notice_served_date = CURRENT_DATE,
```

to

```ts
                notice_served_date = ${IST_TODAY_SQL},
```

`:973` (tenantTransition) — same replacement as `:655`.

These are all template literals already (backtick SQL), so `${IST_TODAY_SQL}` interpolates a constant, not user input.

- [ ] **Step 4: Run the test to verify it passes**

Run (still with the Kiritimati database timezone from Step 2): `pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations/__tests__/assignment.integration.test.ts`
Expected: PASS — the new test and every existing test in the file.

- [ ] **Step 5: Reset the database timezone and re-run**

```bash
psql "$DATABASE_URL" -c "ALTER DATABASE cribliv_v2 RESET timezone"
pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations/__tests__/assignment.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts
git commit -m "fix(pg-ops): write assignment and bed dates as IST calendar dates, not session CURRENT_DATE"
```

---

### Task 3: Explicit `move_out_date` on operator move-out

**Files:**

- Modify: `packages/shared-types/src/pg-operations.ts` (after `PgServeNoticeInput`, `:162`)
- Modify: `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts` (`operatorTransition` `:636-685`, `confirmMoveOut` `:717`, `operatorDirectMoveOut` `:735`)
- Modify: `apps/api/src/modules/pg-operations/pg-assignment.controller.ts` (`confirmMoveOut` `:104`, `moveOutNow` `:113`)
- Test: `apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts`

**Interfaces:**

- Produces:
  - `export interface PgMoveOutInput { move_out_date?: string | null }` in shared-types.
  - `PgBedAssignmentService.confirmMoveOut(operatorId, propertyId, assignmentId, input?: PgMoveOutInput)`
  - `PgBedAssignmentService.operatorDirectMoveOut(operatorId, propertyId, assignmentId, input?: PgMoveOutInput)`
  - 400 `{ code: "invalid_move_out_date" }` when the date is malformed, after today (IST) or before `move_in_date`.

- [ ] **Step 1: Write the failing tests**

Add after the Task 2 test:

```ts
it("accepts an explicit move-out date on confirm and direct move-out, bounded by move-in and today", async () => {
  const fixture = await createFixture();
  const active = await service.moveIn(
    operatorId,
    fixture.propertyId,
    fixture.bedIds[0],
    occupant({ occupant_phone_e164: "+919999999902", move_in_date: "2026-01-10" })
  );

  await expect(
    service.operatorDirectMoveOut(operatorId, fixture.propertyId, active.id, {
      move_out_date: "2026-01-09"
    })
  ).rejects.toMatchObject({ response: { code: "invalid_move_out_date" } });
  await expect(
    service.operatorDirectMoveOut(operatorId, fixture.propertyId, active.id, {
      move_out_date: "2099-01-01"
    })
  ).rejects.toMatchObject({ response: { code: "invalid_move_out_date" } });
  await expect(
    service.operatorDirectMoveOut(operatorId, fixture.propertyId, active.id, {
      move_out_date: "2026-1-9"
    })
  ).rejects.toMatchObject({ response: { code: "invalid_move_out_date" } });

  const movedOut = await service.operatorDirectMoveOut(operatorId, fixture.propertyId, active.id, {
    move_out_date: "2026-01-31"
  });
  expect(movedOut.status).toBe("moved_out");
  expect(movedOut.move_out_date).toBe("2026-01-31");

  // confirm-move-out path, via the pending state
  const second = await service.moveIn(
    operatorId,
    fixture.propertyId,
    fixture.bedIds[1],
    occupant({ occupant_phone_e164: "+919999999902", move_in_date: "2026-02-01" })
  );
  await service.operatorMoveOutRequest(operatorId, fixture.propertyId, second.id);
  const confirmed = await service.confirmMoveOut(operatorId, fixture.propertyId, second.id, {
    move_out_date: "2026-02-20"
  });
  expect(confirmed.move_out_date).toBe("2026-02-20");

  // omitted date still means today (IST)
  const third = await service.moveIn(
    operatorId,
    fixture.propertyId,
    fixture.bedIds[2],
    occupant({ occupant_phone_e164: "+919999999902", move_in_date: "2026-02-01" })
  );
  const todayOut = await service.operatorDirectMoveOut(operatorId, fixture.propertyId, third.id);
  expect(todayOut.move_out_date).toBe(todayIst());
});

it("exposes the move-out date through both operator endpoints", async () => {
  const fixture = await createFixture();
  const active = await service.moveIn(
    operatorId,
    fixture.propertyId,
    fixture.bedIds[0],
    occupant({ occupant_phone_e164: "+919999999902", move_in_date: "2026-03-01" })
  );

  const bad = await request(app.getHttpServer())
    .post(`/v1/pg-operator/properties/${fixture.propertyId}/assignments/${active.id}/move-out-now`)
    .set("x-test-identity", "operator")
    .send({ move_out_date: "2026-02-01" });
  expect(bad.status).toBe(400);
  expect(bad.body.error?.code ?? bad.body.code).toBe("invalid_move_out_date");

  const good = await request(app.getHttpServer())
    .post(`/v1/pg-operator/properties/${fixture.propertyId}/assignments/${active.id}/move-out-now`)
    .set("x-test-identity", "operator")
    .send({ move_out_date: "2026-03-15" });
  expect(good.status).toBe(201);
  expect(good.body.data.move_out_date).toBe("2026-03-15");
});
```

Note: the existing suite's `x-test-identity` guard override (see `beforeAll`) maps `operator` to `operatorId`; reuse it. If the suite's error envelope differs from `{ error: { code } }`, match whatever the existing "rejects malformed occupant amounts and dates with 400s" test at `:361` asserts — copy its assertion shape exactly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations/__tests__/assignment.integration.test.ts -t "move-out date"`
Expected: FAIL — the 4th argument is ignored, so the first `rejects` assertion fails with "promise resolved instead of rejecting".

- [ ] **Step 3: Add the shared type**

In `packages/shared-types/src/pg-operations.ts`, after `PgServeNoticeInput` (`:162`):

```ts
export interface PgMoveOutInput {
  /** IST calendar date the tenant actually left; defaults to today. Must be ≥ move_in_date and ≤ today. */
  move_out_date?: string | null;
}
```

Then: `pnpm --filter @cribliv/shared-types build`.

- [ ] **Step 4: Thread the date through the service**

In `pg-bed-assignment.service.ts`:

Add `PgMoveOutInput` to the `@cribliv/shared-types` type import list (`:11-22`), and extend the date import:

```ts
import { IST_TODAY_SQL, compareIsoDates, isIsoDate, todayIst } from "../../../common/date";
```

Add a private validator next to `validateOccupant` (`:259`):

```ts
  private resolveMoveOutDate(
    input: PgMoveOutInput | undefined,
    moveInDate: Date | string | null
  ): string | null {
    const value = input?.move_out_date ?? null;
    if (value === null) return null;
    if (!isIsoDate(value) || compareIsoDates(value, todayIst()) > 0) {
      throw new BadRequestException({ code: "invalid_move_out_date" });
    }
    const moveIn = moveInDate === null ? null : toDate(moveInDate);
    if (moveIn !== null && compareIsoDates(value, moveIn) < 0) {
      throw new BadRequestException({ code: "invalid_move_out_date" });
    }
    return value;
  }
```

Change `operatorTransition`'s signature (`:636-644`) to take the optional input as the last parameter:

```ts
  private async operatorTransition(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    allowed: readonly PgBedAssignmentStatus[],
    target: PgBedAssignmentStatus,
    eventType: string,
    bedStatus: "occupied" | "vacant",
    moveOut?: PgMoveOutInput
  ): Promise<TransitionResult> {
```

Inside it, after `this.assertTransition(current.status, allowed, target);` add:

```ts
const moveOutDate =
  target === "moved_out" ? this.resolveMoveOutDate(moveOut, current.move_in_date) : null;
```

and change the UPDATE (`:651-657`) to:

```ts
const updated = await client.query<AssignmentRow>(
  `UPDATE pg_bed_assignments
            SET status = $2::pg_assignment_status,
                move_out_date = CASE
                  WHEN $2 = 'moved_out' THEN COALESCE($3::date, ${IST_TODAY_SQL})
                  ELSE move_out_date
                END
          WHERE id = $1::uuid
          RETURNING *`,
  [assignmentId, target, moveOutDate]
);
```

and add `move_out_date: moveOutDate ?? "today"` to the event payload object `{ bed_id: current.bed_id }` so the audit trail shows whether a date was supplied:

```ts
          { bed_id: current.bed_id, ...(moveOutDate ? { move_out_date: moveOutDate } : {}) }
```

`LockedAssignmentRow` already carries `move_in_date` (selected at `:353`), so `current.move_in_date` is available.

Change `confirmMoveOut` (`:717`) and `operatorDirectMoveOut` (`:735`) to accept and forward the input:

```ts
  async confirmMoveOut(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input?: PgMoveOutInput
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.operatorTransition(
      operatorId,
      propertyId,
      assignmentId,
      ["move_out_pending_confirmation"],
      "moved_out",
      "move_out_confirmed",
      "vacant",
      input
    );
    return result.assignment;
  }

  async operatorDirectMoveOut(
    operatorId: string,
    propertyId: string,
    assignmentId: string,
    input?: PgMoveOutInput
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.operatorTransition(
      operatorId,
      propertyId,
      assignmentId,
      ["active", "notice_served", "move_out_requested", "move_out_pending_confirmation"],
      "moved_out",
      "operator_direct_move_out",
      "vacant",
      input
    );
    return result.assignment;
  }
```

- [ ] **Step 5: Accept the body in the controller**

In `pg-assignment.controller.ts`, add `PgMoveOutInput` to the shared-types type import, then change the two handlers:

```ts
  @Post(":propertyId/assignments/:id/confirm-move-out")
  async confirmMoveOut(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") assignmentId: string,
    @Body() body: PgMoveOutInput | undefined
  ) {
    return ok(
      await this.assignments.confirmMoveOut(user.id, propertyId, assignmentId, {
        move_out_date: body?.move_out_date ?? null
      })
    );
  }

  @Post(":propertyId/assignments/:id/move-out-now")
  async moveOutNow(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") assignmentId: string,
    @Body() body: PgMoveOutInput | undefined
  ) {
    return ok(
      await this.assignments.operatorDirectMoveOut(user.id, propertyId, assignmentId, {
        move_out_date: body?.move_out_date ?? null
      })
    );
  }
```

Only `move_out_date` is read from the body; anything else is ignored (the service validates the one field).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations/__tests__/assignment.integration.test.ts`
Expected: PASS, including the two new tests and every pre-existing one (the "without a database" test calls `confirmMoveOut`/`operatorDirectMoveOut` with three args — still valid).

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm --filter @cribliv/api typecheck
git add packages/shared-types/src/pg-operations.ts apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts apps/api/src/modules/pg-operations/pg-assignment.controller.ts apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts
git commit -m "feat(pg-ops): accept an explicit move-out date on confirm and direct move-out"
```

---

### Task 4: `cancelMoveOut` clears notice fields; new `cancelNotice` transition

**Files:**

- Modify: `apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts` (`operatorTransition`, `cancelMoveOut` `:753-770`, new method after it)
- Modify: `apps/api/src/modules/pg-operations/pg-assignment.controller.ts` (new endpoint after `cancelMoveOut`)
- Test: `apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts`

**Interfaces:**

- Produces:
  - `PgBedAssignmentService.cancelNotice(operatorId, propertyId, assignmentId): Promise<PgBedAssignment>` — allowed from `notice_served` and `move_out_requested`; target `active`; clears `notice_served_date` and `notice_end_date`; bed stays `occupied`; event `notice_cancelled`.
  - `cancelMoveOut` now also clears both notice fields (event unchanged: `move_out_cancelled`).
  - `POST /v1/pg-operator/properties/:propertyId/assignments/:id/cancel-notice`.

- [ ] **Step 1: Write the failing tests**

Add after the Task 3 tests:

```ts
it("clears the notice dates when a pending move-out is cancelled", async () => {
  const fixture = await createFixture();
  const active = await service.moveIn(
    operatorId,
    fixture.propertyId,
    fixture.bedIds[0],
    occupant({ occupant_phone_e164: "+919999999902" })
  );
  await service.serveNotice(tenantId, active.id, { notice_end_date: "2099-02-15" });
  await service.operatorMoveOutRequest(operatorId, fixture.propertyId, active.id);

  const back = await service.cancelMoveOut(operatorId, fixture.propertyId, active.id);
  expect(back).toMatchObject({
    status: "active",
    notice_served_date: null,
    notice_end_date: null,
    move_out_date: null
  });
  expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");
});

it("lets the operator cancel a served notice straight back to active", async () => {
  const fixture = await createFixture();
  const active = await service.moveIn(
    operatorId,
    fixture.propertyId,
    fixture.bedIds[0],
    occupant({ occupant_phone_e164: "+919999999902" })
  );
  await service.serveNotice(tenantId, active.id, { notice_end_date: "2099-02-15" });

  const staying = await service.cancelNotice(operatorId, fixture.propertyId, active.id);
  expect(staying).toMatchObject({
    status: "active",
    notice_served_date: null,
    notice_end_date: null
  });
  expect(await bedStatus(fixture.bedIds[0])).toBe("occupied");
  expect(await events(active.id)).toMatchObject([
    { from_status: null, to_status: "active", initiator: "operator" },
    { from_status: "active", to_status: "notice_served", initiator: "tenant" },
    {
      event_type: "notice_cancelled",
      from_status: "notice_served",
      to_status: "active",
      initiator: "operator"
    }
  ]);

  // also allowed from a tenant move-out request
  await service.tenantMoveOutRequest(tenantId, active.id);
  const stayingAgain = await service.cancelNotice(operatorId, fixture.propertyId, active.id);
  expect(stayingAgain.status).toBe("active");

  // not allowed from active or pending confirmation
  await expect(
    service.cancelNotice(operatorId, fixture.propertyId, active.id)
  ).rejects.toMatchObject({ response: { code: "invalid_assignment_transition" } });
  await service.operatorMoveOutRequest(operatorId, fixture.propertyId, active.id);
  await expect(
    service.cancelNotice(operatorId, fixture.propertyId, active.id)
  ).rejects.toMatchObject({ response: { code: "invalid_assignment_transition" } });
});

it("exposes cancel-notice as an operator endpoint", async () => {
  const fixture = await createFixture();
  const active = await service.moveIn(
    operatorId,
    fixture.propertyId,
    fixture.bedIds[0],
    occupant({ occupant_phone_e164: "+919999999902" })
  );
  await service.serveNotice(tenantId, active.id, { notice_end_date: "2099-02-15" });

  const res = await request(app.getHttpServer())
    .post(`/v1/pg-operator/properties/${fixture.propertyId}/assignments/${active.id}/cancel-notice`)
    .set("x-test-identity", "operator");
  expect(res.status).toBe(201);
  expect(res.body.data).toMatchObject({ status: "active", notice_end_date: null });
});
```

Also extend the "without a database" test (`:29`) with one more expectation after the `cancelMoveOut` line:

```ts
await expect(service.cancelNotice(operatorId, propertyId, assignmentId)).rejects.toMatchObject(
  unavailable
);
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations/__tests__/assignment.integration.test.ts -t "notice"`
Expected: FAIL — `service.cancelNotice is not a function`; the `cancelMoveOut` test fails on `notice_end_date: null`.

- [ ] **Step 3: Implement**

In `operatorTransition`, change the UPDATE from Task 3 to also clear the notice fields when the target is `active`:

```ts
const updated = await client.query<AssignmentRow>(
  `UPDATE pg_bed_assignments
            SET status = $2::pg_assignment_status,
                move_out_date = CASE
                  WHEN $2 = 'moved_out' THEN COALESCE($3::date, ${IST_TODAY_SQL})
                  ELSE move_out_date
                END,
                notice_served_date = CASE WHEN $2 = 'active' THEN NULL ELSE notice_served_date END,
                notice_end_date    = CASE WHEN $2 = 'active' THEN NULL ELSE notice_end_date END
          WHERE id = $1::uuid
          RETURNING *`,
  [assignmentId, target, moveOutDate]
);
```

`cancelMoveOut` (`:753`) needs no code change — it targets `active`, so the clearing applies. Add `cancelNotice` directly after it:

```ts
  /**
   * The tenant is staying after all. Today the only route back from
   * `notice_served` is request-move-out-then-cancel; this is the direct one.
   * Clears both notice dates so the rent billing window reopens (spec §5.2).
   */
  async cancelNotice(
    operatorId: string,
    propertyId: string,
    assignmentId: string
  ): Promise<PgBedAssignment> {
    if (!this.db.isEnabled()) throw this.unavailable();
    const result = await this.operatorTransition(
      operatorId,
      propertyId,
      assignmentId,
      ["notice_served", "move_out_requested"],
      "active",
      "notice_cancelled",
      "occupied"
    );
    return result.assignment;
  }
```

In `pg-assignment.controller.ts`, after the `cancelMoveOut` handler:

```ts
  @Post(":propertyId/assignments/:id/cancel-notice")
  async cancelNotice(
    @AuthUser() user: UserContext,
    @Param("propertyId") propertyId: string,
    @Param("id") assignmentId: string
  ) {
    return ok(await this.assignments.cancelNotice(user.id, propertyId, assignmentId));
  }
```

- [ ] **Step 4: Run the whole file to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations/__tests__/assignment.integration.test.ts`
Expected: PASS. Pay attention to the existing test "cancels a pending move-out back to active without freeing the bed" (`:751`) — it must still pass; it asserts status and bed, not the notice fields.

- [ ] **Step 5: Run the sibling pg-operations suites (they share the assignment service)**

Run: `pnpm --filter @cribliv/api exec vitest run src/modules/pg-operations`
Expected: PASS for `assignment`, `layout-occupancy`, `maintenance`, `maintenance-v2`, `manage-request`, `pg-residence`. If `maintenance*.integration.test.ts` report the known `notification_log` teardown failure from the memory note `api-integration-test-known-failures.md`, that is pre-existing — confirm by running the same file on `master` before your change.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pg-operations/services/pg-bed-assignment.service.ts apps/api/src/modules/pg-operations/pg-assignment.controller.ts apps/api/src/modules/pg-operations/__tests__/assignment.integration.test.ts
git commit -m "feat(pg-ops): add cancelNotice transition and clear notice dates when a move-out is cancelled"
```

---

### Task 5: Web API client wrappers

**Files:**

- Modify: `apps/web/lib/pg-operations-api.ts:477-496`
- Test: `apps/web/lib/__tests__/pg-operations-api.test.ts`

**Interfaces:**

- Produces:
  - `confirmAssignmentMoveOut(propertyId, assignmentId, input?: PgMoveOutInput, token?)`
  - `moveOutAssignmentNow(propertyId, assignmentId, input?: PgMoveOutInput, token?)`
  - `cancelAssignmentNotice(propertyId, assignmentId, token?)`
- Consumes: `PgMoveOutInput` from `@cribliv/shared-types` (Task 3).

- [ ] **Step 1: Read the existing wrapper test to copy its mocking style**

Open `apps/web/lib/__tests__/pg-operations-api.test.ts` and find how it stubs `fetchApi` (search for `vi.mock("../api"` or `fetchApi`). Every new test below uses the same stub and the same assertion shape (`expect(fetchApi).toHaveBeenCalledWith(path, init)`). If the file asserts on `init.body` as a JSON string, keep that.

- [ ] **Step 2: Write the failing tests**

Append inside the file's top-level `describe`:

```ts
it("posts the move-out date on confirm and direct move-out", async () => {
  await confirmAssignmentMoveOut("prop-1", "asg-1", { move_out_date: "2026-03-15" }, "tok");
  expect(fetchApi).toHaveBeenLastCalledWith(
    "/pg-operator/properties/prop-1/assignments/asg-1/confirm-move-out",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ move_out_date: "2026-03-15" })
    })
  );

  await moveOutAssignmentNow("prop-1", "asg-1", undefined, "tok");
  expect(fetchApi).toHaveBeenLastCalledWith(
    "/pg-operator/properties/prop-1/assignments/asg-1/move-out-now",
    expect.objectContaining({ method: "POST", body: JSON.stringify({}) })
  );
});

it("posts cancel-notice", async () => {
  await cancelAssignmentNotice("prop-1", "asg-1", "tok");
  expect(fetchApi).toHaveBeenLastCalledWith(
    "/pg-operator/properties/prop-1/assignments/asg-1/cancel-notice",
    expect.objectContaining({ method: "POST" })
  );
});
```

and add `cancelAssignmentNotice`, `confirmAssignmentMoveOut`, `moveOutAssignmentNow` to the file's import from `../pg-operations-api`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/pg-operations-api.test.ts`
Expected: FAIL — `cancelAssignmentNotice` is not exported; the confirm test fails on the missing body.

- [ ] **Step 4: Implement the wrappers**

Replace `confirmAssignmentMoveOut` and `moveOutAssignmentNow` (`:477-490`) and add `cancelAssignmentNotice` after `cancelAssignmentMoveOut` (`:496`). Check how other POST-with-body wrappers in the same file serialise (search for `JSON.stringify` and the JSON content-type header helper) and use the identical shape:

```ts
export function confirmAssignmentMoveOut(
  propertyId: string,
  assignmentId: string,
  input: PgMoveOutInput = {},
  token?: string
) {
  return fetchApi<PgBedAssignment>(
    `/pg-operator/properties/${propertyId}/assignments/${assignmentId}/confirm-move-out`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export function moveOutAssignmentNow(
  propertyId: string,
  assignmentId: string,
  input: PgMoveOutInput = {},
  token?: string
) {
  return fetchApi<PgBedAssignment>(
    `/pg-operator/properties/${propertyId}/assignments/${assignmentId}/move-out-now`,
    {
      method: "POST",
      headers: { ...authHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export function cancelAssignmentNotice(propertyId: string, assignmentId: string, token?: string) {
  return fetchApi<PgBedAssignment>(
    `/pg-operator/properties/${propertyId}/assignments/${assignmentId}/cancel-notice`,
    { method: "POST", headers: authHeaders(token) }
  );
}
```

Add `PgMoveOutInput` to the file's `@cribliv/shared-types` type import. Then find every caller of the two changed functions (`grep -rn "confirmAssignmentMoveOut\|moveOutAssignmentNow" apps/web --include=*.tsx --include=*.ts`) — today they are called as `(propertyId, assignmentId, token)`; update each call to `(propertyId, assignmentId, {}, token)` so the token does not slide into the input slot.

- [ ] **Step 5: Run the tests and the web typecheck**

Run: `pnpm --filter @cribliv/web exec vitest run lib/__tests__/pg-operations-api.test.ts && pnpm --filter @cribliv/web typecheck`
Expected: PASS; typecheck clean (it is what catches a missed caller from Step 4).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/pg-operations-api.ts apps/web/lib/__tests__/pg-operations-api.test.ts $(git diff --name-only -- apps/web/components)
git commit -m "feat(web): move-out date and cancel-notice wrappers for the pg-operations API"
```

---

### Task 6: Full verification and PR

- [ ] **Step 1: Run everything this slice touches**

```bash
pnpm --filter @cribliv/shared-types build
pnpm --filter @cribliv/api typecheck
pnpm --filter @cribliv/api exec vitest run src/common src/modules/pg-operations
pnpm --filter @cribliv/web typecheck
pnpm --filter @cribliv/web exec vitest run lib/__tests__/pg-operations-api.test.ts
pnpm lint
```

Expected: all green except the pre-existing failures recorded in the memory note `api-integration-test-known-failures.md` (verify each one also fails on `master`).

- [ ] **Step 2: Update the graph**

```bash
graphify update .
```

- [ ] **Step 3: Open the PR**

Branch `feat/pg-rent-slice0-pg-ops-dates`, title `feat(pg-ops): IST assignment dates, explicit move-out date, cancelNotice (rent slice 0)`. Body: link the spec §19 #10 / #42 rows and the index plan; state that `cancelNotice` sends no notification (closed template union) and that the three read-side `CURRENT_DATE` uses in occupancy/maintenance/residence are deliberately untouched.

---

## Self-review

**Spec coverage** — §2 "Assignment date writers" (Tasks 1–2) ✓; §8.9 pg-operations row: IST writers ✓, `move_out_date` input ✓, `cancelMoveOut` clears ✓, `cancelNotice` ✓; §12 "pg-operations additions" ✓ (Task 3 Step 5, Task 4 Step 3); §17 #10 #11 ✓; web wrappers ✓ (Task 5). The drawer date field (§8.9 Tenants row) is in slice 0b by design (index plan).

**Placeholder scan** — none; every step has code. Task 3 Step 1 tells the executor to copy the existing error-envelope assertion shape from `:361` rather than guess it.

**Type consistency** — `PgMoveOutInput` is the same name in shared-types, service, controller and web; `resolveMoveOutDate` returns `string | null` and the SQL binds `$3::date` with `null` → falls to `COALESCE`'s IST default; `operatorTransition`'s eighth parameter is optional so the four existing callers (`operatorMoveOutRequest`, `cancelMoveOut`, `cancelReservation`, `cancelNotice`) compile unchanged.
