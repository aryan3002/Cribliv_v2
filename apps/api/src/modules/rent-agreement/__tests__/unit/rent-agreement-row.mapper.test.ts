import { describe, expect, it } from "vitest";

import {
  RENT_AGREEMENT_COLUMNS,
  appRowToColumns,
  dbRowToAppRow
} from "../../drafts/rent-agreement-row.mapper";
import type { RentAgreementRow } from "../../drafts/draft-summary.mapper";

function fullRow(): RentAgreementRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    user_id: "22222222-2222-2222-2222-222222222222",
    plan_id: "premium",
    locale: "en",
    idempotency_key: "idem-key-1",
    current_step: 4,
    step_validated_at: { "1": "2026-05-01T10:00:00.000Z", "2": "2026-05-01T10:05:00.000Z" },
    status: "draft",
    owner_full_name: "Owner Name",
    owner_father_name: "Owner Father",
    owner_age: 40,
    owner_phone: "+919999999991",
    owner_email: "owner@example.com",
    owner_permanent_address: "Owner Address",
    owner_pan_ct: Buffer.from([1, 2, 3, 4]),
    owner_aadhaar_last4: "1234",
    tenant_full_name: "Tenant Name",
    tenant_father_name: "Tenant Father",
    tenant_age: 30,
    tenant_phone: "+919999999992",
    tenant_email: "tenant@example.com",
    tenant_permanent_address: "Tenant Address",
    tenant_pan_ct: Buffer.from([5, 6, 7, 8]),
    tenant_aadhaar_last4: "5678",
    tenant_company_name: "Tenant Co",
    property_full_address: "Property Address",
    property_type: "apartment",
    property_area_sqft: 900,
    property_furnishing: "furnished",
    property_purpose: "residential",
    property_parking: "covered",
    property_floor_number: 3,
    property_total_floors: 10,
    property_flat_number: "3A",
    property_municipal_number: "MUN-1",
    property_survey_number: "SUR-1",
    agreement_type: "lease",
    agreement_date: "2026-05-21",
    commencement_date: "2026-06-01",
    tenure_months: 11,
    lock_in_months: 6,
    notice_period_months: 2,
    rent_amount_paise: 2500000,
    security_deposit_paise: 5000000,
    annual_increment_pct: 5.5,
    state_code: "MH",
    city: "Mumbai",
    acknowledge_registration_required: true,
    inventory_items: [{ item: "Fan", quantity: 2, condition: "good" }],
    rent_due_day: 5,
    rent_payment_method: "bank_transfer",
    maintenance_included: true,
    maintenance_paise: 100000,
    electricity_allocation: "tenant",
    water_allocation: "owner",
    gas_allocation: "tenant",
    society_charges_allocation: "owner",
    late_payment_penalty_pct: 2.0,
    pets_allowed: false,
    subletting_allowed: false,
    renovation_allowed: true,
    commercial_use_allowed: false,
    max_occupants: 4,
    additional_terms: ["term one", "term two"],
    witness_1: { name: "Witness One", father_name: "W1 Father", address: "Addr", phone: null },
    witness_2: { name: "Witness Two", father_name: "W2 Father", address: "Addr", phone: "+91" },
    stamp_duty_paise: 48750,
    payment_order_id: "33333333-3333-3333-3333-333333333333",
    pdf_blob_path: "2026/05/agreement.pdf",
    pdf_generated_at: "2026-05-21T12:00:00.000Z",
    download_count: 1,
    max_downloads: 10,
    expires_at: "2026-08-21T12:00:00.000Z",
    e_stamp_reference: "ESTAMP-1",
    e_sign_session_id: "ESIGN-1",
    e_sign_completed_at: "2026-05-21T12:30:00.000Z",
    created_at: "2026-05-21T09:00:00.000Z",
    updated_at: "2026-05-21T12:30:00.000Z"
  };
}

