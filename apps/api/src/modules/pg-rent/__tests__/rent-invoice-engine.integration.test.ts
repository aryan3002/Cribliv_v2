import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DatabaseService } from "../../../common/database.service";
import { RentAllocationService } from "../services/rent-allocation.service";
import { SYSTEM_ACTOR } from "../services/rent-guards";
import { RentInvoiceEngineService } from "../services/rent-invoice-engine.service";
import { RentSettingsService } from "../services/rent-settings.service";
import type { RentSettingsRow } from "../dto/settings.dto";
import { assertRentInvariants } from "./helpers/assert-rent-invariants";
import { RentFixtures } from "./helpers/rent-fixtures";

const HAS_DB = Boolean(process.env.DATABASE_URL);

describe.skipIf(!HAS_DB)("RentInvoiceEngineService", () => {
  let db: DatabaseService;
  let fx: RentFixtures;
  let settings: RentSettingsService;
  let engine: RentInvoiceEngineService;
  let operatorId: string;

  type Setup = { propertyId: string; listingId: string; roomTypeId: string; roomId: string };

  async function setupProperty(
    opts: {
      settings?: Parameters<RentSettingsService["enable"]>[2];
      roomTypeRent?: number;
      roomTypeDeposit?: number | null;
      listingDeposit?: number | null;
      withRoomType?: boolean;
    } = {}
  ): Promise<Setup> {
    const propertyId = await fx.createProperty(operatorId);
    const listingId = await fx.createListingWithDetails(propertyId, operatorId, {
      depositPaise: opts.listingDeposit ?? null
    });
    const roomTypeId = await fx.createRoomType(listingId, {
      rentPaise: opts.roomTypeRent ?? 900000,
      depositPaise: opts.roomTypeDeposit ?? null
    });
    const roomId = await fx.createRoom(propertyId, {
      roomTypeId: opts.withRoomType === false ? null : roomTypeId,
      roomNumber: "102"
    });
    await settings.enable(operatorId, propertyId, {
      billing_starts_on: "2026-09-01",
      due_day: 5,
      ...opts.settings
    });
    return { propertyId, listingId, roomTypeId, roomId };
  }

  async function tenant(
    setup: Setup,
    label: string,
    opts: Parameters<RentFixtures["createAssignment"]>[2] extends infer T ? Partial<T> : never = {}
  ) {
    const bedId = await fx.createBed(setup.roomId, label);
    return fx.createAssignment(setup.propertyId, bedId, { createdBy: operatorId, ...opts });
  }

  async function invoices(assignmentId: string) {
    const r = await db.query<{
      kind: string;
      status: string;
      period_start: string | null;
      period_end: string | null;
      due_date: string;
      total_paise: string;
      invoice_number: string;
      rent_source: string | null;
      proration_factor: string | null;
      pay_token: string | null;
    }>(
      `SELECT kind::text, status::text, to_char(period_start,'YYYY-MM-DD') AS period_start, to_char(period_end,'YYYY-MM-DD') AS period_end,
              to_char(due_date,'YYYY-MM-DD') AS due_date, total_paise::text, invoice_number, rent_source::text, proration_factor::text, pay_token
         FROM pg_rent_invoices WHERE assignment_id = $1::uuid ORDER BY kind, period_start NULLS FIRST`,
      [assignmentId]
    );
    return r.rows;
  }

  beforeAll(async () => {
    db = new DatabaseService();
    fx = new RentFixtures(db, randomUUID().replace(/-/g, ""));
    await fx.setup();
    operatorId = await fx.createUser("pg_operator");
    settings = new RentSettingsService(db);
    engine = new RentInvoiceEngineService(db, settings, new RentAllocationService());
  });
  afterAll(async () => {
    await fx.teardown();
    await db.onModuleDestroy();
  });

  it("advance: mid-month move-in gets a prorated first period due on creation, then a full month with lead days; twice is a no-op", async () => {
    const s = await setupProperty();
    const a = await tenant(s, "A", { moveIn: "2026-09-12" });

    const first = await engine.generateInvoicesForProperty(s.propertyId, "2026-09-12");
    expect(first).toMatchObject({ invoices_created: 1, drafts_created: 0, deposits_created: 0 });
    let rows = await invoices(a);
    expect(rows).toMatchObject([
      {
        kind: "rent",
        status: "issued",
        period_start: "2026-09-12",
        period_end: "2026-09-30",
        due_date: "2026-09-12",
        total_paise: "570000",
        rent_source: "room_type",
        invoice_number: expect.stringMatching(/-INV-0001$/)
      }
    ]);
    expect(rows[0].pay_token).toHaveLength(43);
    expect(Number(rows[0].proration_factor)).toBeCloseTo(19 / 30, 5);

    // Sep 29: October (due Oct 5, lead 5 → create from Sep 30) not yet
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-09-29")).toMatchObject({
      invoices_created: 0
    });
    // Sep 30: October is created
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-09-30")).toMatchObject({
      invoices_created: 1
    });
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-09-30")).toMatchObject({
      invoices_created: 0
    });
    rows = await invoices(a);
    expect(rows[1]).toMatchObject({
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      due_date: "2026-10-05",
      total_paise: "900000",
      proration_factor: null
    });
    await assertRentInvariants(db, s.propertyId);
  });

  it("floor: a tenant since August with the floor on Sep 17 is first billed for October (advance) or September (arrears)", async () => {
    const adv = await setupProperty({ settings: { billing_starts_on: "2026-09-17" } });
    const a1 = await tenant(adv, "A", { moveIn: "2026-08-12" });
    await engine.generateInvoicesForProperty(adv.propertyId, "2026-10-01");
    expect(await invoices(a1)).toMatchObject([
      { period_start: "2026-10-01", period_end: "2026-10-31", due_date: "2026-10-05" }
    ]);

    const arr = await setupProperty({
      settings: { billing_starts_on: "2026-09-17", billing_timing: "arrears" }
    });
    const a2 = await tenant(arr, "A", { moveIn: "2026-08-12" });
    await engine.generateInvoicesForProperty(arr.propertyId, "2026-09-30");
    expect(await invoices(a2)).toMatchObject([
      {
        period_start: "2026-09-01",
        period_end: "2026-09-30",
        due_date: "2026-10-05",
        total_paise: "900000"
      }
    ]);
  });

  it("advance: a move-in AFTER the floor is billed from move-in (§19 #48)", async () => {
    const s = await setupProperty({ settings: { billing_starts_on: "2026-09-17" } });
    const a = await tenant(s, "A", { moveIn: "2026-09-20" });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-20");
    expect(await invoices(a)).toMatchObject([
      {
        period_start: "2026-09-20",
        period_end: "2026-09-30",
        due_date: "2026-09-20",
        total_paise: "330000"
      }
    ]);
  });

  it("anniversary: periods anchor on the move-in day; tenant override changes the anchor with a bridge", async () => {
    const s = await setupProperty({ settings: { cycle_mode: "anniversary" } });
    const a = await tenant(s, "A", { moveIn: "2026-09-12" });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-12");
    expect(await invoices(a)).toMatchObject([
      {
        period_start: "2026-09-12",
        period_end: "2026-10-11",
        due_date: "2026-09-12",
        total_paise: "900000"
      }
    ]);

    await db.query(`UPDATE pg_bed_assignments SET rent_due_day = 1 WHERE id = $1::uuid`, [a]);
    await engine.generateInvoicesForProperty(s.propertyId, "2026-10-12");
    const rows = await invoices(a);
    expect(rows[1]).toMatchObject({
      period_start: "2026-10-12",
      period_end: "2026-10-31",
      due_date: "2026-10-12"
    });
    expect(Number(rows[1].total_paise)).toBe(Math.round((900000 * 20) / 31 / 100) * 100);
  });

  it("window: moved_out final period is created cut and due on creation when prorate_move_out is on (arrears, §19 #37)", async () => {
    const s = await setupProperty({
      settings: { billing_timing: "arrears", prorate_move_out: true }
    });
    const a = await tenant(s, "A", { moveIn: "2026-09-01" });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-30"); // September, due Oct 5
    await db.query(
      `UPDATE pg_bed_assignments SET status = 'moved_out', move_out_date = '2026-10-15' WHERE id = $1::uuid`,
      [a]
    );
    await engine.generateInvoicesForProperty(s.propertyId, "2026-10-15");
    const rows = await invoices(a);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      period_start: "2026-10-01",
      period_end: "2026-10-15",
      due_date: "2026-10-15",
      total_paise: "435500"
    });
    // nothing after the window
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-12-01")).toMatchObject({
      invoices_created: 0
    });
  });

  it("window: prorate_move_out off keeps the natural full period; active ignores a stale notice_end_date", async () => {
    const s = await setupProperty({ settings: { prorate_move_out: false } });
    const a = await tenant(s, "A", {
      moveIn: "2026-09-01",
      noticeEnd: "2026-10-15",
      status: "notice_served"
    });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-30");
    let rows = await invoices(a);
    expect(rows[1]).toMatchObject({ period_start: "2026-10-01", period_end: "2026-10-31" });
    await engine.generateInvoicesForProperty(s.propertyId, "2026-11-30");
    expect(await invoices(a)).toHaveLength(2); // window ended Oct 15 → no November

    await db.query(`UPDATE pg_bed_assignments SET status = 'active' WHERE id = $1::uuid`, [a]); // notice_end_date still set
    // Nov 20: November (natural due Nov 5, already past → due = creation date) is created;
    // December (due Dec 5, lead 5 → from Nov 30) is not yet.
    await engine.generateInvoicesForProperty(s.propertyId, "2026-11-20");
    rows = await invoices(a);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({
      period_start: "2026-11-01",
      period_end: "2026-11-30",
      due_date: "2026-11-20"
    });
  });

  it("drafts when rent resolves only from the listing or not at all; drafts get no token", async () => {
    const s = await setupProperty({ withRoomType: false });
    const a = await tenant(s, "A", { moveIn: "2026-09-01" });
    const r = await engine.generateInvoicesForProperty(s.propertyId, "2026-09-01");
    expect(r).toMatchObject({ invoices_created: 0, drafts_created: 1 });
    expect(await invoices(a)).toMatchObject([
      { status: "draft", rent_source: "listing", total_paise: "700000", pay_token: null }
    ]);
  });

  it("skips assignments with no move-in date, reserved and cancelled ones, and paused properties", async () => {
    const s = await setupProperty();
    const noMoveIn = await tenant(s, "A", { moveIn: null });
    await tenant(s, "B", { moveIn: "2026-09-01", status: "reserved" });
    await tenant(s, "C", { moveIn: "2026-09-01", status: "cancelled" });
    const r = await engine.generateInvoicesForProperty(s.propertyId, "2026-09-01");
    expect(r).toMatchObject({
      invoices_created: 0,
      skipped: [{ assignment_id: noMoveIn, reason: "no_move_in" }]
    });

    const d = await tenant(s, "D", { moveIn: "2026-09-01" });
    await settings.pause(operatorId, s.propertyId);
    expect(await engine.generateInvoicesForProperty(s.propertyId, "2026-09-01")).toMatchObject({
      invoices_created: 0
    });
    expect(await invoices(d)).toHaveLength(0);
  });

  it("default line items apply minus the tenant's excludes; credit auto-applies at issue", async () => {
    const s = await setupProperty({
      settings: {
        default_line_items: [
          { key: "meals", kind: "meals", label: "Meals", amount_inr: 2500 },
          { key: "wifi", kind: "other", label: "Wi-Fi", amount_inr: 300 }
        ]
      }
    });
    const a = await tenant(s, "A", { moveIn: "2026-09-01" });
    await db.query(
      `UPDATE pg_bed_assignments SET default_item_overrides = '{"exclude":["wifi"]}'::jsonb WHERE id = $1::uuid`,
      [a]
    );
    await db.query(
      `INSERT INTO pg_rent_payments (pg_property_id, assignment_id, amount_paise, method, source, status, paid_on, confirmed_at)
       VALUES ($1::uuid, $2::uuid, 100000, 'cash', 'operator', 'confirmed', '2026-08-30', now())`,
      [s.propertyId, a]
    );
    await engine.generateInvoicesForProperty(s.propertyId, "2026-09-01");
    const rows = await invoices(a);
    expect(rows[0]).toMatchObject({ total_paise: "1150000", status: "partially_paid" });
    const lines = await db.query<{
      kind: string;
      label: string;
      amount_paise: string;
      source: string;
    }>(
      `SELECT l.kind::text, l.label, l.amount_paise::text, l.source::text FROM pg_rent_invoice_lines l
        JOIN pg_rent_invoices i ON i.id = l.invoice_id WHERE i.assignment_id = $1::uuid ORDER BY l.sort_order`,
      [a]
    );
    expect(lines.rows).toEqual([
      { kind: "rent", label: "Rent · September 2026", amount_paise: "900000", source: "system" },
      { kind: "meals", label: "Meals", amount_paise: "250000", source: "default_item" }
    ]);
    await assertRentInvariants(db, s.propertyId);
  });

  it("deposit: resolves assignment → room type → listing, only for move-ins on/after enabled_on, once", async () => {
    const s = await setupProperty({ roomTypeDeposit: 1800000, listingDeposit: 1000000 });
    const enabledOn = (await settings.get(operatorId, s.propertyId))!.enabled_on;
    const fromRoomType = await tenant(s, "A", { moveIn: enabledOn });
    const fromAssignment = await tenant(s, "B", { moveIn: enabledOn, depositPaise: 500000 });
    const before = await tenant(s, "C", { moveIn: "2020-01-01" });

    const r = await engine.generateInvoicesForProperty(s.propertyId, enabledOn);
    expect(r.deposits_created).toBe(2);
    expect((await invoices(fromRoomType)).find((i) => i.kind === "deposit")).toMatchObject({
      total_paise: "1800000",
      due_date: enabledOn,
      status: "issued"
    });
    expect((await invoices(fromAssignment)).find((i) => i.kind === "deposit")).toMatchObject({
      total_paise: "500000"
    });
    expect((await invoices(before)).find((i) => i.kind === "deposit")).toBeUndefined();
    expect(
      (await engine.generateInvoicesForProperty(s.propertyId, enabledOn)).deposits_created
    ).toBe(0);
    await assertRentInvariants(db, s.propertyId);
  });

  it("preview reports the first period per tenant without writing anything", async () => {
    const s = await setupProperty({ settings: { billing_starts_on: "2026-09-17" } });
    const a = await tenant(s, "A", { moveIn: "2026-08-12", occupantName: "Rahul" });
    const row = (
      await db.query<RentSettingsRow>(
        `SELECT * FROM pg_rent_settings WHERE pg_property_id = $1::uuid`,
        [s.propertyId]
      )
    ).rows[0];
    const preview = await engine.previewForProperty(s.propertyId, row, "2026-09-17");
    expect(preview.counts).toEqual({
      invoices: 1,
      drafts: 0,
      deposits: 0,
      no_rent: 0,
      no_move_in: 0
    });
    expect(preview.tenants).toMatchObject([
      {
        assignment_id: a,
        occupant_name: "Rahul",
        room_number: "102",
        bed_label: "A",
        first_period: {
          period_start: "2026-10-01",
          period_end: "2026-10-31",
          due_date: "2026-10-05",
          amount_inr: 9000,
          prorated: false,
          draft: false
        },
        skip_reason: null,
        deposit_will_invoice: false
      }
    ]);
    expect(await invoices(a)).toHaveLength(0);
  });

  it("onAssignmentEvent runs generation for that assignment only and is a no-op without settings", async () => {
    const s = await setupProperty();
    const a = await tenant(s, "A", { moveIn: "2026-09-01" });
    const b = await tenant(s, "B", { moveIn: "2026-09-01" });
    await engine.onAssignmentEvent({ type: "moved_in", propertyId: s.propertyId, assignmentId: a });
    expect(await invoices(a)).toHaveLength(1);
    expect(await invoices(b)).toHaveLength(0);

    const bare = await fx.createProperty(operatorId);
    await expect(
      engine.onAssignmentEvent({ type: "moved_in", propertyId: bare, assignmentId: randomUUID() })
    ).resolves.toBeUndefined();
  });
});
