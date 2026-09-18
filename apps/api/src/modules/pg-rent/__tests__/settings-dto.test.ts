import { describe, expect, it } from "vitest";

import { parseOrThrow, toIsoDate, toIsoTs } from "../dto/common";
import {
  RentEnableInputSchema,
  RentPatchSettingsInputSchema,
  RentSettingsInputSchema,
  normaliseOffsets,
  settingsInputToColumns,
  toSettingsDto,
  type RentSettingsRow
} from "../dto/settings.dto";

const row: RentSettingsRow = {
  pg_property_id: "11111111-1111-1111-1111-111111111111",
  paused_at: null,
  pause_reason: null,
  enabled_on: new Date(2026, 8, 17),
  billing_starts_on: "2026-09-17",
  cycle_mode: "calendar_month",
  billing_timing: "advance",
  due_day: 5,
  proration_mode: "actual_days",
  prorate_move_out: false,
  invoice_lead_days: 5,
  reminder_offsets_days: [-3, 0, 1],
  late_fee_enabled: false,
  late_fee_grace_days: 3,
  late_fee_kind: "flat",
  late_fee_amount_paise: "10000",
  late_fee_percent_bp: 200,
  late_fee_cap_paise: null,
  late_fee_auto_apply: false,
  upi_vpa: "owner@upi",
  upi_payee_name: "Owner",
  bank_details: null,
  whatsapp_phone_e164: null,
  msg_reminder: null,
  msg_overdue: null,
  msg_tenant_paid: null,
  msg_receipt_share: null,
  receipt_prefix: "BPG",
  receipt_business_name: null,
  receipt_address: null,
  receipt_footer: null,
  receipt_logo_path: null,
  default_line_items: [{ key: "meals", kind: "meals", label: "Meals", amount_paise: 250000 }],
  electricity_unit_rate_paise: 850,
  created_at: new Date("2026-09-17T10:00:00Z"),
  updated_at: "2026-09-17T10:00:00.000Z"
};

describe("toSettingsDto", () => {
  it("maps paise to rupees and dates to ISO strings; no _paise key escapes", () => {
    const dto = toSettingsDto(row);
    expect(dto.late_fee_amount_inr).toBe(100);
    expect(dto.late_fee_cap_inr).toBeNull();
    expect(dto.electricity_unit_rate_inr).toBe(8.5);
    expect(dto.default_line_items).toEqual([
      { key: "meals", kind: "meals", label: "Meals", amount_inr: 2500 }
    ]);
    expect(dto.enabled_on).toBe("2026-09-17");
    expect(dto.updated_at).toBe("2026-09-17T10:00:00.000Z");
    expect(JSON.stringify(dto)).not.toMatch(/_paise/);
  });
});

describe("RentSettingsInputSchema", () => {
  it("accepts a valid full input and converts to columns", () => {
    const parsed = parseOrThrow(RentSettingsInputSchema, {
      cycle_mode: "anniversary",
      billing_timing: "arrears",
      due_day: 5,
      reminder_offsets_days: [1, -3, 0, 1],
      late_fee_amount_inr: 100,
      late_fee_cap_inr: 500,
      upi_vpa: "owner.name-1@okaxis",
      bank_details: {
        account_name: "A",
        account_number: "123456789012",
        ifsc: "HDFC0001234",
        bank_name: "HDFC"
      },
      receipt_prefix: "BPG",
      default_line_items: [{ key: "meals", kind: "meals", label: "Meals", amount_inr: 2500 }],
      electricity_unit_rate_inr: 8.5
    });
    expect(parsed.reminder_offsets_days).toEqual([-3, 0, 1]);
    const cols = settingsInputToColumns(parsed);
    expect(cols.late_fee_amount_paise).toBe(10000);
    expect(cols.late_fee_cap_paise).toBe(50000);
    expect(cols.electricity_unit_rate_paise).toBe(850);
    expect(cols.default_line_items).toBe(
      JSON.stringify([{ key: "meals", kind: "meals", label: "Meals", amount_paise: 250000 }])
    );
    expect(cols.bank_details).toBe(
      JSON.stringify({
        account_name: "A",
        account_number: "123456789012",
        ifsc: "HDFC0001234",
        bank_name: "HDFC"
      })
    );
    expect(cols.cycle_mode).toBe("anniversary");
  });

  it("rejects out-of-bound values with invalid_payload", () => {
    for (const bad of [
      { due_day: 29 },
      { invoice_lead_days: 16 },
      { reminder_offsets_days: [] },
      { reminder_offsets_days: [-16] },
      { reminder_offsets_days: [1, 2, 3, 4, 5, 6] },
      { late_fee_grace_days: 31 },
      { late_fee_amount_inr: 0 },
      { late_fee_amount_inr: 10001 },
      { late_fee_percent_bp: 49 },
      { late_fee_cap_inr: 50001 },
      { upi_vpa: "no-at-sign" },
      { upi_payee_name: "x".repeat(51) },
      { bank_details: { account_name: "A", account_number: "12", ifsc: "bad", bank_name: "B" } },
      { whatsapp_phone_e164: "9999999999" },
      { msg_reminder: "x".repeat(601) },
      { receipt_prefix: "b" },
      { receipt_prefix: "ABCDEFG" },
      { receipt_business_name: "x".repeat(81) },
      { default_line_items: [{ key: "rent", kind: "rent", label: "Rent", amount_inr: 1 }] },
      {
        default_line_items: Array.from({ length: 11 }, (_, i) => ({
          key: `k${i}`,
          kind: "other",
          label: "x",
          amount_inr: 1
        }))
      },
      { electricity_unit_rate_inr: 0.4 },
      { electricity_unit_rate_inr: 51 },
      { electricity_unit_rate_inr: 8.555 },
      { cycle_mode: "weekly" }
    ]) {
      expect(() => parseOrThrow(RentSettingsInputSchema, bad), JSON.stringify(bad)).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: "invalid_payload" }) })
      );
    }
  });

  it("strips unknown keys rather than failing (forward-compatible clients)", () => {
    const parsed = parseOrThrow(RentSettingsInputSchema, { due_day: 3, something_else: 1 });
    expect(parsed).toEqual({ due_day: 3 });
  });

  it("enable accepts billing_starts_on; patch requires updated_at", () => {
    expect(
      parseOrThrow(RentEnableInputSchema, { billing_starts_on: "2026-09-01" }).billing_starts_on
    ).toBe("2026-09-01");
    expect(() =>
      parseOrThrow(RentEnableInputSchema, { billing_starts_on: "2026-02-30" })
    ).toThrow();
    expect(() => parseOrThrow(RentPatchSettingsInputSchema, { due_day: 3 })).toThrow();
    expect(
      parseOrThrow(RentPatchSettingsInputSchema, {
        due_day: 3,
        updated_at: "2026-09-17T10:00:00.000Z"
      }).updated_at
    ).toBe("2026-09-17T10:00:00.000Z");
  });
});

describe("common", () => {
  it("normalises offsets, formats dates", () => {
    expect(normaliseOffsets([1, -3, 0, 1])).toEqual([-3, 0, 1]);
    expect(toIsoDate(new Date(2026, 8, 17))).toBe("2026-09-17");
    expect(toIsoDate("2026-09-17")).toBe("2026-09-17");
    expect(toIsoDate(null)).toBeNull();
    expect(toIsoTs(new Date("2026-09-17T10:00:00Z"))).toBe("2026-09-17T10:00:00.000Z");
  });
});