describe("rent-agreement-row.mapper", () => {
  describe("RENT_AGREEMENT_COLUMNS", () => {
    it("lists 78 unique columns starting with id and ending with updated_at", () => {
      expect(RENT_AGREEMENT_COLUMNS.length).toBe(78);
      expect(new Set(RENT_AGREEMENT_COLUMNS).size).toBe(78);
      expect(RENT_AGREEMENT_COLUMNS[0]).toBe("id");
      expect(RENT_AGREEMENT_COLUMNS[RENT_AGREEMENT_COLUMNS.length - 1]).toBe("updated_at");
    });
  });

  describe("appRowToColumns", () => {
    it("returns one value per column, in column order", () => {
      const { columns, values } = appRowToColumns(fullRow());
      expect(columns).toEqual([...RENT_AGREEMENT_COLUMNS]);
      expect(values.length).toBe(RENT_AGREEMENT_COLUMNS.length);
    });

    it("JSON-stringifies jsonb columns", () => {
      const { columns, values } = appRowToColumns(fullRow());
      const sva = values[columns.indexOf("step_validated_at")];
      const inv = values[columns.indexOf("inventory_items")];
      const w1 = values[columns.indexOf("witness_1")];
      expect(typeof sva).toBe("string");
      expect(JSON.parse(sva as string)).toEqual({
        "1": "2026-05-01T10:00:00.000Z",
        "2": "2026-05-01T10:05:00.000Z"
      });
      expect(JSON.parse(inv as string)).toEqual([{ item: "Fan", quantity: 2, condition: "good" }]);
      expect(JSON.parse(w1 as string)).toMatchObject({ name: "Witness One" });
    });

    it("passes bytea Buffers and text[] arrays through untouched", () => {
      const { columns, values } = appRowToColumns(fullRow());
      expect(values[columns.indexOf("owner_pan_ct")]).toBeInstanceOf(Buffer);
      expect(values[columns.indexOf("additional_terms")]).toEqual(["term one", "term two"]);
    });

    it("maps a null witness to null, not the string 'null'", () => {
      const row = { ...fullRow(), witness_2: null };
      const { columns, values } = appRowToColumns(row);
      expect(values[columns.indexOf("witness_2")]).toBeNull();
    });
  });

  describe("dbRowToAppRow", () => {
    it("converts timestamptz Date objects to ISO strings", () => {
      const app = dbRowToAppRow({
        ...fullRow(),
        created_at: new Date("2026-05-21T09:00:00.000Z"),
        updated_at: new Date("2026-05-21T12:30:00.000Z"),
        pdf_generated_at: new Date("2026-05-21T12:00:00.000Z")
      });
      expect(app.created_at).toBe("2026-05-21T09:00:00.000Z");
      expect(app.updated_at).toBe("2026-05-21T12:30:00.000Z");
      expect(app.pdf_generated_at).toBe("2026-05-21T12:00:00.000Z");
    });

    it("formats date columns as YYYY-MM-DD", () => {
      const app = dbRowToAppRow({ ...fullRow(), agreement_date: new Date(2026, 4, 21) });
      expect(app.agreement_date).toBe("2026-05-21");
    });

    it("coerces numeric columns from string to number", () => {
      const app = dbRowToAppRow({
        ...fullRow(),
        annual_increment_pct: "5.50",
        late_payment_penalty_pct: "2.00"
      });
      expect(app.annual_increment_pct).toBe(5.5);
      expect(app.late_payment_penalty_pct).toBe(2);
    });

    it("defaults jsonb collection columns when the DB returns null", () => {
      const app = dbRowToAppRow({
        ...fullRow(),
        step_validated_at: null,
        inventory_items: null,
        additional_terms: null
      });
      expect(app.step_validated_at).toEqual({});
      expect(app.inventory_items).toEqual([]);
      expect(app.additional_terms).toEqual([]);
    });

    it("preserves nulls on nullable columns", () => {
      const app = dbRowToAppRow({
        ...fullRow(),
        owner_pan_ct: null,
        expires_at: null,
        annual_increment_pct: null
      });
      expect(app.owner_pan_ct).toBeNull();
      expect(app.expires_at).toBeNull();
      expect(app.annual_increment_pct).toBeNull();
    });
  });
});
