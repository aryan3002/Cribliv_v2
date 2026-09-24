import { describe, expect, it } from "vitest";

import { duePhrase, reminderState } from "../pure/rent-reminder-state";
import {
  DEFAULT_TEMPLATES,
  MERGE_FIELD_NAMES,
  formatInrGrouped,
  mergeTemplate
} from "../pure/rent-template";
import { buildUpiUri, buildWaMeLink, sanitizeTr, waDigits } from "../pure/rent-upi";

describe("reminderState (spec §7.2, one definition of overdue)", () => {
  const base = { dueDate: "2026-10-05", offsets: [-3, 0, 1], graceDays: 3 };
  it("walks upcoming → due_soon → due_today → overdue (in grace) → overdue", () => {
    expect(reminderState({ ...base, today: "2026-10-01" })).toEqual({
      state: "upcoming",
      inGrace: false,
      daysOverdue: 0,
      daysUntilDue: 4
    });
    expect(reminderState({ ...base, today: "2026-10-02" })).toEqual({
      state: "due_soon",
      inGrace: false,
      daysOverdue: 0,
      daysUntilDue: 3
    });
    expect(reminderState({ ...base, today: "2026-10-05" })).toEqual({
      state: "due_today",
      inGrace: false,
      daysOverdue: 0,
      daysUntilDue: 0
    });
    expect(reminderState({ ...base, today: "2026-10-07" })).toEqual({
      state: "overdue",
      inGrace: true,
      daysOverdue: 2,
      daysUntilDue: 0
    });
    expect(reminderState({ ...base, today: "2026-10-09" })).toEqual({
      state: "overdue",
      inGrace: false,
      daysOverdue: 4,
      daysUntilDue: 0
    });
  });
  it("all-positive offsets never produce due_soon or due_today (queue = overdue only)", () => {
    expect(reminderState({ ...base, offsets: [1, 3], today: "2026-10-03" }).state).toBe("upcoming");
    expect(reminderState({ ...base, offsets: [1, 3], today: "2026-10-05" }).state).toBe("upcoming");
  });
});

describe("duePhrase", () => {
  it("en and hi", () => {
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-02" }, "en")).toBe("due in 3 days");
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-04" }, "en")).toBe("due tomorrow");
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-05" }, "en")).toBe("due today");
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-09" }, "en")).toBe(
      "overdue by 4 days"
    );
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-06" }, "en")).toBe(
      "overdue by 1 day"
    );
    expect(duePhrase({ dueDate: "2026-10-05", today: "2026-10-05" }, "hi")).toBe("आज देय");
  });
});

describe("mergeTemplate (spec §7.4)", () => {
  const fields = {
    tenant_name: "Rahul",
    owner_name: "Sunil",
    property_name: "Sunrise PG",
    room: "102",
    bed: "A",
    period: "September 2026",
    amount: "₹9,000",
    balance: "₹9,000",
    due_date: "5 Oct 2026",
    due_phrase: "due in 3 days",
    days_overdue: "0",
    late_fee: "₹0",
    invoice_no: "SUN-INV-0007",
    pay_link: "https://cribliv.com/en/pay/abc",
    upi_id: "sun@okaxis",
    receipt_link: "",
    utr: ""
  };
  it("merges every known field, leaves unknown ones literal and reports them", () => {
    const r = mergeTemplate(DEFAULT_TEMPLATES.en.reminder, fields);
    expect(r.text).toBe(
      "Hi Rahul, rent of ₹9,000 for September 2026 (Room 102, Bed A) is due in 3 days. Pay here: https://cribliv.com/en/pay/abc — Sunil, Sunrise PG"
    );
    expect(r).toMatchObject({ unknownFields: [], truncated: false });
    const u = mergeTemplate("Hello {tenant_name} {nope} {also_nope}", fields);
    expect(u.text).toBe("Hello Rahul {nope} {also_nope}");
    expect(u.unknownFields).toEqual(["nope", "also_nope"]);
  });
  it("truncates merged text at 900 chars with an ellipsis", () => {
    const r = mergeTemplate("x".repeat(600) + " {tenant_name} " + "y".repeat(400), fields);
    expect(r.text.length).toBe(900);
    expect(r.text.endsWith("…")).toBe(true);
    expect(r.truncated).toBe(true);
  });
  it("exposes the field list the editor shows, and Indian grouping", () => {
    expect(MERGE_FIELD_NAMES).toContain("due_phrase");
    expect(MERGE_FIELD_NAMES).toHaveLength(17);
    expect(formatInrGrouped(120000)).toBe("₹1,20,000");
    expect(formatInrGrouped(900)).toBe("₹900");
    expect(formatInrGrouped(0)).toBe("₹0");
  });
});

describe("rent-upi (spec §7.7)", () => {
  it("sanitizes tr to alphanumerics ≤ 35", () => {
    expect(sanitizeTr("SUN-INV-0007")).toBe("SUNINV0007");
    expect(sanitizeTr("A".repeat(50) + "-1")).toHaveLength(35);
  });
  it("builds the intent URI with and without amount, caps tn at 50", () => {
    const uri = buildUpiUri({
      vpa: "sun@okaxis",
      payeeName: "Sunrise PG",
      amountInr: 9000,
      note: "Rent September 2026 Room 102 Bed A and a lot more text here",
      tr: "SUNINV0007"
    });
    expect(uri).toMatch(/^upi:\/\/pay\?/);
    const params = new URLSearchParams(uri.slice("upi://pay?".length));
    expect(params.get("pa")).toBe("sun@okaxis");
    expect(params.get("pn")).toBe("Sunrise PG");
    expect(params.get("am")).toBe("9000");
    expect(params.get("tn")!.length).toBeLessThanOrEqual(50);
    expect(params.get("tr")).toBe("SUNINV0007");
    expect(params.get("cu")).toBe("INR");
    const open = buildUpiUri({
      vpa: "sun@okaxis",
      payeeName: "Sunrise PG",
      amountInr: null,
      note: "Rent",
      tr: "X"
    });
    expect(new URLSearchParams(open.slice("upi://pay?".length)).has("am")).toBe(false);
  });
  it("builds wa.me links with digits only and encoded text", () => {
    expect(waDigits("+919876543210")).toBe("919876543210");
    expect(buildWaMeLink("+919876543210", "Hi Rahul — ₹9,000")).toBe(
      "https://wa.me/919876543210?text=Hi%20Rahul%20%E2%80%94%20%E2%82%B99%2C000"
    );
  });
});
